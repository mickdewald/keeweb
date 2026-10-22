const MaxClipboardSeconds = 3600;

function setupClipboardIpc({ ipcMain, app, clipboard, context }) {
    let queue = Promise.resolve();
    let clearTimer = null;
    let ownedText = null;
    let clipboardGeneration = 0;
    let pendingWrites = 0;
    let drainingForQuit = false;
    let quitReady = false;

    const enqueue = (action) => {
        const pending = queue.then(action);
        queue = pending.catch(() => {});
        return pending;
    };

    const enqueueSafely = (action) => {
        enqueue(action).catch(() => {});
    };

    const cancelClearTimer = () => {
        if (clearTimer) {
            clearTimeout(clearTimer);
            clearTimer = null;
        }
    };

    const clearOwnedText = async (text, generation) => {
        if (!ownedText || ownedText.text !== text || ownedText.generation !== generation) {
            return;
        }
        if ((await clipboard.readText()) !== text) {
            if (ownedText?.generation === generation) {
                ownedText = null;
            }
            return;
        }
        // Electron exposes no atomic compare-and-clear. Recheck immediately before the
        // synchronous clear to narrow the window in which another app can replace it.
        if ((await clipboard.readText()) !== text) {
            if (ownedText?.generation === generation) {
                ownedText = null;
            }
            return;
        }
        clipboard.clear();
        if (ownedText?.generation === generation) {
            ownedText = null;
        }
    };

    const isTrustedSender = (event) => {
        const webContents = context.mainWindow?.webContents;
        return (
            event.sender === webContents &&
            event.senderFrame === webContents.mainFrame &&
            event.senderFrame.url === context.mainWindowUrl
        );
    };

    ipcMain.handle('clipboardWrite', async (event, text, seconds) => {
        if (!isTrustedSender(event)) {
            throw new Error('clipboard request denied');
        }
        if (
            typeof text !== 'string' ||
            !Number.isInteger(seconds) ||
            seconds < 0 ||
            seconds > MaxClipboardSeconds
        ) {
            throw new Error('invalid clipboard request');
        }
        if (drainingForQuit) {
            throw new Error('clipboard is closing');
        }
        pendingWrites++;
        return await enqueue(async () => {
            await clipboard.writeText(text);
            cancelClearTimer();
            const generation = ++clipboardGeneration;
            ownedText = seconds > 0 ? { text, generation } : null;
            if (seconds > 0) {
                clearTimer = setTimeout(() => {
                    clearTimer = null;
                    enqueueSafely(() => clearOwnedText(text, generation));
                }, seconds * 1000);
                clearTimer.unref?.();
            }
            return true;
        }).finally(() => pendingWrites--);
    });

    app.on('before-quit', (event) => {
        if (event.defaultPrevented || quitReady || (!ownedText && !pendingWrites)) {
            return;
        }
        event.preventDefault();
        if (drainingForQuit) {
            return;
        }
        drainingForQuit = true;
        cancelClearTimer();
        (async () => {
            try {
                await queue;
                await clearOwnedText(ownedText?.text, ownedText?.generation);
            } catch {
                // Closing must continue even when the system clipboard is unavailable.
            }
            quitReady = true;
            app.quit();
            setImmediate(() => {
                drainingForQuit = false;
                quitReady = false;
            });
        })().catch(() => {});
    });
}

module.exports = { setupClipboardIpc };

const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const { context } = require('./context');

function createUpdateProgress(onCancel) {
    let window;
    let state;
    let lastSent = 0;
    const send = () => {
        if (!window?.isDestroyed()) window?.webContents.send('private-update-progress', state);
    };
    ipcMain.on('private-update-progress-ready', (event) => {
        if (event.sender === window?.webContents) send();
    });
    ipcMain.on('private-update-progress-action', (event, action) => {
        if (event.sender !== window?.webContents) return;
        if (action === 'hide') window.hide();
        if (action === 'cancel' && state?.phase === 'downloading') onCancel();
    });
    return {
        open(value) {
            state = value;
            if (!window || window.isDestroyed()) {
                window = new BrowserWindow({
                    width: 460,
                    height: 250,
                    useContentSize: true,
                    title: 'KeeWeb aktualisieren',
                    resizable: false,
                    minimizable: false,
                    maximizable: false,
                    fullscreenable: false,
                    show: false,
                    webPreferences: {
                        preload: path.join(__dirname, 'private-update-progress-preload.js'),
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true
                    }
                });
                window.setMenu(null);
                window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
                window.webContents.on('will-navigate', (event) => event.preventDefault());
                const created = window;
                window.on('closed', () => {
                    if (window === created) window = null;
                });
                window.once('ready-to-show', () => {
                    if (window === created && !created.isDestroyed()) {
                        created.show();
                        send();
                    }
                });
                window.loadFile(path.join(__dirname, '../update-progress/index.html'));
            } else {
                send();
                window.show();
                window.focus();
            }
        },
        update(value) {
            const phaseChanged = state?.phase !== value.phase;
            state = value;
            const fraction =
                state.phase === 'downloading' && state.total > 0
                    ? Math.min(state.received / state.total, 1)
                    : 2;
            context.mainWindow?.setProgressBar(fraction);
            if (phaseChanged || Date.now() - lastSent > 100 || state.received === state.total) {
                lastSent = Date.now();
                send();
            }
        },
        close() {
            state = null;
            context.mainWindow?.setProgressBar(-1);
            window?.destroy();
            window = null;
        }
    };
}
module.exports = { createUpdateProgress };

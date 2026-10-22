const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupClipboardIpc } = require('../../desktop/scripts/ipc-handlers/clipboard');

function fixture({ writeText, readText } = {}) {
    const ipcMain = { handlers: new Map(), handle(name, handler) { this.handlers.set(name, handler); } };
    const app = new EventEmitter();
    app.quitCalls = 0;
    app.quit = () => app.quitCalls++;
    const webContents = { getURL: () => 'file:///fixture/index.html' };
    webContents.mainFrame = { url: webContents.getURL(), parent: null };
    const writes = [];
    const clipboard = {
        value: '',
        selection: { clears: 0, async clear() { this.clears++; } },
        async writeText(text) {
            writes.push(text);
            if (writeText) {
                await writeText(text);
            }
            this.value = text;
        },
        async readText() { return readText ? readText(this.value) : this.value; },
        async clear() { this.value = ''; }
    };
    setupClipboardIpc({
        ipcMain,
        app,
        clipboard,
        context: { mainWindow: { webContents }, mainWindowUrl: webContents.getURL() }
    });
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const handler = ipcMain.handlers.get('clipboardWrite');
    return { app, clipboard, event, handler, invoke: (text, seconds = 0) => handler(event, text, seconds), writes };
}

test('writes only from the main frame and clears its latest owned value before an actual quit', async () => {
    const f = fixture();
    await f.invoke('first', 5);
    await f.invoke('second', 5);
    assert.deepEqual(f.writes, ['first', 'second']);

    const quitEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    f.app.emit('before-quit', quitEvent);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(quitEvent.defaultPrevented, true);
    assert.equal(f.clipboard.value, '');
    assert.equal(f.app.quitCalls, 1);
    await assert.rejects(
        () => f.handler({ sender: {} }, 'outside', 0),
        /clipboard request denied/
    );
    await assert.rejects(
        () => f.handler({ sender: f.event.sender, senderFrame: { url: 'https://untrusted.test' } }, 'outside', 0),
        /clipboard request denied/
    );
});

test('does not clear the clipboard when another quit listener cancels the close', async () => {
    const f = fixture();
    await f.invoke('fixture-password', 5);
    f.app.prependListener('before-quit', (event) => event.preventDefault());

    f.app.emit('before-quit', { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(f.clipboard.value, 'fixture-password');
    assert.equal(f.app.quitCalls, 0);
});

test('allows a later copy when a resumed quit is cancelled', async () => {
    const f = fixture();
    await f.invoke('fixture-password', 5);
    f.app.quit = () => {
        f.app.quitCalls++;
        f.app.emit('before-quit', { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
    };

    f.app.emit('before-quit', { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    await f.invoke('next-password', 0);
    assert.deepEqual(f.writes, ['fixture-password', 'next-password']);
});

test('accepts Chromium-normalized trusted URLs', async () => {
    const ipcMain = { handlers: new Map(), handle(name, handler) { this.handlers.set(name, handler); } };
    const app = new EventEmitter();
    const webContents = { mainFrame: { url: 'file:///fixture/My%20App/index.html' } };
    const clipboard = { async writeText() {} };
    setupClipboardIpc({
        ipcMain,
        app,
        clipboard,
        context: { mainWindow: { webContents }, mainWindowUrl: 'file:///fixture/My%20App/index.html' }
    });

    await ipcMain.handlers.get('clipboardWrite')(
        { sender: webContents, senderFrame: webContents.mainFrame },
        'fixture-password',
        0
    );
});

test('holds repeated quit attempts until an initial clipboard write and clear settle', async () => {
    let resolveWrite;
    let resolveRead;
    let readCount = 0;
    const f = fixture({
        writeText: () => new Promise((resolve) => (resolveWrite = resolve)),
        readText: (value) => {
            readCount++;
            return readCount === 1 ? new Promise((resolve) => (resolveRead = resolve)) : value;
        }
    });
    const copy = f.invoke('fixture-password', 5);
    const firstQuit = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    const repeatedQuit = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };

    f.app.emit('before-quit', firstQuit);
    f.app.emit('before-quit', repeatedQuit);
    await Promise.resolve();

    assert.equal(firstQuit.defaultPrevented, true);
    assert.equal(repeatedQuit.defaultPrevented, true);
    assert.equal(f.app.quitCalls, 0);

    resolveWrite();
    await copy;
    await Promise.resolve();
    assert.equal(f.app.quitCalls, 0);

    resolveRead('fixture-password');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.clipboard.value, '');
    assert.equal(f.app.quitCalls, 1);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupClipboardIpc } = require('../../desktop/scripts/ipc-handlers/clipboard');

function fixture({ writeText, readText } = {}) {
    const ipcMain = {
        handlers: new Map(),
        handle(name, handler) {
            this.handlers.set(name, handler);
        }
    };
    const app = new EventEmitter();
    app.quitCalls = 0;
    app.quit = () => app.quitCalls++;

    let url = 'file:///fixture/index.html';
    const webContents = {
        getURL: () => url,
        mainFrame: { url, parent: null }
    };
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
        async readText() {
            return readText ? readText(this.value) : this.value;
        },
        async clear() {
            this.value = '';
        }
    };

    const context = { mainWindow: { webContents }, mainWindowUrl: url };
    setupClipboardIpc({ ipcMain, app, clipboard, context });
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const handler = ipcMain.handlers.get('clipboardWrite');
    return {
        app,
        clipboard,
        event,
        handler,
        invoke: (text, seconds = 0) => handler(event, text, seconds),
        setUrl(nextUrl) {
            url = nextUrl;
            webContents.mainFrame.url = nextUrl;
        },
        setFrameUrl(frameUrl) {
            webContents.mainFrame.url = frameUrl;
        },
        writes
    };
}

async function nextTurn() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('acknowledges a write only after the clipboard write settles and propagates rejection', async () => {
    let resolveWrite;
    const f = fixture({ writeText: () => new Promise((resolve) => { resolveWrite = resolve; }) });

    let settled = false;
    const pending = f.invoke('pending-password', 0).then(() => { settled = true; });
    await nextTurn();
    assert.deepEqual(f.writes, ['pending-password']);
    assert.equal(settled, false);

    resolveWrite();
    await pending;
    assert.equal(settled, true);
    assert.equal(f.clipboard.value, 'pending-password');

    const failure = new Error('clipboard unavailable');
    const rejected = fixture({ writeText: async () => { throw failure; } });
    await assert.rejects(() => rejected.invoke('unwritten-password'), failure);
    assert.equal(rejected.clipboard.value, '');
});

test('expires only the matching owned value and preserves another app replacement', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();

    await f.invoke('expiring-password', 5);
    t.mock.timers.tick(5000);
    await nextTurn();
    assert.equal(f.clipboard.value, '');
    assert.equal(f.clipboard.selection.clears, 0);

    await f.invoke('owned-password', 5);
    f.clipboard.value = 'another-app-value';
    t.mock.timers.tick(5000);
    await nextTurn();
    assert.equal(f.clipboard.value, 'another-app-value');
    assert.equal(f.clipboard.selection.clears, 0);

    f.clipboard.value = 'owned-password';
    const quitEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    f.app.emit('before-quit', quitEvent);
    await nextTurn();
    assert.equal(quitEvent.defaultPrevented, false);
    assert.equal(f.clipboard.value, 'owned-password');
});

test('does not clear a replacement made while expiry waits for its first clipboard read', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let resolveFirstRead;
    let readCount = 0;
    const f = fixture({
        readText: (value) => {
            readCount++;
            return readCount === 1
                ? new Promise((resolve) => (resolveFirstRead = resolve))
                : value;
        }
    });

    await f.invoke('expiring-password', 5);
    t.mock.timers.tick(5000);
    await nextTurn();
    f.clipboard.value = 'another-app-value';
    resolveFirstRead('expiring-password');
    await nextTurn();

    assert.equal(f.clipboard.value, 'another-app-value');
    assert.equal(f.clipboard.selection.clears, 0);
});

test('serializes overlapping writes and expires only the latest owned value', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let releaseFirst;
    const f = fixture({ writeText: (text) => text === 'first' ? new Promise((resolve) => { releaseFirst = resolve; }) : undefined });

    const first = f.invoke('first', 5);
    const second = f.invoke('second', 5);
    await nextTurn();
    assert.deepEqual(f.writes, ['first']);

    releaseFirst();
    await first;
    await second;
    assert.deepEqual(f.writes, ['first', 'second']);
    assert.equal(f.clipboard.value, 'second');

    t.mock.timers.tick(4999);
    await nextTurn();
    assert.equal(f.clipboard.value, 'second');
    t.mock.timers.tick(1);
    await nextTurn();
    assert.equal(f.clipboard.value, '');
});

test('does not let an expired timer clear a newer write of the same text', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let releaseSecond;
    let writeCount = 0;
    const f = fixture({
        writeText: () => {
            writeCount++;
            return writeCount === 2
                ? new Promise((resolve) => (releaseSecond = resolve))
                : undefined;
        }
    });

    await f.invoke('same-password', 5);
    const second = f.invoke('same-password', 5);
    await nextTurn();
    t.mock.timers.tick(5000);
    releaseSecond();
    await second;
    await nextTurn();

    assert.equal(f.clipboard.value, 'same-password');
});

test('rejects untrusted sender, frame, and current URL before writing', async () => {
    const f = fixture();
    const otherSender = { sender: {} };
    const otherFrame = { sender: f.event.sender, senderFrame: { url: f.event.senderFrame.url } };
    f.setUrl('file:///fixture/changed.html');
    f.setFrameUrl('file:///fixture/stale.html');

    await assert.rejects(() => f.handler(otherSender, 'sender-password', 0), /clipboard request denied/);
    await assert.rejects(() => f.handler(otherFrame, 'frame-password', 0), /clipboard request denied/);
    await assert.rejects(() => f.invoke('url-password', 0), /clipboard request denied/);
    assert.deepEqual(f.writes, []);
});

test('rejects non-text writes and unsupported expiry values', async () => {
    const f = fixture();

    await assert.rejects(() => f.invoke({ text: 'not text' }, 0), /invalid clipboard request/);
    await assert.rejects(() => f.invoke('fixture-password', 1.5), /invalid clipboard request/);
    await assert.rejects(() => f.invoke('fixture-password', 3601), /invalid clipboard request/);
    await f.invoke('fixture-password', 30);
    assert.deepEqual(f.writes, ['fixture-password']);
});

test('waits for a pending write, clears owned text, and then continues quitting', async () => {
    let resolveWrite;
    let resolveRead;
    let readCount = 0;
    const f = fixture({
        writeText: () => new Promise((resolve) => { resolveWrite = resolve; }),
        readText: (value) => {
            readCount++;
            return readCount === 1 ? new Promise((resolve) => { resolveRead = resolve; }) : value;
        }
    });
    const copy = f.invoke('quit-password', 5);
    const quitEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };

    f.app.emit('before-quit', quitEvent);
    await nextTurn();
    assert.equal(quitEvent.defaultPrevented, true);
    assert.equal(f.app.quitCalls, 0);

    resolveWrite();
    await copy;
    await nextTurn();
    assert.equal(f.app.quitCalls, 0);

    resolveRead('quit-password');
    await nextTurn();
    assert.equal(f.clipboard.value, '');
    assert.equal(f.clipboard.selection.clears, 0);
    assert.equal(f.app.quitCalls, 1);
});

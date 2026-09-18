const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const windows = [];
    const ipcMain = new EventEmitter();
    let cancelled = 0;
    class Window extends EventEmitter {
        constructor() {
            super();
            windows.push(this);
            this.webContents = new EventEmitter();
            this.webContents.send = () => {};
            this.webContents.setWindowOpenHandler = () => {};
        }

        setMenu() {}
        loadFile() {}
        show() {}
        hide() {}
        focus() {}
        isDestroyed() {
            return this.destroyed;
        }

        destroy() {
            this.destroyed = true;
            this.emit('closed');
        }
    }
    const module = { exports: {} };
    vm.runInNewContext(
        fs.readFileSync(
            path.join(__dirname, '../../desktop/scripts/private-update-progress.js'),
            'utf8'
        ),
        {
            module,
            __dirname,
            require: (name) =>
                name === 'electron'
                    ? { BrowserWindow: Window, ipcMain }
                    : name === './context'
                    ? { context: { mainWindow: { setProgressBar() {} } } }
                    : require(name)
        }
    );
    const progress = module.exports.createUpdateProgress(() => cancelled++);
    return { progress, windows, ipcMain, cancelled: () => cancelled };
}
test('progress window does not veto app quit and can be reopened after closing', () => {
    const f = fixture();
    const state = { phase: 'downloading', received: 1, total: 10 };
    f.progress.open(state);
    f.windows[0].emit('close', { preventDefault: () => assert.fail('app quit vetoed') });
    f.windows[0].destroy();
    f.progress.update(state);
    assert.equal(f.windows.length, 1);
    f.progress.open(state);
    assert.equal(f.windows.length, 2);
});
test('closing progress before ready-to-show does not resurrect or access a destroyed window', () => {
    const f = fixture();
    f.progress.open({ phase: 'downloading' });
    const first = f.windows[0];
    f.progress.close();
    assert.doesNotThrow(() => first.emit('ready-to-show'));
});
test('only the progress window may cancel and cancellation is disabled during verification', () => {
    const f = fixture();
    f.progress.open({ phase: 'downloading' });
    f.ipcMain.emit('private-update-progress-action', { sender: {} }, 'cancel');
    assert.equal(f.cancelled(), 0);
    const event = { sender: f.windows[0].webContents };
    f.ipcMain.emit('private-update-progress-action', event, 'cancel');
    assert.equal(f.cancelled(), 1);
    f.progress.update({ phase: 'verifying' });
    f.ipcMain.emit('private-update-progress-action', event, 'cancel');
    assert.equal(f.cancelled(), 1);
});

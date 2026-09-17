const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(autoSave, veto = false) {
    let cancelled = 0;
    let alert;
    const source = fs
        .readFileSync(path.join(__dirname, '../../app/scripts/views/app-view-lock.js'), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export { AppViewLockMixin };', 'AppViewLockMixin;');
    const methods = vm.runInNewContext(source, {
        Launcher: {
            cancelRestart: () => cancelled++,
            preventExit: () => false,
            quitOnRealQuitEventIfMinimizeOnQuitIsEnabled: () => false
        },
        Events: {
            emit: (_name, event) => {
                if (veto) {
                    event.preventDefault();
                }
            }
        },
        Alerts: {
            yesno: (options) => {
                alert = options;
            }
        },
        Locale: {}
    });
    const view = {
        ...methods,
        model: { settings: { autoSave }, files: { hasDirtyFiles: () => true } },
        saveAndLock: (complete) => complete(false)
    };
    return { view, cancelled: () => cancelled, alert: () => alert };
}
test('failed automatic save cancels update restart intent', () => {
    const f = fixture(true);
    assert.equal(f.view.beforeUnload({}), false);
    assert.equal(f.cancelled(), 1);
});
test('failed manual save cancels update restart intent', () => {
    const f = fixture(false);
    f.view.beforeUnload({});
    f.alert().success('save');
    assert.equal(f.cancelled(), 1);
});
test('editor veto cancels update restart intent', () => {
    const f = fixture(false, true);
    assert.equal(f.view.beforeUnload({}), false);
    assert.equal(f.cancelled(), 1);
});

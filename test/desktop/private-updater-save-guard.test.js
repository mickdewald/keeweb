const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(autoSave, veto = false, options = {}) {
    let exits = 0;
    let minimized = 0;
    let requested = options.restart === true;
    const launcherSource = fs
        .readFileSync(
            path.join(__dirname, '../../app/scripts/comp/launcher/launcher-electron.js'),
            'utf8'
        )
        .replace(/^import .*;\n/gm, '');
    const launcher = vm.runInNewContext(
        launcherSource.slice(0, launcherSource.indexOf('\n};') + 3) + '\nLauncher;',
        { Logger: class {}, window: { process: { versions: {} } } }
    );
    launcher.remoteApp = () => ({ isPrivateUpdateRequested: () => requested });
    let cancelled = 0;
    let alert;
    const source = fs
        .readFileSync(path.join(__dirname, '../../app/scripts/views/app-view-lock.js'), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export { AppViewLockMixin };', 'AppViewLockMixin;');
    const methods = vm.runInNewContext(source, {
        Launcher: {
            cancelRestart: () => {
                cancelled++;
                requested = false;
            },
            exit: () => exits++,
            minimizeApp: () => minimized++,
            preventExit: () => false,
            quitOnRealQuitEventIfMinimizeOnQuitIsEnabled: () =>
                launcher.quitOnRealQuitEventIfMinimizeOnQuitIsEnabled()
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
        model: {
            settings: { autoSave, minimizeOnClose: options.minimize === true },
            files: { hasDirtyFiles: () => options.dirty !== false }
        },
        appMinimized: () => {},
        saveAndLock: (complete) => complete(options.saveSucceeds === true)
    };
    return {
        view,
        cancelled: () => cancelled,
        alert: () => alert,
        exits: () => exits,
        minimized: () => minimized,
        requested: () => requested
    };
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

test('private update restart bypasses minimizing with a clean database', () => {
    const f = fixture(false, false, { minimize: true, restart: true, dirty: false });
    f.view.launcherBeforeQuit();
    assert.equal(f.exits(), 1);
    assert.equal(f.minimized(), 0);
});
for (const result of ['save', 'exit']) {
    test(`private update restart exits after ${result} with minimize enabled`, () => {
        const f = fixture(false, false, { minimize: true, restart: true, saveSucceeds: true });
        f.view.launcherBeforeQuit();
        f.alert().success(result);
        assert.equal(f.exits(), 1);
        assert.equal(f.minimized(), 0);
    });
}
test('cancelling private restart restores ordinary minimize behavior', () => {
    const f = fixture(false, false, { minimize: true, restart: true });
    f.view.launcherBeforeQuit();
    f.alert().cancel();
    f.alert().complete();
    assert.equal(f.requested(), false);
    f.view.model.files.hasDirtyFiles = () => false;
    f.view.launcherBeforeQuit();
    assert.equal(f.exits(), 0);
    assert.equal(f.minimized(), 1);
});

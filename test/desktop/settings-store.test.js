const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSettingsStore(launcher) {
    const logs = [];
    class Logger {
        error(...args) {
            logs.push(args);
        }
    }
    const source = fs
        .readFileSync(path.join(__dirname, '../../app/scripts/comp/settings/settings-store.js'), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export { SettingsStore };', 'SettingsStore;');
    const settingsStore = vm.runInNewContext(source, {
        Launcher: launcher,
        Logger,
        StringFormat: { camelCase: (key) => key }
    });
    return { settingsStore, logs };
}

test('observes rejected Electron saves without replacing the caller promise', async () => {
    const failure = new Error('write failed');
    const writePromise = Promise.reject(failure);
    const { settingsStore, logs } = loadSettingsStore({
        saveConfig: () => writePromise
    });
    const unhandled = [];
    const onUnhandledRejection = (reason) => unhandled.push(reason);

    process.on('unhandledRejection', onUnhandledRejection);
    try {
        const returnedPromise = settingsStore.save('file-info', { saved: true });

        assert.equal(returnedPromise, writePromise);
        await assert.rejects(returnedPromise, failure);
        await new Promise((resolve) => setImmediate(resolve));

        assert.deepEqual(logs, [['Error saving file-info', failure]]);
        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandledRejection);
    }
});

test('returns successful Electron save promises unchanged', async () => {
    const writePromise = Promise.resolve();
    const { settingsStore, logs } = loadSettingsStore({
        saveConfig: () => writePromise
    });

    const returnedPromise = settingsStore.save('app-settings', { saved: true });

    assert.equal(returnedPromise, writePromise);
    await returnedPromise;
    assert.deepEqual(logs, []);
});

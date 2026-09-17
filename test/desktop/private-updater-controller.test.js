const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PrivateUpdaterController } = require('../../desktop/scripts/private-updater-controller');

function fixture(responses = []) {
    const calls = [];
    const native = new EventEmitter();
    native.setFeedURL = (value) => calls.push(['feed', value]);
    native.checkForUpdates = () => calls.push(['download']);
    native.quitAndInstall = () => calls.push(['install']);
    const controller = new PrivateUpdaterController({
        app: { quit: () => calls.push(['normalQuit']) },
        autoUpdater: native,
        dialog: {
            showMessageBox: async (options) => {
                calls.push(['dialog', options.message]);
                return { response: responses.shift() ?? 1 };
            }
        },
        fetchRelease: async () => ({
            version: '1.18.7',
            build: '20260918000000',
            updateURL: 'https://example.test/update.json'
        }),
        settings: {},
        saveSettings: async (value) => calls.push(['settings', value]),
        build: '20260917000000',
        log: () => {}
    });
    return { controller, native, calls };
}

test('declining an update never downloads or stages it', async () => {
    const { controller, calls } = fixture([1]);
    await controller.check();
    assert.deepEqual(
        calls.map((c) => c[0]),
        ['dialog']
    );
    assert.equal(controller.busy, false);
});
test('approval starts one download and suppresses overlapping checks', async () => {
    const { controller, calls } = fixture([0]);
    await controller.check();
    await controller.check();
    assert.deepEqual(
        calls.map((c) => c[0]),
        ['dialog', 'feed', 'download']
    );
});
test('restart goes through ordinary quit before native installation', async () => {
    const { controller, calls } = fixture([0]);
    controller.ready = true;
    await controller.offerRestart();
    assert.deepEqual(
        calls.map((c) => c[0]),
        ['dialog', 'normalQuit']
    );
    controller.finishInstall({ preventDefault: () => calls.push(['prevent']) });
    assert.deepEqual(
        calls.slice(-2).map((c) => c[0]),
        ['prevent', 'install']
    );
    controller.finishInstall({ preventDefault: () => assert.fail('reentrant install') });
});
test('save dialog cancellation cancels the requested restart', async () => {
    const { controller, calls } = fixture([0]);
    controller.ready = true;
    await controller.offerRestart();
    controller.cancelInstall();
    controller.finishInstall({ preventDefault: () => assert.fail('cancelled install') });
    assert.equal(
        calls.some((c) => c[0] === 'install'),
        false
    );
    assert.equal(controller.ready, true);
});
test('automatic OFF persists, manual check remains available', async () => {
    const { controller, calls } = fixture();
    await controller.setAutomatic(false);
    await controller.check(false);
    assert.equal(calls.length, 1);
    await controller.check(true);
    assert.equal(calls[1][0], 'dialog');
});
test('background failures are silent and checks recover', async () => {
    const { controller, calls } = fixture();
    controller.fetchRelease = async () => {
        throw new Error('offline');
    };
    await controller.check(false);
    assert.equal(calls.length, 0);
    assert.equal(controller.busy, false);
});
test('native download failure releases the busy state and reports failure', async () => {
    const { controller, native, calls } = fixture([0]);
    await controller.check();
    native.emit('error', new Error('invalid signature'));
    assert.equal(controller.busy, false);
    assert.equal(calls.at(-1)[0], 'dialog');
});
test('no update on automatic check does not show a dialog', async () => {
    const { controller, calls } = fixture();
    controller.fetchRelease = async () => null;
    await controller.check(false);
    assert.equal(calls.length, 0);
    await controller.check();
    assert.equal(calls.length, 1);
});

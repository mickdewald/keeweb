const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PrivateUpdaterController } = require('../../desktop/scripts/private-updater-controller');

function fixture(responses = []) {
    const calls = [];
    const progress = [];
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
        prepareDownload: async (_release, _signal, onProgress) => {
            calls.push(['prepare']);
            onProgress({ received: 50, total: 100 });
            return {
                updateURL: 'http://127.0.0.1/update.json',
                dispose: async () => calls.push(['dispose'])
            };
        },
        progress: {
            open: (state) => progress.push(['open', state]),
            update: (state) => progress.push(['update', state]),
            close: () => progress.push(['close'])
        },
        settings: {},
        saveSettings: async (value) => calls.push(['settings', value]),
        build: '20260917000000',
        log: () => {}
    });
    return { controller, native, calls, progress };
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
        ['dialog', 'prepare', 'feed', 'download']
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

test('shows download progress immediately and keeps verification visible until native completion', async () => {
    const { controller, native, progress, calls } = fixture([0, 1]);
    await controller.check();
    assert.equal(progress[0][0], 'open');
    assert.equal(progress[0][1].phase, 'downloading');
    assert.equal(progress[1][1].received, 50);
    assert.equal(progress.at(-1)[1].phase, 'verifying');
    native.emit('update-downloaded');
    assert.equal(progress.at(-1)[0], 'close');
    assert.ok(calls.some(([type]) => type === 'dispose'));
});
test('a second manual check reopens progress without starting another download', async () => {
    const { controller, progress, calls } = fixture([0]);
    await controller.check();
    await controller.check();
    assert.equal(progress.at(-1)[0], 'open');
    assert.equal(calls.filter(([type]) => type === 'prepare').length, 1);
});
test('cancelling a download stops preparation and never stages an update', async () => {
    const { controller, calls, progress } = fixture([0]);
    let started;
    const ready = new Promise((resolve) => {
        started = resolve;
    });
    controller.prepareDownload = async (_release, signal) =>
        new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
            started();
        });
    const check = controller.check();
    await ready;
    controller.cancelDownload();
    await check;
    assert.equal(controller.busy, false);
    assert.equal(progress.at(-1)[0], 'close');
    assert.equal(
        calls.some(([type]) => type === 'download'),
        false
    );
    assert.equal(calls.filter(([type]) => type === 'dialog').length, 1);
});

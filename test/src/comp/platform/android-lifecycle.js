import { expect } from 'chai';
import { Events } from 'framework/events';
import { AndroidLifecycle } from 'comp/platform/android/android-lifecycle';

function startLifecycle({ nativeFlowPending = false, files = [] } = {}) {
    const listeners = {};
    const app = { addListener: (name, fn) => (listeners[name] = fn) };
    const synced = [];
    const appModel = { files, syncFile: (f) => synced.push(f.name) };
    AndroidLifecycle.start(appModel, app, { nativeFlowPending });
    return { listeners, synced };
}

describe('AndroidLifecycle', () => {
    let minimized;
    const onMinimized = () => minimized++;

    beforeEach(() => {
        minimized = 0;
        Events.on('app-minimized', onMinimized);
    });

    afterEach(() => {
        Events.off('app-minimized', onMinimized);
    });

    it('treats going to the background as minimizing', () => {
        const { listeners } = startLifecycle();
        listeners.appStateChange({ isActive: false });
        expect(minimized).to.equal(1);
    });

    it('does not minimize while a native flow such as the document picker is open', () => {
        const { listeners } = startLifecycle({ nativeFlowPending: true });
        listeners.appStateChange({ isActive: false });
        expect(minimized).to.equal(0);
    });

    it('syncs idle document-picker files on resume', () => {
        const files = [
            { name: 'drive', storage: 'androiddoc', syncing: false },
            { name: 'busy', storage: 'androiddoc', syncing: true },
            { name: 'local', storage: null, syncing: false }
        ];
        const { listeners, synced } = startLifecycle({ files });
        listeners.appStateChange({ isActive: true });
        expect(synced).to.eql(['drive']);
    });
});

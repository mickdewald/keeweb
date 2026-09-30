import { expect } from 'chai';
import $ from 'jquery';
import { Events } from 'framework/events';
import { AndroidLifecycle } from 'comp/platform/android/android-lifecycle';
import { Alerts } from 'comp/ui/alerts';
import { AppViewLockMixin } from 'views/app-view-lock';

// Alerts render a real ModalView, which uses the global jQuery the app provides. Set at load
// time, before mocha records the globals, so the leak check does not flag it.
window.$ = window.$ || $;

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

    describe('locking with an alert open', () => {
        function lockView() {
            return {
                ...AppViewLockMixin,
                locked: 0,
                model: {
                    settings: { lockOnMinimize: true },
                    files: { hasUnsavedFiles: () => false }
                },
                closeAllFilesAndShowFirst() {
                    this.locked++;
                }
            };
        }

        let view;
        const onLock = () => view.appMinimized();

        beforeEach(() => {
            view = lockView();
            Events.on('app-minimized', onLock);
        });

        afterEach(() => {
            Events.off('app-minimized', onLock);
            Alerts.closeAll();
        });

        it('dismisses the alert and locks when Android goes to the background', () => {
            let canceled = 0;
            Alerts.yesno({ header: 'Delete?', cancel: () => canceled++ });
            expect(Alerts.alertDisplayed).to.equal(true);
            const { listeners } = startLifecycle();
            listeners.appStateChange({ isActive: false });
            expect(Alerts.alertDisplayed).to.equal(false);
            expect(canceled).to.equal(1);
            expect(view.locked).to.equal(1);
        });

        it('keeps the desktop behaviour: minimizing with an alert open does not lock', () => {
            Alerts.yesno({ header: 'Delete?' });
            Events.emit('app-minimized');
            expect(Alerts.alertDisplayed).to.equal(true);
            expect(view.locked).to.equal(0);
        });

        it('leaves an alert alone while a native flow is open', () => {
            Alerts.yesno({ header: 'Delete?' });
            const { listeners } = startLifecycle({ nativeFlowPending: true });
            listeners.appStateChange({ isActive: false });
            expect(Alerts.alertDisplayed).to.equal(true);
            expect(view.locked).to.equal(0);
        });
    });
});

import { expect } from 'chai';
import $ from 'jquery';
import { Events } from 'framework/events';
import { AndroidLifecycle } from 'comp/platform/android/android-lifecycle';
import { Alerts } from 'comp/ui/alerts';
import { AppViewLockMixin } from 'views/app-view-lock';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { Storage } from 'storage';
import { finishBackgroundLock, getBackgroundLockGeneration } from 'models/background-lock-state';

// Alerts render a real ModalView, which uses the global jQuery the app provides. Set at load
// time, before mocha records the globals, so the leak check does not flag it.
window.$ = window.$ || $;

function startLifecycle({ nativeFlowPending = false, files = [] } = {}) {
    const listeners = {};
    const app = { addListener: (name, fn) => (listeners[name] = fn) };
    const synced = [];
    const appModel = { files, syncFile: (f) => synced.push(f.name) };
    AndroidLifecycle.start(appModel, app, { nativeFlowPending });
    return { listeners, synced, appModel };
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
        finishBackgroundLock(null, getBackgroundLockGeneration());
    });

    it('uses appStateChange(false) as a fallback when no pause event is delivered', () => {
        const { listeners, appModel } = startLifecycle();
        listeners.appStateChange({ isActive: false });
        expect(minimized).to.equal(1);
        expect(appModel.backgroundLockActive).to.equal(true);
    });

    it('locks on pause before Android sends appStateChange(false)', () => {
        const { listeners, appModel } = startLifecycle({ nativeFlowPending: true });
        listeners.pause();
        expect(minimized).to.equal(1);
        expect(appModel.backgroundLockActive).to.equal(true);
    });

    it('uses one generation when pause is followed by appStateChange(false)', () => {
        const { listeners, appModel } = startLifecycle();
        listeners.pause();
        const lockGeneration = appModel.backgroundLockGeneration;

        listeners.appStateChange({ isActive: false });

        expect(minimized).to.equal(1);
        expect(appModel.backgroundLockGeneration).to.equal(lockGeneration);
    });

    it('starts a new generation after the app resumes and pauses again', () => {
        const { listeners, appModel } = startLifecycle();
        listeners.pause();
        const firstGeneration = appModel.backgroundLockGeneration;

        listeners.appStateChange({ isActive: true });
        listeners.resume();
        listeners.pause();

        expect(minimized).to.equal(2);
        expect(appModel.backgroundLockGeneration).to.equal(firstGeneration + 1);
    });

    it('invalidates pending opens even when no database is open and skips resume sync behind the gate', () => {
        const { listeners, appModel, synced } = startLifecycle({
            files: [{ name: 'idle', storage: 'androiddoc' }]
        });
        listeners.appStateChange({ isActive: false });
        expect(appModel.backgroundLockActive).to.equal(true);
        expect(appModel.backgroundLockGeneration).to.be.a('number');
        listeners.appStateChange({ isActive: true });
        expect(synced).to.eql([]);
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

    it('keeps appStateChange(true) as the sole resume sync when native resume follows it', () => {
        const { listeners, synced } = startLifecycle({
            files: [{ name: 'drive', storage: 'androiddoc', syncing: false }]
        });

        listeners.appStateChange({ isActive: true });
        listeners.resume();

        expect(synced).to.eql(['drive']);
    });

    it('does not resume-sync an Android document while its lock cache is pending', () => {
        const originalCacheStorage = Storage.cache;
        const originalDocumentStorage = Storage.androiddoc;
        let finishCache;
        let documentStats = 0;
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                finishCache = callback;
            }
        };
        Storage.androiddoc = {
            stat() {
                documentStats++;
            }
        };
        const fileInfo = { id: 'file', set() {} };
        const file = {
            id: 'file',
            name: 'Main',
            active: true,
            storage: 'androiddoc',
            path: 'content://doc',
            dirty: true,
            set(values) {
                Object.assign(this, values);
            },
            setSyncProgress() {
                this.syncing = true;
            },
            getData(callback) {
                callback(new Uint8Array([1]).buffer);
            },
            getLocalEditState() {
                return null;
            }
        };
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            files: [file],
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        const listeners = {};
        const app = { addListener: (name, fn) => (listeners[name] = fn) };
        try {
            AndroidLifecycle.start(appModel, app, {});
            appModel.cacheFileForLock(file);
            expect(file.lockCacheInProgress).to.equal(true);

            listeners.appStateChange({ isActive: true });
            expect(documentStats).to.equal(0);

            finishCache();
            expect(file.lockCacheInProgress).to.equal(false);
        } finally {
            Storage.cache = originalCacheStorage;
            Storage.androiddoc = originalDocumentStorage;
        }
    });

    describe('locking with an alert open', () => {
        function lockView() {
            return {
                ...AppViewLockMixin,
                locked: 0,
                model: {
                    settings: { lockOnMinimize: true },
                    files: Object.assign([], { hasUnsavedFiles: () => false })
                },
                closeAllFilesAndShowFirst() {
                    this.locked++;
                }
            };
        }

        let view;
        const onLock = (options) => view.appMinimized(options);

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

        it('saves unsaved work before locking from the Android background even with auto-save off', () => {
            let saveOptions;
            view.model.settings.autoSave = false;
            view.model.files.hasUnsavedFiles = () => true;
            view.saveAndLock = (_complete, options) => (saveOptions = options);

            const { listeners } = startLifecycle();
            listeners.appStateChange({ isActive: false });

            expect(saveOptions).to.include({ cacheOnly: true, forceSave: true });
            expect(saveOptions.lockGeneration).to.be.a('number');
            expect(view.locked).to.equal(0);
        });

        it('does not close dirty work when the background save fails', async () => {
            view.model.settings.autoSave = false;
            view.model.files = [{ dirty: true, name: 'Main', editVersion: 0 }];
            view.model.files.hasUnsavedFiles = () => true;
            view.model.files.hasDirtyFiles = () => true;
            view.model.cacheFileForLock = (_file, complete) =>
                Promise.resolve().then(() => complete('cache unavailable'));

            const { listeners } = startLifecycle();
            listeners.appStateChange({ isActive: false });

            await Promise.resolve();

            expect(view.locked).to.equal(0);
            expect(Alerts.alertDisplayed).to.equal(true);
        });

        it('does not close dirty work when a cache failure reports synchronously', () => {
            view.model.settings.autoSave = false;
            view.model.files = [{ dirty: true, name: 'Main', editVersion: 0 }];
            view.model.files.hasUnsavedFiles = () => true;
            view.model.files.hasDirtyFiles = () => true;
            view.model.cacheFileForLock = (_file, complete) => complete('cache unavailable');

            const { listeners } = startLifecycle();
            listeners.appStateChange({ isActive: false });

            expect(view.locked).to.equal(0);
            expect(Alerts.alertDisplayed).to.equal(true);
        });

        it('keeps the desktop behaviour: minimizing with an alert open does not lock', () => {
            Alerts.yesno({ header: 'Delete?' });
            Events.emit('app-minimized');
            expect(Alerts.alertDisplayed).to.equal(true);
            expect(view.locked).to.equal(0);
        });

        it('dismisses an alert and locks while a native flow is open', () => {
            Alerts.yesno({ header: 'Delete?' });
            const { listeners } = startLifecycle({ nativeFlowPending: true });
            listeners.appStateChange({ isActive: false });
            expect(Alerts.alertDisplayed).to.equal(false);
            expect(view.locked).to.equal(1);
        });

        it('closes an alert opened synchronously by another alert close handler', () => {
            Alerts.yesno({
                header: 'First',
                cancel: () => Alerts.yesno({ header: 'Second' })
            });

            Alerts.closeAll();

            expect(Alerts.alertDisplayed).to.equal(false);
        });
    });
});

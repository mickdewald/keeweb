import { expect } from 'chai';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { AppViewLockMixin } from 'views/app-view-lock';
import { Storage } from 'storage';
import * as BackgroundLockState from 'models/background-lock-state';

function lockFile(name, { dirty = false, editVersion = 0 } = {}) {
    return {
        id: name,
        name,
        active: true,
        demo: false,
        dirty,
        modified: dirty,
        pendingMutations: 0,
        syncing: false,
        lockCacheInProgress: false,
        editVersion,
        setModified() {
            this.modified = true;
            this.dirty = true;
            this.editVersion++;
        }
    };
}

function filesCollection(files) {
    files.hasUnsavedFiles = () =>
        files.some((file) => file.dirty || file.pendingMutations || file.syncing);
    files.hasDirtyFiles = () => files.some((file) => file.dirty);
    files.hasOpenFiles = () => files.some((file) => file.active);
    return files;
}

function lockView(files, cacheFileForLock) {
    return {
        ...AppViewLockMixin,
        locked: 0,
        lockClasses: [],
        model: {
            settings: { autoSave: false },
            files: filesCollection(files),
            cacheFileForLock,
            closeAllFiles() {
                files.forEach((file) => {
                    file.active = false;
                });
            },
            fileInfos: {
                0: null,
                getMatch() {
                    return null;
                }
            }
        },
        $el: {
            addClass: (name) => lockViewClasses.push(name),
            removeClass: () => {}
        },
        views: { open: { showOpenFileInfo() {} } },
        closeAllFilesAndShowFirst() {
            this.locked++;
            AppViewLockMixin.closeAllFilesAndShowFirst.call(this);
        }
    };
}

function resetBackgroundLock(model = {}) {
    BackgroundLockState.finishBackgroundLock(
        model,
        BackgroundLockState.getBackgroundLockGeneration()
    );
}

let lockViewClasses;

describe('AppViewLockMixin background lock boundary', () => {
    beforeEach(() => {
        lockViewClasses = [];
    });

    it('does not activate the global background gate for a desktop save error', () => {
        const file = lockFile('Main', { dirty: true });
        const view = lockView([file], () => {});
        view.model.syncFile = (_file, _options, callback) => callback('offline');
        let shownErrors;
        view.showLockSaveError = (errorFiles) => {
            shownErrors = errorFiles;
        };
        resetBackgroundLock(view.model);
        const generationBefore = BackgroundLockState.getBackgroundLockGeneration(view.model);

        view.saveAndLock();

        expect(shownErrors).to.eql(['Main']);
        expect(view.model.backgroundLockActive).to.not.equal(true);
        expect(BackgroundLockState.getBackgroundLockGeneration(view.model)).to.equal(
            generationBefore
        );
        expect(
            BackgroundLockState.isOpenAllowedForGeneration(view.model, generationBefore)
        ).to.equal(true);
    });

    it('revalidates every open file before closing after a background cache cycle', () => {
        const a = lockFile('A', { dirty: true });
        const b = lockFile('B', { dirty: true });
        const initiallyClean = lockFile('C');
        const callbacks = [];
        const cached = [];
        const view = lockView([a, initiallyClean, b], (file, callback) => {
            cached.push(file.name);
            file.lockCacheEditVersion = file.editVersion;
            file.dirty = false;
            callbacks.push({ file, callback });
        });

        view.saveAndLock(null, { cacheOnly: true });
        expect(cached).to.eql(['A', 'C', 'B']);

        callbacks.shift().callback();
        callbacks.shift().callback();
        initiallyClean.setModified();
        callbacks.shift().callback();

        expect(view.locked).to.equal(0);
        expect(cached).to.eql(['A', 'C', 'B', 'C']);

        callbacks.shift().callback();
        expect(view.locked).to.equal(1);
        expect(view.model.files.hasOpenFiles()).to.equal(false);
    });

    it('marks the sensitive workspace locked immediately while persistence is still pending', () => {
        const file = lockFile('Main', { dirty: true });
        const view = lockView([file], () => {});

        view.saveAndLock(null, { cacheOnly: true });

        expect(view.model.backgroundLockActive).to.equal(true);
        expect(lockViewClasses).to.include('app--background-locking');
        expect(view.locked).to.equal(0);
        expect(view.model.files.hasOpenFiles()).to.equal(true);
    });

    it('fails the background gate when cache persistence fails for a clean file', () => {
        const file = lockFile('Main');
        let shownErrors;
        const view = lockView([file], (_file, callback) => callback('cache unavailable'));
        view.showLockSaveError = (errorFiles) => {
            shownErrors = errorFiles;
        };

        view.saveAndLock(null, { cacheOnly: true });

        expect(shownErrors).to.eql(['Main']);
        expect(view.locked).to.equal(0);
        expect(view.model.files.hasOpenFiles()).to.equal(true);
    });

    it('closes after real lock caching of a dirty file instead of recaching forever', async () => {
        const originalCacheStorage = Storage.cache;
        let writes = 0;
        Storage.cache = {
            saveRecovery(_id, _opts, _data, _fileInfo, _recoveryVersion, callback) {
                writes++;
                callback();
            }
        };
        const file = lockFile('Main', { dirty: true });
        file.getData = (callback) => callback(new Uint8Array([1]).buffer);
        file.getLocalEditState = () => ({ editVersion: file.editVersion });
        file.set = (values) => Object.assign(file, values);
        const info = {
            id: 'Main',
            set(values) {
                Object.assign(this, values);
            }
        };
        const view = lockView([file], AppModelSyncMixin.cacheFileForLock);
        Object.assign(view.model, AppModelSyncMixin, {
            settings: {},
            fileInfos: { get: () => info, getMatch: () => null, save() {} },
            getFileInfo: () => info,
            getStoreOpts: () => null
        });

        try {
            view.saveAndLock(null, { cacheOnly: true });
            await Promise.resolve();

            expect(writes).to.equal(1);
            expect(view.locked).to.equal(1);
            expect(view.model.files.hasOpenFiles()).to.equal(false);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('waits for a clean syncing file in normal save-and-lock without recursive sync errors', () => {
        const file = lockFile('Main');
        file.syncing = true;
        let resumeSync;
        file.once = (_event, callback) => {
            resumeSync = () => callback(file, false);
        };
        const view = lockView([file], () => {});
        let attempts = 0;
        view.model.syncFile = (_file, _options, callback) => {
            attempts++;
            if (attempts > 1 && file.syncing) {
                throw new Error('retried before syncing settled');
            }
            if (file.syncing) {
                callback('Sync in progress');
            } else {
                callback();
            }
        };

        expect(() => view.saveAndLock()).to.not.throw();
        expect(attempts).to.equal(0);
        expect(view.locked).to.equal(0);

        file.syncing = false;
        resumeSync();
        return Promise.resolve().then(() => {
            expect(attempts).to.equal(1);
            expect(view.locked).to.equal(1);
        });
    });

    it('uses an existing lock generation to gate and wait for a clean syncing file', async () => {
        const originalCacheStorage = Storage.cache;
        const file = lockFile('Main');
        file.syncing = true;
        file.getData = (callback) => callback(new Uint8Array([1]).buffer);
        file.getLocalEditState = () => ({ editVersion: file.editVersion });
        file.set = (values) => Object.assign(file, values);
        let resumeSync;
        file.once = (_event, callback) => {
            resumeSync = () => callback(file, false);
        };
        let writes = 0;
        Storage.cache = {
            saveRecovery(_id, _opts, _data, _fileInfo, _recoveryVersion, callback) {
                writes++;
                callback();
            }
        };
        const info = {
            id: 'Main',
            set(values) {
                Object.assign(this, values);
            }
        };
        const view = lockView([file], AppModelSyncMixin.cacheFileForLock);
        Object.assign(view.model, AppModelSyncMixin, {
            settings: {},
            fileInfos: { get: () => info, getMatch: () => null, save() {} },
            getFileInfo: () => info,
            getStoreOpts: () => null
        });

        const lockGeneration = 1000;

        try {
            view.lockWorkspace(true, { forceSave: true, lockGeneration });

            expect(resumeSync).to.be.a('function');
            expect(writes).to.equal(0);
            expect(view.locked).to.equal(0);
            expect(view.model.backgroundLockGeneration).to.equal(lockGeneration);
            expect(view.model.backgroundLockActive).to.equal(true);

            file.syncing = false;
            resumeSync();
            await Promise.resolve();
            await Promise.resolve();

            expect(writes).to.equal(1);
            expect(view.locked).to.equal(1);
            expect(view.model.files.hasOpenFiles()).to.equal(false);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });
});

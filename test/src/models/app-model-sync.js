import { expect } from 'chai';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { EntryModel } from 'models/entry-model';
import { Storage } from 'storage';

describe('AppModelSyncMixin Android documents', () => {
    it('restarts at a relinked URI instead of completing the stale sync', () => {
        const originalStorage = Storage.androiddoc;
        const paths = [];
        const completions = [];
        Storage.androiddoc = {
            stat(path, opts, callback) {
                paths.push(path);
                callback(null, { rev: 'rev' });
            }
        };
        const fileInfo = {
            id: 'file',
            storage: 'androiddoc',
            path: 'content://old',
            rev: 'rev',
            modified: false,
            editState: null,
            set(values) {
                Object.assign(this, values);
            }
        };
        const file = {
            id: 'file',
            name: 'Main',
            active: true,
            storage: 'androiddoc',
            path: 'content://old',
            modified: false,
            dirty: false,
            setSyncProgress() {
                this.syncing = true;
                if (!this.relinked) {
                    this.relinked = true;
                    this.path = 'content://new';
                }
            },
            setSyncComplete(path) {
                completions.push(path);
                this.path = path;
                this.syncing = false;
            },
            set(values) {
                Object.assign(this, values);
            },
            getLocalEditState() {
                return null;
            }
        };
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        try {
            appModel.syncFile(file);
        } finally {
            Storage.androiddoc = originalStorage;
        }
        expect(paths).to.eql(['content://old', 'content://new']);
        expect(completions).to.eql(['content://new']);
        expect(fileInfo.path).to.equal('content://new');
    });

    it('does not complete the old sync callback before the replacement sync finishes', () => {
        const originalStorage = Storage.androiddoc;
        let finishReplacement;
        const completed = [];
        Storage.androiddoc = {
            stat(path, _opts, callback) {
                if (path === 'content://new') {
                    finishReplacement = callback;
                } else {
                    callback(null, { rev: 'rev' });
                }
            }
        };
        const fileInfo = {
            id: 'file',
            storage: 'androiddoc',
            path: 'content://old',
            rev: 'rev',
            set(values) {
                Object.assign(this, values);
            }
        };
        const file = {
            id: 'file',
            name: 'Main',
            active: true,
            storage: 'androiddoc',
            path: 'content://old',
            modified: false,
            dirty: false,
            setSyncProgress() {
                this.syncing = true;
                if (!this.relinked) {
                    this.relinked = true;
                    this.path = 'content://new';
                }
            },
            setSyncComplete(path) {
                this.path = path;
                this.syncing = false;
            },
            set(values) {
                Object.assign(this, values);
            },
            getLocalEditState() {
                return null;
            }
        };
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        try {
            appModel.syncFile(file, null, () => completed.push(file.path));
            expect(completed).to.eql([]);

            finishReplacement(null, { rev: 'rev' });
            expect(completed).to.eql(['content://new']);
        } finally {
            Storage.androiddoc = originalStorage;
        }
    });

    it('caches dirty Android work for a background lock without saving the document', () => {
        const originalDocumentStorage = Storage.androiddoc;
        const originalCacheStorage = Storage.cache;
        const calls = [];
        Storage.androiddoc = {
            save() {
                calls.push('write');
            }
        };
        Storage.cache = {
            save(id, opts, data, callback) {
                calls.push('cache');
                callback();
            }
        };
        const fileInfo = {
            id: 'file',
            storage: 'androiddoc',
            path: 'content://doc',
            rev: 'rev',
            modified: false,
            editState: null,
            set(values) {
                Object.assign(this, values);
            }
        };
        const file = {
            id: 'file',
            name: 'Main',
            active: true,
            storage: 'androiddoc',
            path: 'content://doc',
            modified: true,
            dirty: true,
            editVersion: 0,
            set(values) {
                Object.assign(this, values);
            },
            getData(callback) {
                callback(new Uint8Array([1]).buffer);
            },
            getLocalEditState() {
                return { local: 'edit' };
            }
        };
        const appModel = {
            ...AppModelSyncMixin,
            settings: { disableOfflineStorage: true },
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        try {
            appModel.cacheFileForLock(file, () => {});
        } finally {
            Storage.androiddoc = originalDocumentStorage;
            Storage.cache = originalCacheStorage;
        }
        expect(calls).to.eql(['cache']);
        expect(fileInfo.modified).to.equal(true);
        expect(fileInfo.editState).to.eql({ local: 'edit' });
        expect(file.lockCacheEditVersion).to.equal(0);
        expect(file.dirty).to.equal(true);
    });

    it('recaches after an already-unsaved entry edit during a delayed lock cache write', () => {
        const originalCacheStorage = Storage.cache;
        const writes = [];
        const cacheCallbacks = [];
        let completed = 0;
        Storage.cache = {
            save(_id, _opts, data, callback) {
                writes.push([...new Uint8Array(data)]);
                cacheCallbacks.push(callback);
            }
        };
        const fileInfo = {
            id: 'file',
            set(values) {
                Object.assign(this, values);
            }
        };
        const file = {
            id: 'file',
            name: 'Main',
            active: true,
            storage: 'androiddoc',
            path: 'content://doc',
            dirty: true,
            editVersion: 0,
            set(values) {
                Object.assign(this, values);
            },
            setModified() {
                this.set({ modified: true, dirty: true, editVersion: this.editVersion + 1 });
            },
            getData(callback) {
                callback(new Uint8Array([this.editVersion + 1]).buffer);
            },
            getLocalEditState() {
                return { editVersion: this.editVersion };
            }
        };
        const entryModel = new EntryModel();
        entryModel.entry = {
            fields: new Map(),
            times: { update() {} },
            pushHistory() {}
        };
        entryModel.file = file;
        entryModel.unsaved = true;
        entryModel._fillByEntry = () => {};
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        try {
            appModel.cacheFileForLock(file, () => completed++);
            expect(writes).to.eql([[1]]);

            entryModel.setField('Title', 'latest');
            cacheCallbacks.shift()();
            expect(writes).to.eql([[1], [2]]);
            expect(completed).to.equal(0);

            cacheCallbacks.shift()();
            expect(writes[writes.length - 1]).to.eql([2]);
            expect(fileInfo.editState).to.eql({ editVersion: 1 });
            expect(completed).to.equal(1);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('waits for a clean file attachment before caching for a background lock', async () => {
        const originalCacheStorage = Storage.cache;
        const writes = [];
        let resolveBinary;
        Storage.cache = {
            save(_id, _opts, data, callback) {
                writes.push([...new Uint8Array(data)]);
                callback();
            }
        };
        const fileInfo = {
            id: 'file',
            set(values) {
                Object.assign(this, values);
            }
        };
        const file = {
            id: 'file',
            name: 'Main',
            active: true,
            storage: 'androiddoc',
            path: 'content://doc',
            dirty: false,
            modified: false,
            pendingMutations: 0,
            editVersion: 0,
            set(values) {
                Object.assign(this, values);
            },
            setModified() {
                this.set({ modified: true, dirty: true, editVersion: this.editVersion + 1 });
            },
            getData(callback) {
                callback(new Uint8Array([entry.binaries.size]).buffer);
            },
            getLocalEditState() {
                return null;
            },
            db: {
                createBinary() {
                    return new Promise((resolve) => {
                        resolveBinary = resolve;
                    });
                }
            }
        };
        const entry = {
            fields: new Map(),
            binaries: new Map(),
            times: { update() {} },
            pushHistory() {}
        };
        const entryModel = new EntryModel();
        entryModel.entry = entry;
        entryModel.file = file;
        entryModel._fillByEntry = () => {};
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        let completed = 0;
        try {
            const adding = entryModel.addAttachment('report.pdf', new Uint8Array([1]));
            expect(file.pendingMutations).to.equal(1);
            appModel.cacheFileForLock(file, () => completed++);
            expect(writes).to.eql([]);

            resolveBinary('binary');
            await adding;

            expect(writes).to.eql([[1]]);
            expect(completed).to.equal(1);
            expect(file.pendingMutations).to.equal(0);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('serializes duplicate lock caches and rejects competing syncs until the cache completes', () => {
        const originalCacheStorage = Storage.cache;
        const originalDocumentStorage = Storage.androiddoc;
        let completeCache;
        let cacheWrites = 0;
        let documentStats = 0;
        const completed = [];
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                cacheWrites++;
                completeCache = callback;
            }
        };
        Storage.androiddoc = {
            stat() {
                documentStats++;
            }
        };
        const fileInfo = {
            id: 'file',
            set() {}
        };
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
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        try {
            appModel.cacheFileForLock(file, (err) =>
                completed.push((err || 'first') + ':' + file.lockCacheInProgress)
            );
            appModel.cacheFileForLock(file, (err) =>
                completed.push((err || 'second') + ':' + file.lockCacheInProgress)
            );
            expect(file.lockCacheInProgress).to.equal(true);
            expect(cacheWrites).to.equal(1);

            appModel.syncFile(file, null, (err) => completed.push(err));
            expect(documentStats).to.equal(0);
            expect(completed).to.eql(['Lock cache in progress']);

            completeCache();
            expect(file.lockCacheInProgress).to.equal(false);
            expect(completed).to.eql(['Lock cache in progress', 'first:false', 'second:false']);
        } finally {
            Storage.cache = originalCacheStorage;
            Storage.androiddoc = originalDocumentStorage;
        }
    });

    it('waits for an in-flight sync to unwind before caching the latest dirty data', async () => {
        const originalCacheStorage = Storage.cache;
        const calls = [];
        Storage.cache = {
            save(_id, _opts, data, callback) {
                calls.push(data);
                callback();
            }
        };
        let resume;
        const fileInfo = {
            id: 'file',
            set() {}
        };
        const file = {
            id: 'file',
            name: 'Main',
            active: true,
            storage: 'androiddoc',
            path: 'content://doc',
            dirty: true,
            syncing: true,
            set(values) {
                Object.assign(this, values);
            },
            once(event, callback) {
                expect(event).to.equal('change:syncing');
                resume = callback;
            },
            getData(callback) {
                callback(new Uint8Array([this.latest ? 2 : 1]).buffer);
            },
            getLocalEditState() {
                return null;
            }
        };
        const appModel = {
            ...AppModelSyncMixin,
            fileInfos: { get: () => fileInfo, save() {} },
            getFileInfo: () => fileInfo,
            getStoreOpts: () => null
        };
        try {
            appModel.cacheFileForLock(file);
            expect(calls).to.eql([]);

            file.syncing = false;
            resume(file, false);
            file.latest = true;
            expect(calls).to.eql([]);

            await Promise.resolve();
            expect([...new Uint8Array(calls[0])]).to.eql([2]);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });
});

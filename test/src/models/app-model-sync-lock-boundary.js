import { expect } from 'chai';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { Storage } from 'storage';
import { fileInfo, syncedFile } from 'test/src/models/app-model-sync-test-helpers';

describe('AppModelSyncMixin lock boundary', () => {
    it('reports a current sync completion even when the file has no open marker', () => {
        const file = syncedFile({ open: false, editVersion: 0 });

        const savedCurrentVersion = file.setSyncComplete(null, null, null, { editVersion: 0 });

        expect(savedCurrentVersion).to.equal(true);
        expect(file.modified).to.equal(false);
        expect(file.dirty).to.equal(false);
    });

    it('keeps later edits dirty when normal sync only persisted an older edit version', () => {
        const originalCacheStorage = Storage.cache;
        const writes = [];
        let finishSave;
        Storage.cache = {
            save(_id, _opts, data, callback) {
                writes.push([...new Uint8Array(data)]);
                finishSave = callback;
            }
        };
        const info = fileInfo({ recoveryVersion: 'recovery-token:0' });
        const file = syncedFile();
        const completed = [];
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: { get: () => info, save() {} },
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };

        try {
            appModel.syncFile(file, null, (err) => completed.push(err || null));
            expect(writes).to.eql([[1]]);

            file.setModified();
            finishSave();

            expect(completed).to.eql([null]);
            expect(file.modified).to.equal(true);
            expect(file.dirty).to.equal(true);
            expect(file.syncing).to.equal(false);
            expect(file.db.removedLocalEditState).to.equal(0);
            expect(info.modified).to.equal(true);
            expect(info.editState).to.eql({ editVersion: 1 });
            expect(info.recoveryVersion).to.equal('recovery-token:0');
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('retries serialization when the edit version changes before data is returned', () => {
        const originalCacheStorage = Storage.cache;
        const writes = [];
        const finishGetData = [];
        Storage.cache = {
            save(_id, _opts, data, callback) {
                writes.push([...new Uint8Array(data)]);
                callback();
            }
        };
        const info = fileInfo({ recoveryVersion: 'recovery-token:0' });
        const file = syncedFile({
            getData(callback) {
                const bytes = this.editVersion + 1;
                finishGetData.push(() => callback(new Uint8Array([bytes]).buffer));
            }
        });
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: { get: () => info, save() {} },
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };

        try {
            appModel.syncFile(file);
            file.setModified();
            finishGetData.shift()();
            expect(writes).to.eql([]);
            finishGetData.shift()();

            expect(writes).to.eql([[2]]);
            expect(file.modified).to.equal(false);
            expect(file.dirty).to.equal(false);
            expect(file.db.removedLocalEditState).to.equal(1);
            expect(info.editState).to.equal(null);
            expect(info.recoveryVersion).to.equal(null);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('clears only the matching recovery record after a current normal sync is durably saved', async () => {
        const originalCacheStorage = Storage.cache;
        const cleared = [];
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                callback();
            },
            clearRecovery(id, _opts, recoveryVersion, callback) {
                cleared.push({ id, recoveryVersion });
                callback(null, { cleared: true });
            }
        };
        const info = fileInfo({ recoveryVersion: 'recovery-token:0' });
        const file = syncedFile();
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: {
                get: () => info,
                save() {
                    return Promise.resolve();
                }
            },
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };

        try {
            appModel.syncFile(file);
            await Promise.resolve();

            expect(cleared).to.have.length(1);
            expect(cleared[0].id).to.equal('file');
            expect(cleared[0].recoveryVersion).to.equal('recovery-token:0');
            expect(info.recoveryVersion).to.equal(null);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('does not clear recovery when normal sync persisted an older edit version', async () => {
        const originalCacheStorage = Storage.cache;
        let finishSave;
        let clearCalls = 0;
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                finishSave = callback;
            },
            clearRecovery(_id, _opts, _recoveryVersion, callback) {
                clearCalls++;
                callback();
            }
        };
        const info = fileInfo();
        const file = syncedFile();
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: {
                get: () => info,
                save() {
                    return Promise.resolve();
                }
            },
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };

        try {
            appModel.syncFile(file);
            file.setModified();
            finishSave();
            await Promise.resolve();

            expect(clearCalls).to.equal(0);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('does not clear a recovery snapshot created after the normal sync started', async () => {
        const originalCacheStorage = Storage.cache;
        let finishSave;
        let clearCalls = 0;
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                finishSave = callback;
            },
            clearRecovery(_id, _opts, _recoveryVersion, callback) {
                clearCalls++;
                callback();
            }
        };
        const info = fileInfo();
        const file = syncedFile();
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: {
                get: () => info,
                save() {
                    return Promise.resolve();
                }
            },
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };

        try {
            appModel.syncFile(file);
            info.recoveryVersion = 'new-lock-snapshot:0';
            finishSave();
            await Promise.resolve();

            expect(clearCalls).to.equal(0);
            expect(info.recoveryVersion).to.equal('new-lock-snapshot:0');
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('does not mark a closed file complete after metadata persistence settles', async () => {
        const originalCacheStorage = Storage.cache;
        let resolveFileInfos;
        let setSyncCompleteCalls = 0;
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                callback();
            },
            saveRecovery(_id, _opts, _data, _metadata, _version, callback) {
                callback();
            },
            clearRecovery(_id, _opts, _version, callback) {
                callback();
            }
        };
        const info = fileInfo();
        const file = syncedFile({
            setSyncComplete() {
                setSyncCompleteCalls++;
                this.active = true;
                return true;
            }
        });
        const completed = [];
        const appModel = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: {
                get: () => info,
                save() {
                    return new Promise((resolve) => {
                        resolveFileInfos = resolve;
                    });
                }
            },
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };
        try {
            appModel.syncFile(file, null, (err) => completed.push(err));
            file.close?.();
            file.active = false;
            resolveFileInfos();
            await Promise.resolve();

            expect(completed).to.eql(['File is closed']);
            expect(setSyncCompleteCalls).to.equal(0);
            expect(file.active).to.equal(false);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('keeps a current normal snapshot recoverable when metadata persistence fails', async () => {
        const originalCacheStorage = Storage.cache;
        const recoveryWrites = [];
        let clearCalls = 0;
        const quotaError = new Error('QuotaExceededError');
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                callback();
            },
            saveRecovery(_id, _opts, data, metadata, recoveryVersion, callback) {
                recoveryWrites.push({
                    bytes: [...new Uint8Array(data)],
                    metadata,
                    recoveryVersion
                });
                callback();
            },
            clearRecovery(_id, _opts, _recoveryVersion, callback) {
                clearCalls++;
                callback();
            }
        };
        const info = fileInfo({
            recoveryVersion: 'old-recovery:0',
            keyFileName: 'old.key',
            keyFileHash: 'old-hash'
        });
        const file = syncedFile({
            keyFileName: 'new.key',
            getKeyFileHash() {
                return 'new-hash';
            },
            getData(callback) {
                callback(new Uint8Array([9]).buffer);
            }
        });
        const completed = [];
        const appModel = {
            ...AppModelSyncMixin,
            settings: { rememberKeyFiles: 'data' },
            fileInfos: {
                get: () => info,
                save() {
                    return Promise.reject(quotaError);
                }
            },
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };

        try {
            appModel.syncFile(file, null, (err) => completed.push(err));
            await Promise.resolve();

            expect(recoveryWrites).to.have.length(1);
            expect(recoveryWrites[0].bytes).to.eql([9]);
            expect(recoveryWrites[0].metadata.keyFileName).to.equal('new.key');
            expect(recoveryWrites[0].metadata.keyFileHash).to.equal('new-hash');
            expect(recoveryWrites[0].metadata.recoveryVersion).to.equal(
                recoveryWrites[0].recoveryVersion
            );
            expect(clearCalls).to.equal(0);
            expect(file.modified).to.equal(true);
            expect(file.dirty).to.equal(true);
            expect(completed).to.eql([quotaError]);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });
});

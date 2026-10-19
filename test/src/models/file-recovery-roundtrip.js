import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { FileModel } from 'models/file-model';
import { FileInfoModel } from 'models/file-info-model';
import { IoBrowserCache } from 'storage/io-browser-cache';
import { Storage } from 'storage';

function checked(start) {
    return new Promise((resolve, reject) =>
        start((err, result) => (err ? reject(err) : resolve(result)))
    );
}

describe('Encrypted file recovery roundtrip', () => {
    it('reopens committed bytes with the matching changed and removed key factors after cache restart', async () => {
        const originalStorage = Storage.cache;
        const cache = new IoBrowserCache({
            cacheName: `FileRecoveryRoundtrip-${Date.now()}-${Math.random()}`,
            logger: { debug() {}, error() {}, ts: () => 0 }
        });
        Storage.cache = {
            saveRecovery(id, _opts, data, info, version, cb) {
                cache.saveRecovery(id, data, info, version, cb);
            }
        };
        const file = new FileModel({ id: 'fixture-recovery' });
        const reopened = new FileModel();
        file.create('Disposable fixture', () => {});
        file.db.setVersion(3);
        file.db.header.keyEncryptionRounds = 10;
        const password = kdbxweb.ProtectedValue.fromString('fake-recovery-password');
        const info = new FileInfoModel({ id: file.id, keyFileName: 'old.key', keyFileHash: 'old' });
        const infos = [info];
        infos.get = (id) => infos.find((item) => item.id === id);
        infos.save = () => {
            throw new Error('Emergency recovery must not depend on the settings mirror');
        };
        const model = {
            ...AppModelSyncMixin,
            settings: { rememberKeyFiles: 'data' },
            fileInfos: infos,
            getFileInfo: () => info,
            getStoreOpts: () => null
        };

        try {
            await file.setPassword(password);
            await file.setKeyFile(new Uint8Array(32).fill(7).buffer, 'new.key');
            await checked((cb) => model.cacheFileForLock(file, cb));
            cache.db.close();
            cache.db = null;
            let record = await checked((cb) => cache.loadRecovery(file.id, cb));
            expect(record.fileInfo.keyFileName).to.equal('new.key');
            expect(record.fileInfo.encryptedPassword).to.equal(null);
            await checked((cb) =>
                reopened.open(
                    password,
                    record.data,
                    FileModel.createKeyFileWithHash(record.fileInfo.keyFileHash),
                    cb
                )
            );
            expect(reopened.db.meta.name).to.equal('Disposable fixture');

            await file.removeKeyFile();
            await checked((cb) => model.cacheFileForLock(file, cb));
            cache.db.close();
            cache.db = null;
            record = await checked((cb) => cache.loadRecovery(file.id, cb));
            expect(record.fileInfo.keyFileName).to.equal(null);
            expect(record.fileInfo.keyFileHash).to.equal(null);
            await checked((cb) => reopened.open(password, record.data, null, cb));
            expect(reopened.db.credentials.keyFileHash).to.not.exist;
        } finally {
            Storage.cache = originalStorage;
            file.close();
            reopened.close();
            cache.db?.close();
            await checked((cb) => {
                const request = indexedDB.deleteDatabase(cache.cacheName);
                request.onsuccess = () => cb();
                request.onerror = () => cb(request.error);
            });
        }
    });

    it('reopens normal cache bytes after a password reset races with serialization', async () => {
        const originalStorage = Storage.cache;
        const cache = new IoBrowserCache({
            cacheName: `FileRecoveryResetOverSave-${Date.now()}-${Math.random()}`,
            logger: { debug() {}, error() {}, ts: () => 0 }
        });
        Storage.cache = {
            save(id, _opts, data, cb) {
                cache.save(id, data, cb);
            },
            load(id, _opts, cb) {
                cache.load(id, cb);
            },
            saveRecovery(id, _opts, data, info, version, cb) {
                cache.saveRecovery(id, data, info, version, cb);
            },
            clearRecovery(id, _opts, version, cb) {
                cache.clearRecovery(id, version, cb);
            }
        };
        const id = 'fixture-reset-over-save';
        const file = new FileModel({ id });
        const reopened = new FileModel();
        const info = new FileInfoModel({ id, modified: true });
        const infos = [info];
        infos.get = (itemId) => infos.find((item) => item.id === itemId);
        infos.save = () => Promise.resolve();
        const model = {
            ...AppModelSyncMixin,
            settings: {},
            fileInfos: infos,
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };
        const originalGetData = FileModel.prototype.getData;

        try {
            file.create('Reset race fixture', () => {});
            file.db.setVersion(3);
            file.db.header.keyEncryptionRounds = 10;
            const newPassword = kdbxweb.ProtectedValue.fromString('new-password');
            await file.setPassword(newPassword);
            const newPasswordData = await checked((cb) =>
                originalGetData.call(file, (data, err) => cb(err, data))
            );
            let firstGetData;
            FileModel.prototype.getData = function (callback) {
                if (this === file && !firstGetData) {
                    firstGetData = () => callback(newPasswordData);
                } else {
                    originalGetData.call(this, callback);
                }
            };

            const syncing = checked((cb) => model.syncFile(file, null, cb));
            expect(firstGetData).to.be.a('function');
            await file.resetPassword();
            firstGetData();
            await syncing;

            cache.db.close();
            cache.db = null;
            const cached = await checked((cb) => cache.load(id, cb));
            const emptyPassword = kdbxweb.ProtectedValue.fromString('');
            await checked((cb) => reopened.open(emptyPassword, cached, null, cb));
            expect(reopened.db.meta.name).to.equal('Reset race fixture');
        } finally {
            Storage.cache = originalStorage;
            FileModel.prototype.getData = originalGetData;
            file.close();
            reopened.close();
            cache.db?.close();
            await checked((cb) => {
                const request = indexedDB.deleteDatabase(cache.cacheName);
                request.onsuccess = () => cb();
                request.onerror = () => cb(request.error);
            });
        }
    });

    it('does not let a closed file delayed normal cache write overwrite newer recovery for the same id', async () => {
        const originalStorage = Storage.cache;
        const cache = new IoBrowserCache({
            cacheName: `FileRecoveryClosedOverwrite-${Date.now()}-${Math.random()}`,
            logger: { debug() {}, error() {}, ts: () => 0 }
        });
        Storage.cache = {
            save(id, _opts, data, cb) {
                cache.save(id, data, cb);
            },
            saveRecovery(id, _opts, data, info, version, cb) {
                cache.saveRecovery(id, data, info, version, cb);
            },
            clearRecovery(id, _opts, version, cb) {
                cache.clearRecovery(id, version, cb);
            }
        };
        const id = 'fixture-recovery-same-id';
        const oldFile = new FileModel({ id });
        const freshFile = new FileModel({ id });
        const reopened = new FileModel();
        const info = new FileInfoModel({ id, modified: true });
        const infos = [info];
        infos.get = (itemId) => infos.find((item) => item.id === itemId);
        infos.save = () => Promise.resolve();
        const model = {
            ...AppModelSyncMixin,
            settings: { rememberKeyFiles: 'data' },
            fileInfos: infos,
            getFileInfo: () => info,
            getStoreOpts: () => null,
            scheduleBackupFile() {}
        };
        const originalGetData = FileModel.prototype.getData;

        try {
            oldFile.create('Old fixture', () => {});
            freshFile.create('Fresh fixture', () => {});
            oldFile.db.setVersion(3);
            freshFile.db.setVersion(3);
            oldFile.db.header.keyEncryptionRounds = 10;
            freshFile.db.header.keyEncryptionRounds = 10;
            oldFile.set({ modified: true, dirty: true });
            freshFile.set({ modified: true, dirty: true });
            let releaseOldSerialization;
            FileModel.prototype.getData = function (callback) {
                if (this === oldFile) {
                    releaseOldSerialization = () => originalGetData.call(this, callback);
                } else {
                    originalGetData.call(this, callback);
                }
            };
            const oldSync = checked((cb) => model.syncFile(oldFile, null, cb));
            expect(releaseOldSerialization).to.be.a('function');

            oldFile.close();
            await checked((cb) => model.cacheFileForLock(freshFile, cb));
            releaseOldSerialization();
            let oldError;
            try {
                await oldSync;
            } catch (e) {
                oldError = e;
            }
            expect(oldError).to.equal('File is closed');

            cache.db.close();
            cache.db = null;
            const record = await checked((cb) => cache.loadRecovery(id, cb));
            const emptyPassword = kdbxweb.ProtectedValue.fromString('');
            await checked((cb) => reopened.open(emptyPassword, record.data, null, cb));
            expect(reopened.db.meta.name).to.equal('Fresh fixture');
        } finally {
            Storage.cache = originalStorage;
            FileModel.prototype.getData = originalGetData;
            oldFile.close();
            freshFile.close();
            reopened.close();
            cache.db?.close();
            await checked((cb) => {
                const request = indexedDB.deleteDatabase(cache.cacheName);
                request.onsuccess = () => cb();
                request.onerror = () => cb(request.error);
            });
        }
    });
});

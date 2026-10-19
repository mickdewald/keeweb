import { expect } from 'chai';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { Storage } from 'storage';
import { fileInfo, syncedFile } from 'test/src/models/app-model-sync-test-helpers';

function lockCacheModel(info, settings = {}) {
    return {
        ...AppModelSyncMixin,
        settings,
        fileInfos: { get: () => info, save() {} },
        getFileInfo: () => info,
        getStoreOpts: () => null
    };
}

describe('AppModelSyncLockCacheMixin', () => {
    it('never commits stale bytes with a key factor changed during lock serialization', () => {
        const originalStorage = Storage.cache;
        const writes = [];
        const serializationCallbacks = [];
        Storage.cache = {
            saveRecovery(_id, _opts, data, metadata, _version, cb) {
                writes.push({ bytes: [...new Uint8Array(data)], metadata });
                cb();
            }
        };
        const file = syncedFile({
            keyFileName: 'old.key',
            keyFileHash: 'old-hash',
            getKeyFileHash() {
                return this.keyFileHash;
            },
            getData(callback) {
                serializationCallbacks.push(callback);
            }
        });
        const info = fileInfo();
        const model = lockCacheModel(info, { rememberKeyFiles: 'data' });
        try {
            model.cacheFileForLock(file);
            file.keyFileName = 'new.key';
            file.keyFileHash = 'new-hash';
            file.keyFileChanged = true;
            file.setModified();
            serializationCallbacks.shift()(new Uint8Array([1]).buffer);
            expect(writes).to.eql([]);
            serializationCallbacks.shift()(new Uint8Array([2]).buffer);
            expect(writes).to.have.length(1);
            expect(writes[0].bytes).to.eql([2]);
            expect(writes[0].metadata.keyFileHash).to.equal('new-hash');
            expect(writes[0].metadata.encryptedPassword).to.equal(null);
        } finally {
            Storage.cache = originalStorage;
        }
    });

    it('recaches after a password reset changes credentials during lock serialization', async () => {
        const originalCacheStorage = Storage.cache;
        const writes = [];
        const serializationCallbacks = [];
        Storage.cache = {
            saveRecovery(_id, _opts, data, metadata, _version, cb) {
                writes.push({ bytes: [...new Uint8Array(data)], metadata });
                cb();
            }
        };
        const file = syncedFile({
            passwordChanged: true,
            encryptedPassword: null,
            encryptedPasswordDate: null,
            oldPasswordHash: 'old-password-hash',
            oldKeyFileHash: null,
            oldKeyChangeDate: new Date(0),
            oldPasswordLength: 8,
            db: {
                credentials: { passwordHash: 'new-password-hash', keyFileHash: null },
                meta: {},
                removedLocalEditState: 0,
                removeLocalEditState() {
                    this.removedLocalEditState++;
                }
            },
            getData(callback) {
                serializationCallbacks.push(callback);
            }
        });
        const info = fileInfo({ encryptedPassword: 'old-password-blob' });
        const model = lockCacheModel(info);
        try {
            model.cacheFileForLock(file);
            await file.resetPassword();
            serializationCallbacks.shift()(new Uint8Array([1]).buffer);
            expect(writes).to.eql([]);
            serializationCallbacks.shift()(new Uint8Array([2]).buffer);
            expect(writes).to.have.length(1);
            expect(writes[0].bytes).to.eql([2]);
            expect(writes[0].metadata.encryptedPassword).to.equal('old-password-blob');
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });

    it('updates emergency cache credentials to the current key factor and clears stale biometric password blobs', () => {
        const originalCacheStorage = Storage.cache;
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                callback();
            }
        };
        const info = fileInfo({
            keyFileName: 'old.key',
            keyFileHash: 'old-hash',
            encryptedPassword: 'old-password-blob',
            encryptedPasswordDate: new Date()
        });
        const file = syncedFile({
            keyFileName: 'new.key',
            passwordChanged: true,
            encryptedPassword: null,
            encryptedPasswordDate: new Date(),
            getKeyFileHash() {
                return 'new-hash';
            }
        });
        const appModel = lockCacheModel(info, { rememberKeyFiles: 'data' });

        try {
            appModel.cacheFileForLock(file);
            expect(info.keyFileName).to.equal('new.key');
            expect(info.keyFileHash).to.equal('new-hash');
            expect(info.encryptedPassword).to.equal(null);
            expect(info.encryptedPasswordDate).to.equal(null);
        } finally {
            Storage.cache = originalCacheStorage;
        }
    });
});

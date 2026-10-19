import { expect } from 'chai';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { AppModelFileOpenMixin } from 'models/app-model-file-open';
import { Storage } from 'storage';
import { fileInfo, syncedFile } from 'test/src/models/app-model-sync-test-helpers';

describe('Android same-document recovery and capability', () => {
    let oldCache;
    let oldDocuments;

    beforeEach(() => {
        oldCache = Storage.cache;
        oldDocuments = Storage.androiddoc;
    });

    afterEach(() => {
        Storage.cache = oldCache;
        Storage.androiddoc = oldDocuments;
    });

    function setup(settings = {}, attributes = {}) {
        const calls = [];
        const info = fileInfo({ storage: 'androiddoc', path: 'content://fixture', rev: 'before' });
        const file = syncedFile({
            storage: 'androiddoc',
            path: info.path,
            opts: { writable: true },
            ...attributes
        });
        Storage.androiddoc = {
            stat(_path, _opts, callback) {
                callback(null, { rev: 'before', writable: true });
            },
            save(_path, _opts, _data, callback) {
                calls.push('write');
                callback(null, { rev: 'after' });
            }
        };
        const model = {
            ...AppModelSyncMixin,
            settings,
            fileInfos: { get: () => info, save() {} },
            getFileInfo: () => info,
            getStoreOpts: (f) => f.opts,
            scheduleBackupFile() {}
        };
        return { calls, info, file, model };
    }

    it('waits for durable credential recovery before a document write even with offline storage disabled', () => {
        const { calls, file, model } = setup({ disableOfflineStorage: true }, { dirty: false });
        let commit;
        let metadata;
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                calls.push('cache');
                callback();
            },
            saveRecovery(_id, _opts, _data, values, _version, callback) {
                metadata = values;
                commit = callback;
            },
            clearRecovery(_id, _opts, _version, callback) {
                callback();
            }
        };
        model.syncFile(file);
        expect(calls).to.eql(['cache']);
        expect(commit).to.be.a('function');
        expect(metadata.modified).to.equal(true);
        commit();
        expect(calls).to.eql(['cache', 'write']);
        expect(file.modified).to.equal(false);
    });

    it('does not write or mark edits synced when durable recovery fails', () => {
        const { calls, file, model } = setup({ disableOfflineStorage: true });
        const failure = new Error('recovery quota exhausted');
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                calls.push('cache');
                callback();
            },
            saveRecovery(_id, _opts, _data, _metadata, _version, callback) {
                callback(failure);
            }
        };
        let result;
        model.syncFile(file, null, (err) => {
            result = err;
        });
        expect(calls).to.eql(['cache']);
        expect(result).to.equal(failure);
        expect(file.modified).to.equal(true);
        expect(file.dirty).to.equal(true);
    });

    it('refuses a document write if atomic recovery storage is unavailable', () => {
        const { calls, file, model } = setup();
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                callback();
            }
        };
        let result;
        model.syncFile(file, null, (err) => {
            result = err;
        });
        expect(calls).to.eql([]);
        expect(result.code).to.equal('RECOVERY_UNAVAILABLE');
        expect(file.modified).to.equal(true);
    });

    it('updates and persists write capability from live stat without changing document identity', () => {
        const { info, file, model } = setup({}, { modified: false, dirty: false });
        Storage.androiddoc.stat = (_path, _opts, callback) =>
            callback(null, { rev: 'before', writable: false });
        model.syncFile(file);
        expect(file.opts.writable).to.equal(false);
        expect(info.opts.writable).to.equal(false);
        expect(file.path).to.equal('content://fixture');
    });

    it('persists changed credential metadata before removing successful write recovery', () => {
        const { info, file, model } = setup(
            { rememberKeyFiles: 'data' },
            {
                passwordChanged: true,
                keyFileChanged: true,
                keyFileName: 'new.key',
                encryptedPassword: 'old-biometric-blob',
                getKeyFileHash: () => 'new-key-hash'
            }
        );
        Object.assign(info, {
            encryptedPassword: 'old-biometric-blob',
            encryptedPasswordDate: 'old-date',
            keyFileName: 'old.key',
            keyFileHash: 'old-key-hash',
            keyFilePath: 'content://old-key'
        });
        const persisted = [];
        model.fileInfos.save = () => {
            persisted.push({ ...info });
        };
        Storage.cache = {
            save(_id, _opts, _data, callback) {
                callback();
            },
            saveRecovery(_id, _opts, _data, _metadata, _version, callback) {
                callback();
            },
            clearRecovery(_id, _opts, _version, callback) {
                expect(persisted).to.have.length(1);
                expect(persisted[0].encryptedPassword).to.equal(null);
                expect(persisted[0].encryptedPasswordDate).to.equal(null);
                expect(persisted[0].keyFileName).to.equal('new.key');
                expect(persisted[0].keyFileHash).to.equal('new-key-hash');
                expect(persisted[0].keyFilePath).to.equal(null);
                callback();
            }
        };
        model.syncFile(file);
        expect(file.modified).to.equal(false);
    });

    for (const cached of [false, true]) {
        it(`uses fresh provider write capability when opening ${
            cached ? 'matching cache' : 'provider bytes'
        }`, () => {
            const params = {
                storage: 'androiddoc',
                path: 'content://fixture',
                opts: { writable: true }
            };
            Storage.androiddoc = {
                name: 'androiddoc',
                stat(_path, _opts, callback) {
                    callback(null, { rev: 'before', writable: false });
                },
                load(_path, _opts, callback) {
                    callback(null, new Uint8Array([1]).buffer, { rev: 'before', writable: false });
                }
            };
            let opened;
            const model = {
                ...AppModelFileOpenMixin,
                settings: {},
                openFileWithData(values) {
                    opened = values;
                },
                openFileFromCache(values) {
                    opened = values;
                }
            };
            model.openFileFromStorage(params, () => {}, cached ? { rev: 'before' } : null, {
                info() {}
            });
            expect(opened.opts.writable).to.equal(false);
        });
    }
});

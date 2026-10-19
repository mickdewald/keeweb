import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { FileInfoModel } from 'models/file-info-model';
import { FileModel } from 'models/file-model';
import { IoBrowserCache } from 'storage/io-browser-cache';
import { Storage } from 'storage';

const password = 'disposable-concurrency-fixture-password';

function callbackResult(start) {
    return new Promise((resolve, reject) =>
        start((err, value) => (err ? reject(err) : resolve(value)))
    );
}

async function serialize(file) {
    return callbackResult((callback) => file.getData((data, err) => callback(err, data)));
}

async function open(data, id, keyFileData = null, passwordText = password) {
    const file = new FileModel({
        id,
        name: 'Disposable Android concurrency fixture',
        storage: 'androiddoc',
        path: 'content://concurrency-fixture',
        opts: { writable: true }
    });
    await callbackResult((callback) =>
        file.open(
            kdbxweb.ProtectedValue.fromString(passwordText),
            data,
            keyFileData?.slice(),
            callback
        )
    );
    return file;
}

function entry(file, title) {
    return file.db.getDefaultGroup().entries.find((item) => item.fields.get('Title') === title);
}

function addEntry(file, title, notes, timestamp) {
    const item = file.db.createEntry(file.db.getDefaultGroup());
    item.fields.set('Title', title);
    item.fields.set('Notes', notes);
    item.times.lastModTime = new Date(timestamp);
    item.parentGroup.times.lastModTime = new Date('2030-01-01T00:00:00.000Z');
    file.setModified();
}

function changeNotes(file, title, notes, timestamp) {
    const item = entry(file, title);
    item.pushHistory();
    item.fields.set('Notes', notes);
    item.times.lastModTime = new Date(timestamp);
    item.parentGroup.times.lastModTime = new Date('2030-01-01T00:00:00.000Z');
    file.setModified();
}

function noteVersions(file, title) {
    const item = entry(file, title);
    return [item, ...item.history].map((version) => version.fields.get('Notes'));
}

async function fixture({ titles = ['Shared'], keyFileData = null, keyChanged = null } = {}) {
    const seed = new FileModel({ id: 'concurrency-seed' });
    try {
        seed.create('Disposable Android concurrency fixture', () => {});
        seed.db.setVersion(3);
        seed.db.header.keyEncryptionRounds = 10;
        await seed.setPassword(kdbxweb.ProtectedValue.fromString(password));
        if (keyFileData) {
            await seed.setKeyFile(keyFileData.slice(), 'fixture.key');
        }
        if (keyChanged) {
            seed.db.meta.keyChanged = new Date(keyChanged);
        }
        for (const title of titles) {
            const item = seed.db.createEntry(seed.db.getDefaultGroup());
            item.fields.set('Title', title);
            item.fields.set('Notes', 'base');
            item.times.lastModTime = new Date('2026-10-01T08:00:00.000Z');
        }
        return await serialize(seed);
    } finally {
        seed.close();
    }
}

describe('Android same-document concurrency merge semantics', () => {
    it('retains independent encrypted entries added by Android and the remote replica', async () => {
        const data = await fixture();
        const android = await open(data, 'concurrency-independent-android');
        const remote = await open(data, 'concurrency-independent-remote');
        let reopened;

        try {
            addEntry(android, 'Android entry', 'android-only', '2026-10-01T08:01:00.000Z');
            addEntry(remote, 'Remote entry', 'remote-only', '2026-10-01T08:02:00.000Z');
            const remoteData = await serialize(remote);

            await callbackResult((callback) => android.mergeOrUpdate(remoteData, null, callback));
            reopened = await open(await serialize(android), 'concurrency-independent-reopened');

            expect(entry(reopened, 'Android entry').fields.get('Notes')).to.equal('android-only');
            expect(entry(reopened, 'Remote entry').fields.get('Notes')).to.equal('remote-only');
        } finally {
            android.close();
            remote.close();
            reopened?.close();
        }
    });

    it('retains competing same-entry edits in encrypted history', async () => {
        const data = await fixture();
        const android = await open(data, 'concurrency-history-android');
        const remote = await open(data, 'concurrency-history-remote');
        let reopened;

        try {
            changeNotes(android, 'Shared', 'android edit', '2026-10-01T08:02:00.000Z');
            changeNotes(remote, 'Shared', 'remote edit', '2026-10-01T08:03:00.000Z');
            const remoteData = await serialize(remote);

            await callbackResult((callback) => android.mergeOrUpdate(remoteData, null, callback));
            reopened = await open(await serialize(android), 'concurrency-history-reopened');

            expect(noteVersions(reopened, 'Shared')).to.include('android edit');
            expect(noteVersions(reopened, 'Shared')).to.include('remote edit');
        } finally {
            android.close();
            remote.close();
            reopened?.close();
        }
    });

    it('honors a remote deletion tombstone over an unsynchronized Android edit', async () => {
        const data = await fixture({ titles: ['Deleted remotely'] });
        const android = await open(data, 'concurrency-delete-android');
        const remote = await open(data, 'concurrency-delete-remote');

        try {
            changeNotes(
                android,
                'Deleted remotely',
                'local edit before remote delete arrives',
                '2026-10-01T08:02:00.000Z'
            );
            remote.db.meta.recycleBinEnabled = false;
            remote.db.remove(entry(remote, 'Deleted remotely'));
            const remoteData = await serialize(remote);

            await callbackResult((callback) => android.mergeOrUpdate(remoteData, null, callback));

            expect(entry(android, 'Deleted remotely')).to.equal(undefined);
            expect(android.db.deletedObjects).to.have.length(1);
        } finally {
            android.close();
            remote.close();
        }
    });

    it('does not restore stale biometric metadata after a changed password fails to save', async () => {
        const originalCache = Storage.cache;
        const originalDocument = Storage.androiddoc;
        const data = await fixture();
        const android = await open(data, 'concurrency-failed-password-android');
        const info = new FileInfoModel({
            id: android.id,
            name: android.name,
            storage: android.storage,
            path: android.path,
            opts: android.opts,
            rev: 'initial-revision',
            encryptedPassword: 'old-biometric-blob',
            encryptedPasswordDate: new Date('2026-10-01T08:00:00.000Z')
        });
        const infos = [info];
        const cache = new IoBrowserCache({
            cacheName: `AndroidConcurrency-${Date.now()}-${Math.random()}`,
            logger: { debug() {}, error() {}, ts: () => 0 }
        });
        const providerFailure = new Error('provider offline');
        const newPassword = 'changed-disposable-password';
        let reopened;

        try {
            Storage.cache = {
                save(id, _opts, bytes, callback) {
                    cache.save(id, bytes, callback);
                },
                saveRecovery(id, _opts, bytes, metadata, version, callback) {
                    cache.saveRecovery(id, bytes, metadata, version, callback);
                },
                clearRecovery(id, _opts, version, callback) {
                    cache.clearRecovery(id, version, callback);
                }
            };
            Storage.androiddoc = {
                stat(_path, _opts, callback) {
                    callback(null, { rev: 'initial-revision', writable: true });
                },
                save(_path, _opts, _bytes, callback) {
                    callback(providerFailure);
                }
            };
            infos.get = (id) => infos.find((item) => item.id === id);
            infos.save = () => Promise.resolve();
            const appModel = {
                ...AppModelSyncMixin,
                settings: {},
                fileInfos: infos,
                getFileInfo: () => info,
                getStoreOpts: (file) => file.opts,
                refresh() {},
                scheduleBackupFile() {}
            };
            android.set({
                encryptedPassword: 'old-biometric-blob',
                encryptedPasswordDate: new Date('2026-10-01T08:00:00.000Z')
            });
            await android.setPassword(kdbxweb.ProtectedValue.fromString(newPassword));

            const syncResult = await new Promise((resolve) =>
                appModel.syncFile(android, null, resolve)
            );
            expect(syncResult).to.equal(providerFailure);
            expect(android.passwordChanged).to.equal(true);
            await callbackResult((callback) => appModel.cacheFileForLock(android, callback));

            cache.db.close();
            cache.db = null;
            const recovery = await callbackResult((callback) =>
                cache.loadRecovery(android.id, callback)
            );
            reopened = await open(
                recovery.data,
                'concurrency-failed-password-reopened',
                null,
                newPassword
            );

            expect(recovery.fileInfo.encryptedPassword).to.equal(null);
            expect(recovery.fileInfo.encryptedPasswordDate).to.equal(null);
            expect(reopened.db.meta.name).to.equal('Disposable Android concurrency fixture');
        } finally {
            Storage.cache = originalCache;
            Storage.androiddoc = originalDocument;
            android.close();
            reopened?.close();
            cache.db?.close();
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(cache.cacheName);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
    });

    it('propagates a newer remote key-file removal to another encrypted replica', async () => {
        const keyFile = await kdbxweb.Credentials.createKeyFileWithHash(
            new Uint8Array(32).fill(9).buffer
        );
        const previousKeyChanged = new Date('2026-10-01T08:00:00.000Z');
        const data = await fixture({ keyFileData: keyFile, keyChanged: previousKeyChanged });
        const remote = await open(data, 'concurrency-remove-key-remote', keyFile);
        const android = await open(data, 'concurrency-remove-key-android', keyFile);
        let passwordOnly;
        let oldKeyResult;

        try {
            await remote.removeKeyFile();
            expect(remote.db.meta.keyChanged.getTime()).to.be.greaterThan(
                previousKeyChanged.getTime()
            );
            const remoteData = await serialize(remote);

            await callbackResult((callback) =>
                android.mergeOrUpdate(
                    remoteData,
                    { password: kdbxweb.ProtectedValue.fromString(password), keyFileName: '' },
                    callback
                )
            );
            const finalData = await serialize(android);
            passwordOnly = await open(finalData, 'concurrency-remove-key-password-only');
            oldKeyResult = await new Promise((resolve) =>
                new FileModel({ id: 'concurrency-remove-key-old-key' }).open(
                    kdbxweb.ProtectedValue.fromString(password),
                    finalData,
                    keyFile.slice(),
                    (err) => resolve(err || null)
                )
            );

            expect(android.keyFileName).to.equal('');
            expect(oldKeyResult.code).to.equal('InvalidKey');
        } finally {
            remote.close();
            android.close();
            passwordOnly?.close();
        }
    });
});

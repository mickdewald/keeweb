import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { FileModel } from 'models/file-model';
import { FileInfoModel } from 'models/file-info-model';
import { IoBrowserCache } from 'storage/io-browser-cache';
import { Storage } from 'storage';

const password = 'disposable-write-failure-password';

function checked(start) {
    return new Promise((resolve, reject) =>
        start((err, result) => (err ? reject(err) : resolve(result)))
    );
}

function serialize(file) {
    return checked((cb) => file.getData((data, err) => cb(err, data)));
}

async function open(data, id) {
    const file = new FileModel({
        id,
        name: 'Disposable write failure fixture',
        storage: 'androiddoc',
        path: 'content://write-failure-fixture',
        opts: { writable: true }
    });
    await checked((cb) => file.open(kdbxweb.ProtectedValue.fromString(password), data, null, cb));
    return file;
}

function entry(file, title) {
    return file.db.getDefaultGroup().entries.find((item) => item.fields.get('Title') === title);
}

function change(file, title, value) {
    const item = entry(file, title);
    item.pushHistory();
    item.fields.set('Notes', value);
    item.times.lastModTime = new Date('2031-01-01T00:00:00.000Z');
    file.setModified();
}

async function fixture() {
    const seed = new FileModel({ id: 'write-failure-seed' });
    try {
        seed.create('Disposable write failure fixture', () => {});
        seed.db.setVersion(3);
        seed.db.header.keyEncryptionRounds = 10;
        await seed.setPassword(kdbxweb.ProtectedValue.fromString(password));
        seed.db.getDefaultGroup().times.lastModTime = new Date('2030-01-01T00:00:00.000Z');
        for (const title of ['Android', 'Mac']) {
            const item = seed.db.createEntry(seed.db.getDefaultGroup());
            item.fields.set('Title', title);
            item.fields.set('Notes', 'base');
            item.times.lastModTime = new Date('2030-01-01T00:00:00.000Z');
        }
        return await serialize(seed);
    } finally {
        seed.close();
    }
}

function modelFor(file, info) {
    const fileInfos = [info];
    fileInfos.get = (id) => fileInfos.find((item) => item.id === id);
    fileInfos.save = () => Promise.resolve();
    return {
        ...AppModelSyncMixin,
        settings: { disableOfflineStorage: true },
        fileInfos,
        getFileInfo: () => info,
        getStoreOpts: (current) => current.opts,
        refresh() {},
        scheduleBackupFile() {}
    };
}

function infoFor(file) {
    return new FileInfoModel({
        id: file.id,
        name: file.name,
        storage: file.storage,
        path: file.path,
        opts: file.opts,
        rev: 'initial-revision'
    });
}

describe('Android same-document write failures with encrypted recovery', () => {
    let cache;
    let originals;
    let files;

    beforeEach(() => {
        originals = { cache: Storage.cache, androiddoc: Storage.androiddoc };
        files = [];
        cache = new IoBrowserCache({
            cacheName: `AndroidWriteFailures-${Date.now()}-${Math.random()}`,
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
    });

    afterEach(async () => {
        Object.assign(Storage, originals);
        files.forEach((file) => file.close());
        cache.db?.close();
        await checked((cb) => {
            const request = indexedDB.deleteDatabase(cache.cacheName);
            request.onsuccess = () => cb();
            request.onerror = () => cb(request.error);
        });
    });

    it('reloads and preserves both edits when the provider changes after stat but before save', async () => {
        const initialBytes = await fixture();
        const android = await open(initialBytes, 'write-conflict-android');
        const mac = await open(initialBytes, 'write-conflict-mac');
        files.push(android, mac);
        change(android, 'Android', 'android edit');
        change(mac, 'Mac', 'mac edit between stat and save');
        const macBytes = await serialize(mac);
        let providerBytes = initialBytes;
        let providerRev = 'initial-revision';
        let changedBetweenStatAndSave = false;
        Storage.androiddoc = {
            stat(_path, _opts, cb) {
                cb(null, { rev: providerRev, writable: true });
            },
            load(_path, _opts, cb) {
                cb(null, providerBytes, { rev: providerRev, writable: true });
            },
            save(_path, _opts, data, cb, expectedRev) {
                if (!changedBetweenStatAndSave) {
                    changedBetweenStatAndSave = true;
                    providerBytes = macBytes;
                    providerRev = 'mac-revision';
                }
                if (expectedRev !== providerRev) {
                    return cb({ revConflict: true });
                }
                providerBytes = data;
                providerRev = 'merged-revision';
                cb(null, { rev: providerRev });
            }
        };
        const info = infoFor(android);
        await checked((cb) => modelFor(android, info).syncFile(android, null, cb));
        const final = await open(providerBytes, 'write-conflict-final');
        files.push(final);
        expect(entry(final, 'Android').fields.get('Notes')).to.equal('android edit');
        expect(entry(final, 'Mac').fields.get('Notes')).to.equal('mac edit between stat and save');
        expect(info.rev).to.equal('merged-revision');
        expect(android.modified).to.equal(false);
        expect(await checked((cb) => cache.loadRecovery(android.id, cb))).to.equal(undefined);
    });

    it('reopens encrypted recovery after failed provider save and clears it only after successful retry', async () => {
        let providerBytes = await fixture();
        const originalBytes = new Uint8Array(providerBytes);
        const android = await open(providerBytes, 'write-io-android');
        files.push(android);
        change(android, 'Android', 'recoverable Android edit');
        const failure = new Error('Injected provider write failure');
        let failWrite = true;
        Storage.androiddoc = {
            stat(_path, _opts, cb) {
                cb(null, { rev: 'initial-revision', writable: true });
            },
            save(_path, _opts, data, cb) {
                if (failWrite) {
                    return cb(failure);
                }
                providerBytes = data;
                cb(null, { rev: 'saved-revision' });
            }
        };
        const info = infoFor(android);
        const app = modelFor(android, info);
        const result = await new Promise((resolve) => app.syncFile(android, null, resolve));
        expect(result).to.equal(failure);
        expect(android.modified).to.equal(true);
        expect(android.syncing).to.equal(false);
        expect(new Uint8Array(providerBytes)).to.eql(originalBytes);

        cache.db.close();
        cache.db = null;
        const recovery = await checked((cb) => cache.loadRecovery(android.id, cb));
        expect(recovery.fileInfo.modified).to.equal(true);
        const reopened = await open(recovery.data, 'write-io-reopened');
        files.push(reopened);
        expect(entry(reopened, 'Android').fields.get('Notes')).to.equal('recoverable Android edit');

        failWrite = false;
        await checked((cb) => app.syncFile(android, null, cb));
        const final = await open(providerBytes, 'write-io-final');
        files.push(final);
        expect(entry(final, 'Android').fields.get('Notes')).to.equal('recoverable Android edit');
        expect(android.modified).to.equal(false);
        expect(info.modified).to.equal(false);
        expect(await checked((cb) => cache.loadRecovery(android.id, cb))).to.equal(undefined);
    });
});

import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { FileInfoModel } from 'models/file-info-model';
import { FileModel } from 'models/file-model';
import { Storage } from 'storage';

function callbackResult(start) {
    return new Promise((resolve, reject) =>
        start((err, value) => (err ? reject(err) : resolve(value)))
    );
}

async function serialize(file) {
    return new Promise((resolve, reject) =>
        file.getData((data, err) => (err ? reject(err) : resolve(data)))
    );
}

async function openFile(data, password, id) {
    const file = new FileModel({
        id,
        name: 'Same-file Android fixture',
        storage: 'androiddoc',
        path: 'content://fixture',
        opts: { writable: true }
    });
    await callbackResult((callback) =>
        file.open(kdbxweb.ProtectedValue.fromString(password), data, null, callback)
    );
    return file;
}

function entry(file, title) {
    return file.db.getDefaultGroup().entries.find((item) => item.fields.get('Title') === title);
}

function change(file, title, field, value, timestamp) {
    const item = entry(file, title);
    item.pushHistory();
    item.fields.set(field, value);
    item.times.lastModTime = new Date(timestamp);
    // KeePass merges groups before entries. Keep the common parent at one shared
    // version so this fixture exercises the entry-level merge rather than replacing
    // the whole group with one replica.
    item.parentGroup.times.lastModTime = new Date('2030-01-01T00:00:00.000Z');
    file.setModified();
}

function fieldValuesWithHistory(item, field) {
    return [item, ...item.history].map((version) => version.fields.get(field));
}

describe('Android same-document KDBX roundtrip', () => {
    it('merges concurrent Mac and Android edits through the document storage boundary', async () => {
        const originalDocumentStorage = Storage.androiddoc;
        const originalCacheStorage = Storage.cache;
        const password = 'same-file-fixture-password';
        const seed = new FileModel({ id: 'same-file-seed' });
        let androidFile;
        let macFile;
        let finalFile;

        try {
            seed.create('Same-file Android fixture', () => {});
            seed.db.setVersion(3);
            seed.db.header.keyEncryptionRounds = 10;
            await seed.setPassword(kdbxweb.ProtectedValue.fromString(password));
            for (const title of ['Shared', 'Android-only', 'Mac-only']) {
                const newEntry = seed.db.createEntry(seed.db.getDefaultGroup());
                newEntry.fields.set('Title', title);
                newEntry.fields.set('UserName', 'base-user');
                newEntry.fields.set('URL', 'https://base.example');
                newEntry.fields.set('Notes', 'base-note');
                newEntry.times.lastModTime = new Date('2026-10-01T10:00:00.000Z');
            }
            const initialBytes = await serialize(seed);

            androidFile = await openFile(initialBytes, password, 'same-file-android');
            macFile = await openFile(initialBytes, password, 'same-file-mac');
            change(
                androidFile,
                'Android-only',
                'UserName',
                'android-user',
                '2026-10-01T10:01:00.000Z'
            );
            change(androidFile, 'Shared', 'Notes', 'android-note', '2026-10-01T10:01:00.000Z');
            change(macFile, 'Mac-only', 'URL', 'https://mac.example', '2026-10-01T10:02:00.000Z');
            change(macFile, 'Shared', 'Notes', 'mac-note', '2026-10-01T10:02:00.000Z');

            let providerBytes = await serialize(macFile);
            let providerRev = 'mac-revision';
            Storage.androiddoc = {
                stat(_path, _opts, callback) {
                    callback(null, { rev: providerRev, writable: true });
                },
                load(_path, _opts, callback) {
                    callback(null, providerBytes, { rev: providerRev, writable: true });
                },
                save(_path, _opts, bytes, callback, expectedRev) {
                    expect(expectedRev).to.equal('mac-revision');
                    providerBytes = bytes;
                    providerRev = 'merged-revision';
                    callback(null, { rev: providerRev });
                }
            };
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
            const fileInfo = new FileInfoModel({
                id: androidFile.id,
                name: androidFile.name,
                storage: 'androiddoc',
                path: androidFile.path,
                opts: { writable: true },
                rev: 'seed-revision'
            });
            const fileInfos = [fileInfo];
            fileInfos.get = (id) => fileInfos.find((info) => info.id === id);
            fileInfos.save = () => Promise.resolve();
            const appModel = {
                ...AppModelSyncMixin,
                settings: {},
                fileInfos,
                getFileInfo: () => fileInfo,
                getStoreOpts: (file) => file.opts,
                refresh() {},
                scheduleBackupFile() {}
            };

            await callbackResult((callback) => appModel.syncFile(androidFile, null, callback));
            finalFile = await openFile(providerBytes, password, 'same-file-final');
            const merged = entry(finalFile, 'Shared');
            expect(entry(finalFile, 'Android-only').fields.get('UserName')).to.equal(
                'android-user'
            );
            expect(entry(finalFile, 'Mac-only').fields.get('URL')).to.equal('https://mac.example');
            expect(fieldValuesWithHistory(merged, 'Notes')).to.include('android-note');
            expect(fieldValuesWithHistory(merged, 'Notes')).to.include('mac-note');
            expect(fileInfo.rev).to.equal('merged-revision');
            expect(androidFile.opts.writable).to.equal(true);
        } finally {
            Storage.androiddoc = originalDocumentStorage;
            Storage.cache = originalCacheStorage;
            seed.close();
            androidFile?.close();
            macFile?.close();
            finalFile?.close();
        }
    });
});

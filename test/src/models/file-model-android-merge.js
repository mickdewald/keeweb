import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { FileModel } from 'models/file-model';

function callbackResult(start) {
    return new Promise((resolve, reject) =>
        start((err, value) => (err ? reject(err) : resolve(value)))
    );
}

function callbackSettled(start) {
    return new Promise((resolve) => start((err) => resolve(err || null)));
}

function timeoutResult() {
    return new Promise((resolve) => setTimeout(() => resolve('timeout'), 100));
}

async function serialize(file) {
    return callbackResult((callback) =>
        file.getData((data, err) => callback(err, data))
    );
}

async function openFile({ data, password, keyFileData, id, storage = 'androiddoc' }) {
    const file = new FileModel({
        id,
        name: 'Android merge fixture',
        storage,
        path: 'content://fixture',
        opts: { writable: true }
    });
    await callbackResult((callback) =>
        file.open(
            kdbxweb.ProtectedValue.fromString(password),
            data,
            keyFileData?.slice(),
            callback
        )
    );
    return file;
}

async function createFixture({ password, keyFileData, titles = [] }) {
    const file = new FileModel({ id: `seed-${Math.random()}` });
    file.create('Android merge fixture', () => {});
    file.db.setVersion(3);
    file.db.header.keyEncryptionRounds = 10;
    await file.setPassword(kdbxweb.ProtectedValue.fromString(password));
    if (keyFileData) {
        await file.setKeyFile(keyFileData.slice(), 'seed.key');
    }
    for (const title of titles) {
        const item = file.db.createEntry(file.db.getDefaultGroup());
        item.fields.set('Title', title);
        item.fields.set('Notes', 'base-note');
        item.times.lastModTime = new Date('2026-10-01T08:00:00.000Z');
    }
    const data = await serialize(file);
    file.close();
    return data;
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
    return item;
}

function changeNotes(file, title, notes, timestamp) {
    const item = entry(file, title);
    item.pushHistory();
    item.fields.set('Notes', notes);
    item.times.lastModTime = new Date(timestamp);
    item.parentGroup.times.lastModTime = new Date('2030-01-01T00:00:00.000Z');
    file.setModified();
}

function notesWithHistory(file, title) {
    const item = entry(file, title);
    return [item, ...item.history].map((version) => version.fields.get('Notes'));
}

describe('FileModel Android merge', () => {
    it('opens a remote password change with the remembered key file and updates credential metadata once', async () => {
        const oldPassword = 'old-password';
        const newPassword = 'new-remote-password';
        const keyFile = await kdbxweb.Credentials.createKeyFileWithHash(
            new Uint8Array(32).fill(7).buffer
        );
        const baseData = await createFixture({ password: oldPassword, keyFileData: keyFile });
        const local = await openFile({
            data: baseData,
            password: oldPassword,
            keyFileData: keyFile,
            id: 'same-key-local'
        });
        const remote = await openFile({
            data: baseData,
            password: oldPassword,
            keyFileData: keyFile,
            id: 'same-key-remote'
        });
        let probe;

        try {
            await remote.setPassword(kdbxweb.ProtectedValue.fromString(newPassword));
            remote.db.meta.keyChanged = new Date(local.db.meta.keyChanged.getTime() + 1000);
            const remoteData = await serialize(remote);
            probe = await openFile({
                data: remoteData,
                password: newPassword,
                keyFileData: keyFile,
                id: 'same-key-probe'
            });
            local.set({
                encryptedPassword: 'old-biometric-blob',
                encryptedPasswordDate: new Date('2026-10-01T08:30:00.000Z')
            });
            let callbacks = 0;
            const result = await Promise.race([
                callbackSettled((callback) =>
                    local.mergeOrUpdate(
                        remoteData,
                        {
                            password: kdbxweb.ProtectedValue.fromString(newPassword),
                            keyFileName: 'seed.key',
                            keyFileData: null
                        },
                        (err) => {
                            callbacks++;
                            callback(err);
                        }
                    )
                ),
                timeoutResult()
            ]);

            expect(result).to.equal(null);
            expect(callbacks).to.equal(1);
            expect(local.passwordLength).to.equal(newPassword.length);
            expect(local.keyFileName).to.equal('seed.key');
            expect(local.passwordChanged).to.equal(true);
            expect(local.keyFileChanged).to.equal(false);
            expect(local.encryptedPassword).to.equal(null);
        } finally {
            local.close();
            remote.close();
            probe?.close();
        }
    });

    it('keeps a newer clean Android document password when the provider replays stale bytes', async () => {
        const oldPassword = 'old-provider-password';
        const newPassword = 'new-local-password';
        const oldData = await createFixture({ password: oldPassword, titles: ['Shared'] });
        const local = await openFile({
            data: oldData,
            password: oldPassword,
            id: 'stale-credential-local'
        });
        let reopened;

        try {
            const staleKeyChanged = new Date(local.db.meta.keyChanged.getTime());
            await local.setPassword(kdbxweb.ProtectedValue.fromString(newPassword));
            local.db.meta.keyChanged = new Date(staleKeyChanged.getTime() + 1000);
            local.setSyncComplete(local.path, 'androiddoc', null, {
                editVersion: local.editVersion
            });

            await callbackResult((callback) =>
                local.mergeOrUpdate(
                    oldData,
                    { password: kdbxweb.ProtectedValue.fromString(oldPassword) },
                    callback
                )
            );
            const mergedData = await serialize(local);
            reopened = await openFile({
                data: mergedData,
                password: newPassword,
                id: 'stale-credential-reopened'
            });
            const oldPasswordResult = await callbackSettled((callback) =>
                new FileModel({ id: 'stale-credential-old-password' }).open(
                    kdbxweb.ProtectedValue.fromString(oldPassword),
                    mergedData,
                    null,
                    callback
                )
            );

            expect(entry(reopened, 'Shared').fields.get('Notes')).to.equal('base-note');
            expect(oldPasswordResult.code).to.equal('InvalidKey');
            expect(local.passwordLength).to.equal(newPassword.length);
            expect(local.passwordChanged).to.equal(false);
        } finally {
            local.close();
            reopened?.close();
        }
    });

    it('adopts a newer remote key file on modified databases and clears stale biometric metadata', async () => {
        const password = 'keyfile-change-password';
        const oldKeyFile = await kdbxweb.Credentials.createKeyFileWithHash(
            new Uint8Array(32).fill(11).buffer
        );
        const newKeyFile = await kdbxweb.Credentials.createKeyFileWithHash(
            new Uint8Array(32).fill(12).buffer
        );
        const baseData = await createFixture({
            password,
            keyFileData: oldKeyFile,
            titles: ['Local']
        });
        const local = await openFile({
            data: baseData,
            password,
            keyFileData: oldKeyFile,
            id: 'remote-key-local'
        });
        const remote = await openFile({
            data: baseData,
            password,
            keyFileData: oldKeyFile,
            id: 'remote-key-remote'
        });
        let probe;

        try {
            changeNotes(local, 'Local', 'local-note', '2026-10-01T09:00:00.000Z');
            await remote.setKeyFile(newKeyFile.slice(), 'new.key');
            remote.db.meta.keyChanged = new Date(local.db.meta.keyChanged.getTime() + 1000);
            const remoteData = await serialize(remote);
            probe = await openFile({
                data: remoteData,
                password,
                keyFileData: newKeyFile,
                id: 'remote-key-probe'
            });
            local.set({
                encryptedPassword: 'old-biometric-blob',
                encryptedPasswordDate: new Date('2026-10-01T09:30:00.000Z')
            });

            await callbackResult((callback) =>
                local.mergeOrUpdate(
                    remoteData,
                        {
                            password: kdbxweb.ProtectedValue.fromString(password),
                            keyFileName: 'new.key',
                            keyFileData: newKeyFile.slice()
                        },
                    callback
                )
            );

            expect(notesWithHistory(local, 'Local')).to.include('local-note');
            expect(local.keyFileName).to.equal('new.key');
            expect(local.keyFileChanged).to.equal(true);
            expect(local.passwordChanged).to.equal(false);
            expect(local.encryptedPassword).to.equal(null);
        } finally {
            local.close();
            remote.close();
            probe?.close();
        }
    });

    it('returns credential preparation errors exactly once instead of hanging sync', async () => {
        const password = 'credential-failure-password';
        const baseData = await createFixture({ password });
        const local = await openFile({
            data: baseData,
            password,
            id: 'credential-failure-local'
        });

        try {
            let callbacks = 0;
            const result = await Promise.race([
                callbackSettled((callback) =>
                    local.mergeOrUpdate(
                        baseData,
                        {
                            password: kdbxweb.ProtectedValue.fromString(password),
                            keyFileName: 'bad.key',
                            keyFileData: 'not-bytes'
                        },
                        (err) => {
                            callbacks++;
                            callback(err);
                        }
                    )
                ),
                timeoutResult()
            ]);

            expect(result).to.be.instanceOf(Error);
            expect(callbacks).to.equal(1);
        } finally {
            local.close();
        }
    });

    it('keeps Android document local edits when a clean file sees stale provider bytes', async () => {
        const password = 'stale-provider-password';
        const baseData = await createFixture({ password, titles: ['Shared'] });
        const local = await openFile({
            data: baseData,
            password,
            id: 'stale-provider-local'
        });
        const remote = await openFile({
            data: baseData,
            password,
            id: 'stale-provider-remote'
        });
        let reopened;

        try {
            addEntry(local, 'Android saved edit', 'android-only', '2026-10-01T10:00:00.000Z');
            changeNotes(local, 'Shared', 'android-note', '2026-10-01T10:01:00.000Z');
            local.setSyncComplete(local.path, 'androiddoc', null, { editVersion: local.editVersion });

            addEntry(remote, 'Mac saved edit', 'mac-only', '2026-10-01T10:02:00.000Z');
            changeNotes(remote, 'Shared', 'mac-note', '2026-10-01T10:03:00.000Z');
            const staleProviderData = await serialize(remote);

            await callbackResult((callback) =>
                local.mergeOrUpdate(staleProviderData, null, callback)
            );
            const mergedData = await serialize(local);
            reopened = await openFile({
                data: mergedData,
                password,
                id: 'stale-provider-reopened'
            });

            expect(entry(reopened, 'Android saved edit').fields.get('Notes')).to.equal(
                'android-only'
            );
            expect(entry(reopened, 'Mac saved edit').fields.get('Notes')).to.equal('mac-only');
            expect(notesWithHistory(reopened, 'Shared')).to.include('android-note');
            expect(notesWithHistory(reopened, 'Shared')).to.include('mac-note');
            expect(local.modified).to.equal(true);
            expect(local.dirty).to.equal(true);
        } finally {
            local.close();
            remote.close();
            reopened?.close();
        }
    });

    it('keeps desktop clean replacement behavior outside Android document storage', async () => {
        const password = 'desktop-clean-password';
        const baseData = await createFixture({ password });
        const local = await openFile({
            data: baseData,
            password,
            id: 'desktop-clean-local',
            storage: 'dropbox'
        });
        const remote = await openFile({
            data: baseData,
            password,
            id: 'desktop-clean-remote',
            storage: 'dropbox'
        });

        try {
            addEntry(local, 'Local desktop only', 'local', '2026-10-01T11:00:00.000Z');
            local.setSyncComplete(local.path, 'dropbox', null, { editVersion: local.editVersion });
            addEntry(remote, 'Remote desktop only', 'remote', '2026-10-01T11:01:00.000Z');
            const remoteData = await serialize(remote);

            await callbackResult((callback) => local.mergeOrUpdate(remoteData, null, callback));

            expect(entry(local, 'Local desktop only')).to.equal(undefined);
            expect(entry(local, 'Remote desktop only').fields.get('Notes')).to.equal('remote');
            expect(local.modified).to.equal(false);
        } finally {
            local.close();
            remote.close();
        }
    });
});

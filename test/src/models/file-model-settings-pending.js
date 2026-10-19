import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { FileModelSettingsMixin } from 'models/file-model-settings';

function createFile() {
    const file = {
        pendingMutations: 0,
        oldPasswordHash: 'old-password',
        oldKeyFileHash: 'old-key-file',
        oldKeyChangeDate: new Date(0),
        db: { meta: {}, credentials: {} },
        set(values) {
            Object.assign(this, values);
        },
        editVersion: 0,
        setModified() {
            this.modified = true;
            this.dirty = true;
            this.editVersion++;
        }
    };
    return Object.assign(file, FileModelSettingsMixin);
}

describe('FileModelSettingsMixin pending mutations', () => {
    it('advances the edit version when resetting a changed password factor', async () => {
        const file = createFile();
        file.passwordChanged = true;
        file.oldPasswordLength = 4;

        await file.resetPassword();

        expect(file.passwordChanged).to.equal(false);
        expect(file.editVersion).to.equal(1);
        expect(file.modified).to.equal(true);
    });

    it('advances the edit version when resetting a changed key-file factor', async () => {
        const file = createFile();
        file.keyFileChanged = true;
        file.oldKeyFileName = 'old.key';

        await file.resetKeyFile();

        expect(file.keyFileChanged).to.equal(false);
        expect(file.editVersion).to.equal(1);
        expect(file.modified).to.equal(true);
    });
    for (const [description, failsAsync] of [
        ['rejected', true],
        ['throwing', false]
    ]) {
        it(`clears a ${description} password mutation before a following reset`, async () => {
            const file = createFile();
            const error = new Error('password hash failed');
            file.db.credentials.setPassword = () => {
                if (!failsAsync) {
                    throw error;
                }
                return Promise.reject(error);
            };

            const setting = file.setPassword({ textLength: 3, value: 'new' });
            const resetting = file.resetPassword();
            expect(file.pendingMutations).to.equal(2);

            let settingError;
            await setting.catch((err) => {
                settingError = err;
            });
            await resetting;

            expect(settingError).to.equal(error);
            expect(file.db.credentials.passwordHash).to.equal('old-password');
            expect(file.pendingMutations).to.equal(0);
        });
    }

    it('keeps a later password reset ahead of a delayed password hash', async () => {
        const file = createFile();
        let resolveHash;
        file.db.credentials.setPassword = (password) =>
            new Promise((resolve) => {
                resolveHash = () => {
                    file.db.credentials.passwordHash = password;
                    resolve();
                };
            });

        const setting = file.setPassword({ textLength: 3, value: 'new' });
        const resetting = file.resetPassword();
        expect(file.pendingMutations).to.equal(2);

        await Promise.resolve();
        resolveHash();
        await Promise.all([setting, resetting]);

        expect(file.db.credentials.passwordHash).to.equal('old-password');
        expect(file.pendingMutations).to.equal(0);
    });

    it('keeps a later key-file reset ahead of generated key completion', async () => {
        const file = createFile();
        const original = kdbxweb.Credentials.createRandomKeyFile;
        let resolveGenerated;
        kdbxweb.Credentials.createRandomKeyFile = () =>
            new Promise((resolve) => {
                resolveGenerated = resolve;
            });
        file.db.credentials.setKeyFile = (keyFile) => {
            file.db.credentials.keyFileHash = keyFile;
            return Promise.resolve();
        };
        try {
            const generating = file.generateAndSetKeyFile();
            const resetting = file.resetKeyFile();
            expect(file.pendingMutations).to.equal(2);

            await Promise.resolve();
            resolveGenerated(new Uint8Array([1]));
            await Promise.all([generating, resetting]);

            expect(file.db.credentials.keyFileHash).to.equal('old-key-file');
            expect(file.pendingMutations).to.equal(0);
        } finally {
            kdbxweb.Credentials.createRandomKeyFile = original;
        }
    });

    it('keeps a later key-file reset ahead of a delayed key-file hash', async () => {
        const file = createFile();
        let resolveHash;
        file.db.credentials.setKeyFile = (keyFile) =>
            new Promise((resolve) => {
                resolveHash = () => {
                    file.db.credentials.keyFileHash = keyFile;
                    resolve();
                };
            });

        const setting = file.setKeyFile(new Uint8Array([1]), 'new.key');
        const resetting = file.resetKeyFile();
        expect(file.pendingMutations).to.equal(2);

        await Promise.resolve();
        resolveHash();
        await Promise.all([setting, resetting]);

        expect(file.db.credentials.keyFileHash).to.equal('old-key-file');
        expect(file.pendingMutations).to.equal(0);
    });
});

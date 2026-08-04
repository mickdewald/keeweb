import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { Collection } from 'framework/collection';
import { TouchIdRecovery } from 'comp/app/touch-id-recovery';
import { AppModel } from 'models/app-model';
import { FileInfoModel } from 'models/file-info-model';
import 'util/kdbxweb/protected-value-ex';

describe('AppModel Touch ID recovery', () => {
    class TestFileInfoCollection extends Collection {
        static model = FileInfoModel;

        saveCount = 0;

        save() {
            this.saveCount++;
        }
    }

    it('replaces all stale Touch ID credentials after a successful password unlock', async () => {
        const oldDate = new Date('2026-08-01T08:00:00Z');
        const currentFileInfo = new FileInfoModel({
            id: 'current',
            name: 'Current',
            encryptedPassword: 'old-current',
            encryptedPasswordDate: oldDate
        });
        const otherFileInfo = new FileInfoModel({
            id: 'other',
            name: 'Other',
            encryptedPassword: 'old-other',
            encryptedPasswordDate: oldDate
        });
        const currentFile = {
            id: 'current',
            storage: 'test',
            backup: null,
            encryptedPassword: 'old-current',
            encryptedPasswordDate: oldDate,
            isKeyChangePending: () => false
        };
        const otherFile = {
            id: 'other',
            storage: 'test',
            backup: null,
            encryptedPassword: 'old-other',
            encryptedPasswordDate: oldDate,
            isKeyChangePending: () => false
        };
        const model = {
            settings: { deviceOwnerAuth: 'file' },
            fileInfos: new TestFileInfoCollection([currentFileInfo, otherFileInfo]),
            files: [currentFile, otherFile],
            memoryPasswordStorage: {
                current: { value: 'old-current', date: oldDate },
                other: { value: 'old-other', date: oldDate }
            },
            appLogger: { error() {} }
        };

        const operations = [];
        const newEncryptedPassword = kdbxweb.ProtectedValue.fromString('new-encrypted-password');
        const expectedEncryptedPassword = newEncryptedPassword.toBase64();
        const nativeModules = {
            async hardwareCryptoDeleteKey() {
                operations.push('delete-key');
            },
            async hardwareEncrypt() {
                operations.push('encrypt-password');
                return newEncryptedPassword;
            }
        };

        const invalidationError = new Error(
            "Error invoking remote method 'hardwareDecrypt': Error: " +
                'SecKeyCreateDecryptedData: OSStatus -1'
        );
        expect(TouchIdRecovery.handleDecryptionError(invalidationError)).to.be.true;
        expect(TouchIdRecovery.isRequired()).to.be.true;

        await TouchIdRecovery.recover(
            model,
            currentFile,
            {
                password: kdbxweb.ProtectedValue.fromString('master-password'),
                encryptedPassword: null
            },
            nativeModules
        );

        expect(operations).to.eql(['delete-key', 'encrypt-password']);
        expect(TouchIdRecovery.isRequired()).to.be.false;
        expect(model.memoryPasswordStorage).to.eql({});
        expect(otherFile.encryptedPassword).to.be.null;
        expect(otherFile.encryptedPasswordDate).to.be.null;
        expect(otherFileInfo.encryptedPassword).to.be.null;
        expect(otherFileInfo.encryptedPasswordDate).to.be.null;
        expect(currentFile.encryptedPassword).to.eql(expectedEncryptedPassword);
        expect(currentFileInfo.encryptedPassword).to.eql(expectedEncryptedPassword);
        expect(model.fileInfos.saveCount).to.eql(2);
    });

    it('does not request recovery for unrelated decryption errors', () => {
        const unrelatedError = new Error('SecKeyCreateDecryptedData: OSStatus -50');

        expect(TouchIdRecovery.handleDecryptionError(unrelatedError)).to.be.false;
        expect(TouchIdRecovery.isRequired()).to.be.false;
    });

    it('leaves a pending recovery untouched when an XML import opens without password params', async () => {
        const file = {
            id: 'current',
            storage: 'test',
            backup: null,
            encryptedPassword: null,
            encryptedPasswordDate: null,
            isKeyChangePending: () => false
        };
        const model = {
            settings: { deviceOwnerAuth: 'file', yubiKeyAutoOpen: false },
            fileInfos: new TestFileInfoCollection([
                new FileInfoModel({ id: 'current', name: 'Current' })
            ]),
            files: [file],
            memoryPasswordStorage: {},
            appLogger: { error() {} }
        };
        const nativeModules = {
            async hardwareCryptoDeleteKey() {},
            async hardwareEncrypt() {
                return kdbxweb.ProtectedValue.fromString('new-encrypted-password');
            }
        };
        const invalidationError = new Error('SecKeyCreateDecryptedData: OSStatus -1');
        TouchIdRecovery.handleDecryptionError(invalidationError, file.id);

        let openError;
        try {
            AppModel.prototype.fileOpened.call(model, file);
        } catch (error) {
            openError = error;
        }

        await TouchIdRecovery.recover(
            model,
            file,
            { password: kdbxweb.ProtectedValue.fromString('master-password') },
            nativeModules
        );
        expect(openError).to.be.undefined;
    });

    it('serializes overlapping recovery attempts and only caches the first opened database', async () => {
        const currentFileInfo = new FileInfoModel({ id: 'current', name: 'Current' });
        const otherFileInfo = new FileInfoModel({ id: 'other', name: 'Other' });
        const currentFile = {
            id: 'current',
            encryptedPassword: null,
            encryptedPasswordDate: null
        };
        const otherFile = {
            id: 'other',
            encryptedPassword: null,
            encryptedPasswordDate: null
        };
        const model = {
            settings: { deviceOwnerAuth: 'file' },
            fileInfos: new TestFileInfoCollection([currentFileInfo, otherFileInfo]),
            files: [currentFile, otherFile],
            memoryPasswordStorage: {},
            appLogger: { error() {} }
        };
        const operations = [];
        let continueDeletion;
        const deletionBlocked = new Promise((resolve) => {
            continueDeletion = resolve;
        });
        let deletionStarted;
        const deletionStarting = new Promise((resolve) => {
            deletionStarted = resolve;
        });
        const nativeModules = {
            async hardwareCryptoDeleteKey() {
                operations.push('delete-key');
                deletionStarted();
                await deletionBlocked;
            },
            async hardwareEncrypt() {
                operations.push('encrypt-password');
                return kdbxweb.ProtectedValue.fromString('new-encrypted-password');
            }
        };
        const invalidationError = new Error('SecKeyCreateDecryptedData: OSStatus -1');
        TouchIdRecovery.handleDecryptionError(invalidationError, currentFile.id);
        TouchIdRecovery.handleDecryptionError(invalidationError, otherFile.id);

        const currentRecovery = TouchIdRecovery.recover(
            model,
            currentFile,
            { password: kdbxweb.ProtectedValue.fromString('current-password') },
            nativeModules
        );
        await deletionStarting;
        const otherRecovery = TouchIdRecovery.recover(
            model,
            otherFile,
            { password: kdbxweb.ProtectedValue.fromString('other-password') },
            nativeModules
        );
        continueDeletion();
        await Promise.all([currentRecovery, otherRecovery]);

        expect(operations).to.eql(['delete-key', 'encrypt-password']);
        expect(currentFileInfo.encryptedPassword).to.be.a('string');
        expect(otherFileInfo.encryptedPassword).to.be.null;
        expect(TouchIdRecovery.isRequired()).to.be.false;
    });
});

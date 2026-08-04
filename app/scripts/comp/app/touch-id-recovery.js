import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';

const recoveryFileIds = new Set();
let recoveryPromise = null;

const TouchIdRecovery = {
    handleDecryptionError(error, fileId) {
        const isInvalidatedKey = /SecKeyCreateDecryptedData: OSStatus -1(?:\s|$)/.test(
            error?.message || ''
        );
        if (isInvalidatedKey) {
            recoveryFileIds.add(fileId);
        }
        return isInvalidatedKey;
    },

    isRequired(fileId) {
        if (!recoveryFileIds.size) {
            return false;
        }
        return (
            fileId === undefined || recoveryFileIds.has(undefined) || recoveryFileIds.has(fileId)
        );
    },

    async recover(model, file, params, nativeModules) {
        if (!this.isRequired(file.id)) {
            return false;
        }
        if (!recoveryPromise) {
            recoveryPromise = (async () => {
                await nativeModules.hardwareCryptoDeleteKey();
                this.clearStoredPasswords(model);
                const saved = await this.savePassword(model, file, params, nativeModules);
                if (!saved) {
                    throw new Error('Could not save the new Touch ID credentials');
                }
                recoveryFileIds.clear();
                return true;
            })();
        }
        try {
            return await recoveryPromise;
        } finally {
            recoveryPromise = null;
        }
    },

    async savePassword(model, file, params, nativeModules) {
        if (!model.settings.deviceOwnerAuth || params.encryptedPassword) {
            return false;
        }
        try {
            const encryptedPassword = await nativeModules.hardwareEncrypt(params.password);
            const value = encryptedPassword.toBase64();
            const date = new Date();
            file.encryptedPassword = value;
            file.encryptedPasswordDate = date;
            if (model.settings.deviceOwnerAuth === 'file') {
                const fileInfo = model.fileInfos.get(file.id);
                fileInfo.encryptedPassword = value;
                fileInfo.encryptedPasswordDate = date;
                model.fileInfos.save();
            } else if (model.settings.deviceOwnerAuth === 'memory') {
                model.memoryPasswordStorage[file.id] = { value, date };
            }
            return true;
        } catch (error) {
            file.encryptedPassword = null;
            file.encryptedPasswordDate = null;
            delete model.memoryPasswordStorage[file.id];
            model.appLogger.error('Error encrypting password', error);
            return false;
        }
    },

    clearStoredPasswords(model) {
        let fileInfoChanged = false;
        for (const fileInfo of model.fileInfos) {
            if (fileInfo.encryptedPassword) {
                fileInfo.encryptedPassword = null;
                fileInfo.encryptedPasswordDate = null;
                fileInfoChanged = true;
            }
        }
        if (fileInfoChanged) {
            model.fileInfos.save();
        }
        for (const file of model.files) {
            file.encryptedPassword = null;
            file.encryptedPasswordDate = null;
        }
        for (const fileId of Object.keys(model.memoryPasswordStorage)) {
            delete model.memoryPasswordStorage[fileId];
        }
    },

    showRequiredAlert(complete) {
        Alerts.error({
            header: Locale.setGenTouchId,
            body: Locale.touchIdRecoveryBody,
            buttons: [Alerts.buttons.ok],
            complete
        });
    },

    showFailedAlert() {
        Alerts.error({
            header: Locale.openError,
            body: Locale.touchIdRecoveryBody
        });
    }
};

export { TouchIdRecovery };

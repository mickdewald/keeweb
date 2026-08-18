import { Events } from 'framework/events';
import { AppSettingsModel } from 'models/app-settings-model';
import { minmax } from 'util/fn';
import { NativeModules } from 'comp/launcher/native-modules';

const SettingsGeneralAuditLockMixin = {
    changeAuditPasswords(e) {
        const auditPasswords = e.target.checked || false;
        AppSettingsModel.auditPasswords = auditPasswords;
    },

    changeAuditPasswordEntropy(e) {
        const auditPasswordEntropy = e.target.checked || false;
        AppSettingsModel.auditPasswordEntropy = auditPasswordEntropy;
    },

    changeExcludePinsFromAudit(e) {
        const excludePinsFromAudit = e.target.checked || false;
        AppSettingsModel.excludePinsFromAudit = excludePinsFromAudit;
    },

    changeCheckPasswordsOnHIBP(e) {
        if (e.target.closest('a')) {
            return;
        }
        const checkPasswordsOnHIBP = e.target.checked || false;
        AppSettingsModel.checkPasswordsOnHIBP = checkPasswordsOnHIBP;
    },

    clickToggleHelpHIBP() {
        this.el.querySelector('.settings__general-help-hibp').classList.toggle('hide');
    },

    changeAuditPasswordAge(e) {
        const auditPasswordAge = e.target.value | 0;
        AppSettingsModel.auditPasswordAge = auditPasswordAge;
    },

    changeLockOnMinimize(e) {
        const lockOnMinimize = e.target.checked || false;
        AppSettingsModel.lockOnMinimize = lockOnMinimize;
    },

    changeLockOnCopy(e) {
        const lockOnCopy = e.target.checked || false;
        AppSettingsModel.lockOnCopy = lockOnCopy;
    },

    changeLockOnAutoType(e) {
        const lockOnAutoType = e.target.checked || false;
        AppSettingsModel.lockOnAutoType = lockOnAutoType;
    },

    changeLockOnOsLock(e) {
        const lockOnOsLock = e.target.checked || false;
        AppSettingsModel.lockOnOsLock = lockOnOsLock;
    },

    changeTableView(e) {
        const tableView = e.target.checked || false;
        AppSettingsModel.tableView = tableView;
        Events.emit('refresh');
    },

    changeColorfulIcons(e) {
        const colorfulIcons = e.target.checked || false;
        AppSettingsModel.colorfulIcons = colorfulIcons;
        Events.emit('refresh');
    },

    changeUseMarkdown(e) {
        const useMarkdown = e.target.checked || false;
        AppSettingsModel.useMarkdown = useMarkdown;
        Events.emit('refresh');
    },

    changeUseGroupIconForEntries(e) {
        const useGroupIconForEntries = e.target.checked || false;
        AppSettingsModel.useGroupIconForEntries = useGroupIconForEntries;
    },

    changeDirectAutotype(e) {
        const directAutotype = e.target.checked || false;
        AppSettingsModel.directAutotype = directAutotype;
    },

    changeAutoTypeTitleFilter(e) {
        const autoTypeTitleFilterEnabled = e.target.checked || false;
        AppSettingsModel.autoTypeTitleFilterEnabled = autoTypeTitleFilterEnabled;
    },

    changeFieldLabelDblClickAutoType(e) {
        const fieldLabelDblClickAutoType = e.target.checked || false;
        AppSettingsModel.fieldLabelDblClickAutoType = fieldLabelDblClickAutoType;
        Events.emit('refresh');
    },

    changeDeviceOwnerAuth(e) {
        const deviceOwnerAuth = e.target.value || null;

        let deviceOwnerAuthTimeoutMinutes = AppSettingsModel.deviceOwnerAuthTimeoutMinutes | 0;
        if (deviceOwnerAuth) {
            const timeouts = { memory: [30, 10080], file: [30, 525600] };
            const [tMin, tMax] = timeouts[deviceOwnerAuth] || [0, 0];
            deviceOwnerAuthTimeoutMinutes = minmax(deviceOwnerAuthTimeoutMinutes, tMin, tMax);
        }

        AppSettingsModel.set({ deviceOwnerAuth, deviceOwnerAuthTimeoutMinutes });
        this.render();

        this.appModel.checkEncryptedPasswordsStorage();
        if (!deviceOwnerAuth) {
            NativeModules.hardwareCryptoDeleteKey().catch(() => {});
        }
    },

    changeDeviceOwnerAuthTimeout(e) {
        const deviceOwnerAuthTimeout = e.target.value | 0;
        AppSettingsModel.deviceOwnerAuthTimeoutMinutes = deviceOwnerAuthTimeout;
    }
};

export { SettingsGeneralAuditLockMixin };

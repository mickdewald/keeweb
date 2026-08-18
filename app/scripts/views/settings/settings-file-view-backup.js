import { Launcher } from 'comp/launcher';
import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';

const DefaultBackupPath = 'Backups/{name}.{date}.bak';
const DefaultBackupSchedule = '1w';

const SettingsFileBackupMixin = {
    changeName(e) {
        const value = $.trim(e.target.value);
        if (!value) {
            return;
        }
        this.model.setName(value);
    },

    changeDefUser(e) {
        const value = $.trim(e.target.value);
        this.model.setDefaultUser(value);
    },

    changeBackupEnabled(e) {
        const enabled = e.target.checked;
        let backup = this.model.backup;
        if (!backup) {
            backup = { enabled, schedule: DefaultBackupSchedule };
            const defaultPath = DefaultBackupPath.replace('{name}', this.model.name);
            if (Launcher) {
                backup.storage = 'file';
                backup.path = Launcher.getDocumentsPath(defaultPath);
            } else {
                backup.storage = 'dropbox';
                backup.path = defaultPath;
            }
            // } else if (this.model.storage === 'webdav') {
            //     backup.storage = 'webdav';
            //     backup.path = this.model.path + '.{date}.bak';
            // } else if (this.model.storage) {
            //     backup.storage = this.model.storage;
            //     backup.path = DefaultBackupPath.replace('{name}', this.model.name);
            // } else {
            //     Object.keys(Storage).forEach(name => {
            //         var prv = Storage[name];
            //         if (!backup.storage && !prv.system && prv.enabled) {
            //             backup.storage = name;
            //         }
            //     });
            //     if (!backup.storage) {
            //         e.target.checked = false;
            //         return;
            //     }
            //     backup.path = DefaultBackupPath.replace('{name}', this.model.name);
            // }
            this.$el.find('#settings__file-backup-storage').val(backup.storage);
            this.$el.find('#settings__file-backup-path').val(backup.path);
        }
        this.$el.find('.settings__file-backups').toggleClass('hide', !enabled);
        backup.enabled = enabled;
        this.setBackup(backup);
    },

    changeBackupPath(e) {
        const backup = this.model.backup;
        backup.path = e.target.value.trim();
        this.setBackup(backup);
    },

    changeBackupStorage(e) {
        const backup = this.model.backup;
        backup.storage = e.target.value;
        this.setBackup(backup);
    },

    changeBackupSchedule(e) {
        const backup = this.model.backup;
        backup.schedule = e.target.value;
        this.setBackup(backup);
    },

    setBackup(backup) {
        this.model.backup = backup;
        this.appModel.setFileBackup(this.model.id, backup);
    },

    backupFile() {
        if (this.backupInProgress) {
            return;
        }
        const backupButton = this.$el.find('.settings__file-button-backup');
        backupButton.text(Locale.setFileBackupNowWorking);
        this.model.getData((data) => {
            if (!data) {
                this.backupInProgress = false;
                backupButton.text(Locale.setFileBackupNow);
                return;
            }
            this.appModel.backupFile(this.model, data, (err) => {
                this.backupInProgress = false;
                backupButton.text(Locale.setFileBackupNow);
                if (err) {
                    let title = '';
                    let description = '';
                    if (err.isDir) {
                        title = Locale.setFileBackupErrorIsDir;
                        description = Locale.setFileBackupErrorIsDirDescription;
                    } else {
                        title = Locale.setFileBackupError;
                        description = Locale.setFileBackupErrorDescription;
                    }
                    Alerts.error({
                        title,
                        body: description,
                        pre: err.toString()
                    });
                }
            });
        });
    }
};

export { DefaultBackupPath, DefaultBackupSchedule, SettingsFileBackupMixin };

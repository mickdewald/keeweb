import { Storage } from 'storage';
import { Launcher } from 'comp/launcher';
import { Alerts } from 'comp/ui/alerts';
import { UrlFormat } from 'util/formatting/url-format';
import { FileSaver } from 'util/ui/file-saver';
import { Locale } from 'util/locale';
import { OpenConfigView } from 'views/open-config-view';
import { omit } from 'util/fn';

const SettingsFileSaveMixin = {
    validatePassword(continueCallback) {
        if (!this.model.passwordLength) {
            Alerts.yesno({
                header: Locale.setFileEmptyPass,
                body: Locale.setFileEmptyPassBody,
                success: () => {
                    continueCallback();
                },
                cancel: () => {
                    this.$el.find('#settings__file-master-pass').focus();
                }
            });
            return false;
        }
        return true;
    },

    save(arg) {
        if (!arg) {
            arg = {};
        }
        arg.startedByUser = true;
        if (!arg.skipValidation) {
            const isValid = this.validatePassword(() => {
                arg.skipValidation = true;
                this.save(arg);
            });
            if (!isValid) {
                return;
            }
        }

        this.appModel.syncFile(this.model, arg);
    },

    saveDefault() {
        this.save();
    },

    toggleChooser() {
        this.$el.find('.settings__file-save-choose').toggleClass('hide');
    },

    saveToFile(skipValidation) {
        if (skipValidation !== true && !this.validatePassword(this.saveToFile.bind(this, true))) {
            return;
        }
        const fileName = this.model.name + '.kdbx';
        if (Launcher && !this.model.storage) {
            Launcher.getSaveFileName(fileName, (path) => {
                if (path) {
                    this.save({ storage: 'file', path });
                }
            });
        } else {
            this.model.getData((data) => {
                if (!data) {
                    return;
                }
                if (Launcher) {
                    Launcher.getSaveFileName(fileName, (path) => {
                        if (path) {
                            Storage.file.save(path, null, data, (err) => {
                                if (err) {
                                    Alerts.error({
                                        header: Locale.setFileSaveError,
                                        body: Locale.setFileSaveErrorBody + ' ' + path + ':',
                                        pre: err
                                    });
                                }
                            });
                        }
                    });
                } else {
                    const blob = new Blob([data], { type: 'application/octet-stream' });
                    FileSaver.saveAs(blob, fileName);
                }
            });
        }
    },

    saveToXml() {
        Alerts.yesno({
            header: Locale.setFileExportRaw,
            body: Locale.setFileExportRawBody,
            success: () => {
                this.model.getXml((xml) => {
                    const blob = new Blob([xml], { type: 'text/xml' });
                    FileSaver.saveAs(blob, this.model.name + '.xml');
                });
            }
        });
    },

    saveToHtml() {
        Alerts.yesno({
            header: Locale.setFileExportRaw,
            body: Locale.setFileExportRawBody,
            success: () => {
                this.model.getHtml((html) => {
                    const blob = new Blob([html], { type: 'text/html' });
                    FileSaver.saveAs(blob, this.model.name + '.html');
                });
            }
        });
    },

    saveToStorage(e) {
        if (this.model.syncing || this.model.demo) {
            return;
        }
        const storageName = $(e.target).closest('.settings__file-save-to-storage').data('storage');
        const storage = Storage[storageName];
        if (!storage) {
            return;
        }
        if (this.model.storage === storageName) {
            this.save();
        } else {
            if (!storage.list) {
                if (storage.getOpenConfig) {
                    const config = {
                        id: storage.name,
                        name: Locale[storage.name] || storage.name,
                        icon: storage.icon,
                        buttons: false,
                        ...storage.getOpenConfig()
                    };
                    const openConfigView = new OpenConfigView(config);
                    Alerts.alert({
                        header: '',
                        body: '',
                        icon: storage.icon || 'file-alt',
                        buttons: [Alerts.buttons.ok, Alerts.buttons.cancel],
                        esc: '',
                        opaque: true,
                        view: openConfigView,
                        success: () => {
                            const storageConfig = openConfigView.getData();
                            if (!storageConfig) {
                                return;
                            }
                            const opts = omit(storageConfig, ['path', 'storage']);
                            if (opts && Object.keys(opts).length) {
                                this.model.opts = opts;
                            }
                            this.save({ storage: storageName, path: storageConfig.path, opts });
                        }
                    });
                } else {
                    Alerts.notImplemented();
                }
                return;
            }
            this.model.syncing = true;
            storage.list('', (err, files) => {
                this.model.syncing = false;
                if (err) {
                    return;
                }
                const expName = this.model.name.toLowerCase();
                const existingFile = [...files].find(
                    (file) =>
                        !file.dir && UrlFormat.getDataFileName(file.name).toLowerCase() === expName
                );
                if (existingFile) {
                    Alerts.yesno({
                        header: Locale.setFileAlreadyExists,
                        body: Locale.setFileAlreadyExistsBody.replace('{}', this.model.name),
                        success: () => {
                            this.model.syncing = true;
                            storage.remove(existingFile.path, (err) => {
                                this.model.syncing = false;
                                if (!err) {
                                    this.save({ storage: storageName });
                                }
                            });
                        }
                    });
                } else {
                    this.save({ storage: storageName });
                }
            });
        }
    },

    closeFile() {
        if (this.model.modified) {
            Alerts.yesno({
                header: Locale.setFileUnsaved,
                body: Locale.setFileUnsavedBody,
                buttons: [
                    { result: 'close', title: Locale.setFileCloseNoSave, error: true },
                    { result: '', title: Locale.setFileDontClose }
                ],
                success: (result) => {
                    if (result === 'close') {
                        this.closeFileNoCheck();
                    }
                }
            });
        } else {
            this.closeFileNoCheck();
        }
    },

    closeFileNoCheck() {
        this.appModel.closeFile(this.model);
    }
};

export { SettingsFileSaveMixin };

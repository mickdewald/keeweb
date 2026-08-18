function createOpenViewOperationsMixin({
    kdbxweb,
    Events,
    Storage,
    TouchIdRecovery,
    Alerts,
    Comparators,
    UrlFormat,
    Locale,
    InputFx,
    OpenConfigView,
    StorageFileListView,
    omit,
    NativeModules,
    logger
}) {
    return {
        createDemo() {
            if (!this.busy) {
                this.closeConfig();
                if (!this.model.createDemoFile()) {
                    this.emit('close');
                }
                if (!this.model.settings.demoOpened) {
                    this.model.settings.demoOpened = true;
                }
            }
        },

        createNew() {
            if (!this.busy) {
                this.model.createNewFile();
            }
        },

        openDb() {
            if (this.params.id && this.model.files.get(this.params.id)) {
                this.emit('close');
                return;
            }
            if (this.busy || !this.params.name) {
                return;
            }
            this.$el.toggleClass('open--opening', true);
            this.inputEl.attr('disabled', 'disabled');
            this.busy = true;
            this.params.password = this.passwordInput.value;
            if (this.encryptedPassword && !this.params.password.length) {
                logger.debug('Encrypting password using hardware decryption');
                const touchIdPrompt = Locale.bioOpenAuthPrompt.replace('{}', this.params.name);
                const encryptedPassword = kdbxweb.ProtectedValue.fromBase64(
                    this.encryptedPassword.value
                );
                Events.emit('hardware-decrypt-started');
                NativeModules.hardwareDecrypt(encryptedPassword, touchIdPrompt)
                    .then((password) => {
                        Events.emit('hardware-decrypt-finished');

                        this.params.password = password;
                        this.params.encryptedPassword = this.encryptedPassword;
                        this.model.openFile(this.params, (err) => this.openDbComplete(err));
                    })
                    .catch((err) => {
                        Events.emit('hardware-decrypt-finished');
                        if (err.message.includes('User refused')) {
                            err.userCanceled = true;
                        } else if (TouchIdRecovery.handleDecryptionError(err, this.params.id)) {
                            err.touchIdRecoveryRequired = true;
                            this.encryptedPassword = null;
                        }
                        logger.error('Error in hardware decryption', err);
                        this.openDbComplete(err);
                    });
            } else {
                this.params.encryptedPassword = null;
                this.afterPaint(() => {
                    this.model.openFile(this.params, (err) => this.openDbComplete(err));
                });
            }
        },

        openDbComplete(err) {
            this.busy = false;
            this.$el.toggleClass('open--opening', false);
            const showInputError = err && !err.userCanceled && !err.touchIdRecoveryRequired;
            this.inputEl.removeAttr('disabled').toggleClass('input--error', !!showInputError);
            if (err) {
                logger.error('Error opening file', err);
                this.focusInput(true);
                this.inputEl[0].selectionStart = 0;
                this.inputEl[0].selectionEnd = this.inputEl.val().length;
                if (err.code === 'InvalidKey') {
                    InputFx.shake(this.inputEl);
                } else if (err.userCanceled) {
                    // nothing to do
                } else if (err.touchIdRecoveryRequired) {
                    this.displayOpenDeviceOwnerAuth();
                    TouchIdRecovery.showRequiredAlert(() => this.focusInput(true));
                } else {
                    if (err.notFound) {
                        err = Locale.openErrorFileNotFound;
                    }
                    Alerts.error({
                        header: Locale.openError,
                        body: Locale.openErrorDescription,
                        pre: this.errorToString(err)
                    });
                }
            } else {
                this.emit('close');
            }
        },

        importDbWithXml() {
            if (this.busy || !this.params.name) {
                return;
            }
            this.$el.toggleClass('open--opening', true);
            this.inputEl.attr('disabled', 'disabled');
            this.busy = true;
            this.afterPaint(() =>
                this.model.importFileWithXml(this.params, (err) => {
                    if (err) {
                        this.params.name = '';
                        this.params.fileXml = null;
                    }
                    this.openDbComplete(err);
                })
            );
        },

        toggleMore() {
            if (this.busy) {
                return;
            }
            this.closeConfig();
            this.$el.find('.open__icons--lower').toggleClass('hide');
        },

        openSettings() {
            Events.emit('toggle-settings');
        },

        openStorage(e) {
            if (this.busy) {
                return;
            }
            const storage = Storage[$(e.target).closest('.open__icon').data('storage')];
            if (!storage) {
                return;
            }
            if (storage.needShowOpenConfig && storage.needShowOpenConfig()) {
                this.showConfig(storage);
            } else if (storage.list) {
                this.listStorage(storage);
            } else {
                Alerts.notImplemented();
            }
        },

        listStorage(storage, config) {
            if (this.busy) {
                return;
            }
            this.closeConfig();
            const icon = this.$el.find('.open__icon-storage[data-storage=' + storage.name + ']');
            this.busy = true;
            icon.toggleClass('flip3d', true);
            storage.list(config && config.dir, (err, files) => {
                icon.toggleClass('flip3d', false);
                this.busy = false;
                if (err || !files) {
                    err = err ? err.toString() : '';
                    if (err === 'browser-auth-started') {
                        return;
                    }
                    if (err.lastIndexOf('OAuth', 0) !== 0 && !Alerts.alertDisplayed) {
                        Alerts.error({
                            header: Locale.openError,
                            body: Locale.openListErrorBody,
                            pre: err.toString()
                        });
                    }
                    return;
                }
                if (!files.length) {
                    Alerts.error({
                        header: Locale.openNothingFound,
                        body: Locale.openNothingFoundBody
                    });
                    return;
                }

                const fileNameComparator = Comparators.stringComparator('path', true);
                files.sort((x, y) => {
                    if (x.dir !== y.dir) {
                        return !!y.dir - !!x.dir;
                    }
                    return fileNameComparator(x, y);
                });
                if (config && config.dir) {
                    files.unshift({
                        path: config.prevDir,
                        name: '..',
                        dir: true
                    });
                }
                const listView = new StorageFileListView({ files });
                listView.on('selected', (file) => {
                    if (file.dir) {
                        this.listStorage(storage, {
                            dir: file.path,
                            prevDir: (config && config.dir) || ''
                        });
                    } else {
                        this.openStorageFile(storage, file);
                    }
                });
                Alerts.alert({
                    header: Locale.openSelectFile,
                    body: Locale.openSelectFileBody,
                    icon: storage.icon || 'file-alt',
                    buttons: [{ result: '', title: Locale.alertCancel }],
                    esc: '',
                    click: '',
                    view: listView
                });
            });
        },

        openStorageFile(storage, file) {
            if (this.busy) {
                return;
            }
            this.params.id = null;
            this.params.storage = storage.name;
            this.params.path = file.path;
            this.params.name = UrlFormat.getDataFileName(file.name);
            this.params.rev = file.rev;
            this.params.fileData = null;
            this.encryptedPassword = null;
            this.displayOpenFile();
            this.displayOpenDeviceOwnerAuth();
        },

        showConfig(storage) {
            if (this.busy) {
                return;
            }
            if (this.views.openConfig) {
                this.views.openConfig.remove();
            }
            const config = {
                id: storage.name,
                name: Locale[storage.name] || storage.name,
                icon: storage.icon,
                buttons: true,
                ...storage.getOpenConfig()
            };
            this.views.openConfig = new OpenConfigView(config, {
                parent: '.open__config-wrap'
            });
            this.views.openConfig.on('cancel', this.closeConfig.bind(this));
            this.views.openConfig.on('apply', this.applyConfig.bind(this));
            this.views.openConfig.render();
            this.$el.find('.open__pass-area').addClass('hide');
            this.$el.find('.open__icons--lower').addClass('hide');
        },

        closeConfig() {
            if (this.busy) {
                this.storageWaitId = null;
                this.busy = false;
            }
            if (this.views.openConfig) {
                this.views.openConfig.remove();
                delete this.views.openConfig;
            }
            this.$el.find('.open__pass-area').removeClass('hide');
            this.$el.find('.open__config').addClass('hide');
            this.focusInput();
        },

        applyConfig(config) {
            if (this.busy || !config) {
                return;
            }
            this.busy = true;
            this.views.openConfig.setDisabled(true);
            const storage = Storage[config.storage];
            this.storageWaitId = Math.random();
            const path = config.path;
            const opts = omit(config, ['path', 'storage']);
            const req = {
                waitId: this.storageWaitId,
                storage: config.storage,
                path,
                opts
            };
            if (storage.applyConfig) {
                storage.applyConfig(opts, this.storageApplyConfigComplete.bind(this, req));
            } else {
                storage.stat(path, opts, this.storageStatComplete.bind(this, req));
            }
        },

        storageApplyConfigComplete(req, err) {
            if (this.storageWaitId !== req.waitId) {
                return;
            }
            this.storageWaitId = null;
            this.busy = false;
            if (err) {
                this.views.openConfig.setDisabled(false);
                this.views.openConfig.setError(err);
            } else {
                this.closeConfig();
            }
        },

        storageStatComplete(req, err, stat) {
            if (this.storageWaitId !== req.waitId) {
                return;
            }
            this.storageWaitId = null;
            this.busy = false;
            if (err) {
                this.views.openConfig.setDisabled(false);
                this.views.openConfig.setError(err);
            } else {
                this.closeConfig();
                this.params.id = null;
                this.params.storage = req.storage;
                this.params.path = req.path;
                this.params.opts = req.opts;
                this.params.name = UrlFormat.getDataFileName(req.path);
                this.params.rev = stat.rev;
                this.params.fileData = null;
                this.encryptedPassword = null;
                this.displayOpenFile();
                this.displayOpenDeviceOwnerAuth();
            }
        }
    };
}

export { createOpenViewOperationsMixin };

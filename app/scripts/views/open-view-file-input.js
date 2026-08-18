function createOpenViewFileInputMixin({
    kdbxweb,
    Events,
    DropboxChooser,
    FocusDetector,
    Launcher,
    Alerts,
    Keys,
    Locale,
    logger
}) {
    return {
        fileSelected(e) {
            const file = e.target.files[0];
            if (file) {
                if (this.model.settings.canImportCsv && /\.csv$/.test(file.name)) {
                    Events.emit('import-csv-requested', file);
                } else if (this.model.settings.canImportXml && /\.xml$/.test(file.name)) {
                    this.setFile(file, null, this.showLocalFileAlert.bind(this));
                } else {
                    this.processFile(file, (success) => {
                        if (success && !file.path && this.reading === 'fileData') {
                            this.showLocalFileAlert();
                        }
                    });
                }
            }
        },

        processFile(file, complete) {
            const reader = new FileReader();
            reader.onload = (e) => {
                let success = false;
                switch (this.reading) {
                    case 'fileData': {
                        const format = this.getOpenFileFormat(e.target.result);
                        switch (format) {
                            case 'kdbx':
                                this.params.id = null;
                                this.params.fileData = e.target.result;
                                this.params.name = file.name.replace(/(.+)\.\w+$/i, '$1');
                                this.params.path = file.path || null;
                                this.params.storage = file.path ? 'file' : null;
                                this.params.rev = null;
                                if (!this.params.keyFileData) {
                                    this.params.keyFileName = null;
                                }
                                this.encryptedPassword = null;
                                this.displayOpenFile();
                                this.displayOpenKeyFile();
                                this.displayOpenDeviceOwnerAuth();
                                success = true;
                                break;
                            case 'xml':
                                this.params.id = null;
                                this.params.fileXml = kdbxweb.ByteUtils.bytesToString(
                                    e.target.result
                                );
                                this.params.name = file.name.replace(/\.\w+$/i, '');
                                this.params.path = null;
                                this.params.storage = null;
                                this.params.rev = null;
                                this.encryptedPassword = null;
                                this.importDbWithXml();
                                this.displayOpenDeviceOwnerAuth();
                                success = true;
                                break;
                            case 'kdb':
                                Alerts.error({
                                    header: Locale.openWrongFile,
                                    body: Locale.openKdbFileBody
                                });
                                break;
                            default:
                                Alerts.error({
                                    header: Locale.openWrongFile,
                                    body: Locale.openWrongFileBody
                                });
                                break;
                        }
                        break;
                    }
                    case 'keyFileData':
                        this.params.keyFileData = e.target.result;
                        this.params.keyFileName = file.name;
                        if (this.model.settings.rememberKeyFiles === 'path') {
                            this.params.keyFilePath = file.path;
                        }
                        this.displayOpenKeyFile();
                        success = true;
                        break;
                }
                if (complete) {
                    complete(success);
                }
            };
            reader.onerror = () => {
                Alerts.error({ header: Locale.openFailedRead });
                if (complete) {
                    complete(false);
                }
            };
            if (this.reading === 'fileXml') {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        },

        getOpenFileFormat(fileData) {
            if (fileData.byteLength < 8) {
                return undefined;
            }
            const fileSig = new Uint32Array(fileData, 0, 2);
            if (fileSig[0] === kdbxweb.Consts.Signatures.FileMagic) {
                if (fileSig[1] === kdbxweb.Consts.Signatures.Sig2Kdb) {
                    return 'kdb';
                } else if (fileSig[1] === kdbxweb.Consts.Signatures.Sig2Kdbx) {
                    return 'kdbx';
                } else {
                    return undefined;
                }
            } else if (this.model.settings.canImportXml) {
                try {
                    const str = kdbxweb.ByteUtils.bytesToString(fileSig).trim();
                    if (str.startsWith('<?xml')) {
                        return 'xml';
                    }
                } catch (e) {}
                return undefined;
            } else {
                return undefined;
            }
        },

        displayOpenFile() {
            this.$el.addClass('open--file');
            this.$el.find('.open__settings-key-file,.open__settings-yubikey').removeClass('hide');
            this.inputEl[0].removeAttribute('readonly');
            this.inputEl[0].setAttribute(
                'placeholder',
                Locale.openPassFor + ' ' + this.params.name
            );
            this.focusInput();
        },

        displayOpenKeyFile() {
            this.$el.toggleClass('open--key-file', !!this.params.keyFileName);
            this.$el
                .find('.open__settings-key-file-name')
                .text(this.params.keyFileName || this.params.keyFilePath || Locale.openKeyFile);
            this.focusInput();
        },

        displayOpenChalResp() {
            this.$el
                .find('.open__settings-yubikey')
                .toggleClass('open__settings-yubikey--active', !!this.params.chalResp);
        },

        displayOpenDeviceOwnerAuth() {
            const available = !!this.encryptedPassword;
            const passEmpty = !this.passwordInput.length;
            const canUseEncryptedPassword = available && passEmpty;
            this.el
                .querySelector('.open__pass-enter-btn')
                .classList.toggle('open__pass-enter-btn--touch-id', canUseEncryptedPassword);
            if (canUseEncryptedPassword) {
                this.maybeAutoTriggerDeviceOwnerAuth();
            }
        },

        getCurrentAutoUnlockRef() {
            return (
                this.params.id ||
                [this.params.storage, this.params.path, this.params.name].join('|')
            );
        },

        maybeAutoTriggerDeviceOwnerAuth() {
            if (
                this.busy ||
                !this.params.name ||
                !this.encryptedPassword ||
                this.passwordInput.length ||
                !FocusDetector.hasFocus()
            ) {
                return;
            }

            const unlockRef = this.getCurrentAutoUnlockRef();
            if (!unlockRef || this.autoUnlockAttemptedRef === unlockRef) {
                return;
            }

            this.autoUnlockAttemptedRef = unlockRef;
            this.afterPaint(() => {
                if (
                    this.getCurrentAutoUnlockRef() !== unlockRef ||
                    this.busy ||
                    !this.encryptedPassword ||
                    this.passwordInput.length ||
                    !FocusDetector.hasFocus()
                ) {
                    return;
                }
                this.openDb();
            });
        },

        setFile(file, keyFile, fileReadyCallback) {
            this.reading = 'fileData';
            this.processFile(file, (success) => {
                if (success && keyFile) {
                    this.reading = 'keyFileData';
                    this.processFile(keyFile);
                }
                if (success && typeof fileReadyCallback === 'function') {
                    fileReadyCallback();
                }
            });
        },

        openFile() {
            if (this.model.settings.canOpen === false) {
                return;
            }
            if (!this.busy) {
                this.closeConfig();
                this.openAny('fileData');
            }
        },

        openKeyFile(e) {
            if ($(e.target).hasClass('open__settings-key-file-dropbox')) {
                this.openKeyFileFromDropbox();
            } else if (!this.busy && this.params.name) {
                if (this.params.keyFileName) {
                    this.params.keyFileData = null;
                    this.params.keyFilePath = null;
                    this.params.keyFileName = '';
                    this.$el.removeClass('open--key-file');
                    this.$el.find('.open__settings-key-file-name').text(Locale.openKeyFile);
                } else {
                    this.openAny('keyFileData');
                }
            }
        },

        openKeyFileFromDropbox() {
            if (!this.busy) {
                new DropboxChooser((err, res) => {
                    if (err) {
                        return;
                    }
                    this.params.keyFileData = res.data;
                    this.params.keyFileName = res.name;
                    this.displayOpenKeyFile();
                }).choose();
            }
        },

        openAny(reading, ext) {
            this.reading = reading;
            this.params[reading] = null;

            const fileInput = this.$el
                .find('.open__file-ctrl')
                .attr('accept', ext || '')
                .val(null);

            if (Launcher && Launcher.openFileChooser) {
                Launcher.openFileChooser((err, file) => {
                    if (err) {
                        logger.error('Error opening file chooser', err);
                    } else {
                        this.processFile(file);
                    }
                });
            } else {
                fileInput.click();
            }
        },

        openLast(e) {
            if (this.busy) {
                return;
            }
            const id = $(e.target).closest('.open__last-item').data('id').toString();
            if ($(e.target).is('.open__last-item-icon-del')) {
                const fileInfo = this.model.fileInfos.get(id);
                if (!fileInfo.storage || fileInfo.modified) {
                    Alerts.yesno({
                        header: Locale.openRemoveLastQuestion,
                        body: fileInfo.modified
                            ? Locale.openRemoveLastQuestionModBody
                            : Locale.openRemoveLastQuestionBody,
                        buttons: [
                            { result: 'yes', title: Locale.alertYes },
                            { result: '', title: Locale.alertNo }
                        ],
                        success: () => {
                            this.removeFile(id);
                        }
                    });
                    return;
                }
                this.removeFile(id);
                return;
            }

            const fileInfo = this.model.fileInfos.get(id);
            this.showOpenFileInfo(fileInfo, true);
        },

        removeFile(id) {
            this.model.removeFileInfo(id);
            this.$el.find('.open__last-item[data-id="' + id + '"]').remove();
            this.resetParams();
            this.render();
        },

        inputKeydown(e) {
            const code = e.keyCode || e.which;
            if (code === Keys.DOM_VK_RETURN) {
                this.openDb();
            } else if (code === Keys.DOM_VK_CAPS_LOCK) {
                this.toggleCapsLockWarning(false);
            }
        },

        inputKeyup(e) {
            const code = e.keyCode || e.which;
            if (code === Keys.DOM_VK_CAPS_LOCK) {
                this.toggleCapsLockWarning(false);
            }
        },

        inputKeypress(e) {
            const charCode = e.keyCode || e.which;
            const ch = String.fromCharCode(charCode);
            const lower = ch.toLowerCase();
            const upper = ch.toUpperCase();
            if (lower !== upper && !e.shiftKey) {
                this.toggleCapsLockWarning(ch !== lower);
            }
        },

        inputInput() {
            this.displayOpenDeviceOwnerAuth();
        },

        toggleCapsLockWarning(on) {
            this.$el.find('.open__pass-warning').toggleClass('invisible', !on);
        },

        dragover(e) {
            if (this.model.settings.canOpen === false) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const dt = e.dataTransfer;
            if (
                !dt.types ||
                (dt.types.indexOf ? dt.types.indexOf('Files') === -1 : !dt.types.contains('Files'))
            ) {
                dt.dropEffect = 'none';
                return;
            }
            dt.dropEffect = 'copy';
            if (this.dragTimeout) {
                clearTimeout(this.dragTimeout);
            }
            if (!this.$el.hasClass('open--drag')) {
                this.$el.addClass('open--drag');
            }
        },

        dragleave() {
            if (this.model.settings.canOpen === false) {
                return;
            }
            if (this.dragTimeout) {
                clearTimeout(this.dragTimeout);
            }
            this.dragTimeout = setTimeout(() => {
                this.$el.removeClass('open--drag');
            }, 100);
        },

        drop(e) {
            if (this.model.settings.canOpen === false) {
                return;
            }
            e.preventDefault();
            if (this.busy) {
                return;
            }
            if (this.dragTimeout) {
                clearTimeout(this.dragTimeout);
            }
            this.closeConfig();
            this.$el.removeClass('open--drag');
            const files = [...(e.target.files || e.dataTransfer.files)];
            const dataFile = files.find((file) => /\.kdbx$/i.test(file.name));
            const keyFile = files.find((file) => /\.keyx?$/i.test(file.name));
            if (dataFile) {
                this.setFile(
                    dataFile,
                    keyFile,
                    dataFile.path ? null : this.showLocalFileAlert.bind(this)
                );
                return;
            }
            if (this.model.settings.canImportXml) {
                const xmlFile = files.find((file) => /\.xml$/i.test(file.name));
                if (xmlFile) {
                    this.setFile(xmlFile, null, this.showLocalFileAlert.bind(this));
                    return;
                }
            }
            if (this.model.settings.canImportCsv) {
                const csvFile = files.find((file) => /\.csv$/i.test(file.name));
                if (csvFile) {
                    Events.emit('import-csv-requested', csvFile);
                }
            }
        },

        undoKeyPress(e) {
            e.preventDefault();
        },

        tabKeyPress() {
            this.$el.addClass('open--show-focus');
        },

        enterKeyPress(e) {
            const el = this.$el.find('[tabindex]:focus');
            if (el.length) {
                el.trigger('click', e);
            }
        },

        showOpenFileInfo(fileInfo, fileWasClicked) {
            if (this.busy || !fileInfo) {
                return;
            }
            this.params.id = fileInfo.id;
            this.params.storage = fileInfo.storage;
            this.params.path = fileInfo.path;
            this.params.name = fileInfo.name;
            this.params.fileData = null;
            this.params.rev = null;
            this.params.keyFileName = fileInfo.keyFileName;
            this.params.keyFilePath = fileInfo.keyFilePath;
            this.params.keyFileData = null;
            this.params.opts = fileInfo.opts;
            this.params.chalResp = fileInfo.chalResp;
            this.setEncryptedPassword(fileInfo);

            this.displayOpenFile();
            this.displayOpenKeyFile();
            this.displayOpenChalResp();
            this.displayOpenDeviceOwnerAuth();

            if (fileWasClicked) {
                this.focusInput(true);
            }
        },

        showOpenLocalFile(path, keyFilePath) {
            if (this.busy) {
                return;
            }
            this.params.id = null;
            this.params.storage = 'file';
            this.params.path = path;
            this.params.name = path.match(/[^/\\]*$/)[0];
            this.params.rev = null;
            this.params.fileData = null;
            this.encryptedPassword = null;
            this.displayOpenFile();
            this.displayOpenDeviceOwnerAuth();
            if (keyFilePath) {
                const parsed = Launcher.parsePath(keyFilePath);
                this.params.keyFileName = parsed.file;
                this.params.keyFilePath = keyFilePath;
                this.params.keyFileData = null;
                this.displayOpenKeyFile();
            }
        }
    };
}

export { createOpenViewFileInputMixin };

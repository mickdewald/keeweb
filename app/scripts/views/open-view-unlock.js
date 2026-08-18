function createOpenViewUnlockMixin({
    Events,
    Alerts,
    UsbListener,
    YubiKey,
    Features,
    Locale,
    OpenChalRespView,
    GeneratorView
}) {
    return {
        moveOpenFileSelection(steps) {
            const lastOpenFiles = this.getLastOpenFiles();
            if (
                this.currentSelectedIndex + steps >= 0 &&
                this.currentSelectedIndex + steps <= lastOpenFiles.length - 1
            ) {
                this.currentSelectedIndex = this.currentSelectedIndex + steps;
            }

            const lastOpenFile = lastOpenFiles[this.currentSelectedIndex];
            if (!lastOpenFile) {
                return;
            }
            const fileInfo = this.model.fileInfos.get(lastOpenFiles[this.currentSelectedIndex].id);
            this.showOpenFileInfo(fileInfo);
        },

        moveOpenFileSelectionDown() {
            this.moveOpenFileSelection(1);
        },

        moveOpenFileSelectionUp() {
            this.moveOpenFileSelection(-1);
        },

        toggleGenerator(e) {
            e.stopPropagation();
            if (this.views.gen) {
                this.views.gen.remove();
                return;
            }
            const el = this.$el.find('.open__icon-generate');
            const rect = el[0].getBoundingClientRect();
            const pos = {
                left: rect.left,
                top: rect.top
            };
            if (Features.isMobile) {
                pos.left = '50vw';
                pos.top = '50vh';
                pos.transform = 'translate(-50%, -50%)';
            }
            const generator = new GeneratorView({
                copy: true,
                noTemplateEditor: true,
                pos
            });
            generator.render();
            generator.once('remove', () => {
                delete this.views.gen;
            });
            this.views.gen = generator;
        },

        userIdle() {
            this.inputEl.val('');
            this.passwordInput.reset();
            this.passwordInput.setElement(this.inputEl);
        },

        usbDevicesChanged() {
            if (this.model.settings.canOpenOtpDevice) {
                const hasYubiKeys = !!UsbListener.attachedYubiKeys;

                const showOpenIcon = hasYubiKeys && this.model.settings.yubiKeyShowIcon;
                this.$el.find('.open__icon-yubikey').toggleClass('hide', !showOpenIcon);

                const showChallengeResponseIcon =
                    hasYubiKeys && this.model.settings.yubiKeyShowChalResp;
                this.$el
                    .find('.open__settings-yubikey')
                    .toggleClass('open__settings-yubikey--present', !!showChallengeResponseIcon);

                if (!hasYubiKeys && this.busy && this.otpDevice) {
                    this.otpDevice.cancelOpen();
                }
            }
        },

        openYubiKey() {
            if (this.busy && this.otpDevice) {
                this.otpDevice.cancelOpen();
            }
            if (!this.busy) {
                this.busy = true;
                this.inputEl.attr('disabled', 'disabled');
                const icon = this.$el.find('.open__icon-yubikey');
                icon.toggleClass('flip3d', true);

                YubiKey.checkToolStatus().then((status) => {
                    if (status !== 'ok') {
                        icon.toggleClass('flip3d', false);
                        this.inputEl.removeAttr('disabled');
                        this.busy = false;
                        return Events.emit('toggle-settings', 'devices');
                    }
                    this.otpDevice = this.model.openOtpDevice((err) => {
                        if (err && !YubiKey.aborted) {
                            Alerts.error({
                                header: Locale.openError,
                                body: Locale.openErrorDescription,
                                pre: this.errorToString(err)
                            });
                        }
                        this.otpDevice = null;
                        icon.toggleClass('flip3d', false);
                        this.inputEl.removeAttr('disabled');
                        this.busy = false;
                    });
                });
            }
        },

        selectYubiKeyChalResp() {
            if (this.busy) {
                return;
            }

            if (this.params.chalResp) {
                this.params.chalResp = null;
                this.el
                    .querySelector('.open__settings-yubikey')
                    .classList.remove('open__settings-yubikey--active');
                this.focusInput();
                return;
            }

            const chalRespView = new OpenChalRespView();
            chalRespView.on('select', ({ vid, pid, serial, slot }) => {
                this.params.chalResp = { vid, pid, serial, slot };
                this.el
                    .querySelector('.open__settings-yubikey')
                    .classList.add('open__settings-yubikey--active');
                this.focusInput();
            });

            Alerts.alert({
                header: Locale.openChalRespHeader,
                icon: 'usb-token',
                buttons: [{ result: '', title: Locale.alertCancel }],
                esc: '',
                click: '',
                view: chalRespView
            });
        },

        errorToString(err) {
            const str = err.toString();
            if (str !== {}.toString()) {
                return str;
            }
            if (err.ykError && err.code) {
                return Locale.yubiKeyErrorWithCode.replace('{}', err.code);
            }
            return undefined;
        },

        setEncryptedPassword(fileInfo) {
            this.encryptedPassword = null;
            if (!fileInfo.id) {
                return;
            }
            switch (this.model.settings.deviceOwnerAuth) {
                case 'memory':
                    this.encryptedPassword = this.model.getMemoryPassword(fileInfo.id);
                    break;
                case 'file':
                    this.encryptedPassword = {
                        value: fileInfo.encryptedPassword,
                        date: fileInfo.encryptedPasswordDate
                    };
                    break;
            }
            this.checkIfEncryptedPasswordDateIsValid();
        },

        checkIfEncryptedPasswordDateIsValid() {
            if (this.encryptedPassword) {
                const maxDate = new Date(this.encryptedPassword.date);
                maxDate.setMinutes(
                    maxDate.getMinutes() + this.model.settings.deviceOwnerAuthTimeoutMinutes
                );
                if (maxDate < new Date()) {
                    this.encryptedPassword = null;
                }
            }
        },

        unlockMessageChanged(unlockMessageRes) {
            const messageEl = this.el.querySelector('.open__message');
            messageEl.classList.toggle('hide', !unlockMessageRes);

            if (unlockMessageRes) {
                const contentEl = this.el.querySelector('.open__message-content');
                contentEl.innerText = Locale[unlockMessageRes];
            }
        },

        openMessageCancelClick() {
            this.model.rejectPendingFileUnlockPromise('User canceled');
        }
    };
}

export { createOpenViewUnlockMixin };

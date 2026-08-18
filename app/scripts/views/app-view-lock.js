import { Events } from 'framework/events';
import { Launcher } from 'comp/launcher';
import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';

const AppViewLockMixin = {
    launcherBeforeQuit() {
        // this is currently called only on macos
        const event = {
            preventDefault() {}
        };
        const result = this.beforeUnload(event);
        if (result !== false) {
            Launcher.exit();
        }
    },

    beforeUnload(e) {
        const exitEvent = {
            preventDefault() {
                this.prevented = true;
            }
        };
        Events.emit('main-window-will-close', exitEvent);
        if (exitEvent.prevented) {
            return Launcher ? Launcher.preventExit(e) : false;
        }

        let minimizeInsteadOfClose = this.model.settings.minimizeOnClose;
        if (Launcher?.quitOnRealQuitEventIfMinimizeOnQuitIsEnabled()) {
            minimizeInsteadOfClose = false;
        }

        if (this.model.files.hasDirtyFiles()) {
            if (Launcher) {
                const exit = () => {
                    if (minimizeInsteadOfClose) {
                        Launcher.minimizeApp();
                    } else {
                        Launcher.exit();
                    }
                };
                if (Launcher.exitRequested) {
                    return;
                }
                if (!this.exitAlertShown) {
                    if (this.model.settings.autoSave) {
                        this.saveAndLock(
                            (result) => {
                                if (result) {
                                    exit();
                                }
                            },
                            { appClosing: true }
                        );
                        return Launcher.preventExit(e);
                    }
                    this.exitAlertShown = true;
                    Alerts.yesno({
                        header: Locale.appUnsavedWarn,
                        body: Locale.appUnsavedWarnBody,
                        buttons: [
                            { result: 'save', title: Locale.saveChanges },
                            { result: 'exit', title: Locale.discardChanges, error: true },
                            { result: '', title: Locale.appDontExitBtn }
                        ],
                        success: (result) => {
                            if (result === 'save') {
                                this.saveAndLock(
                                    (result) => {
                                        if (result) {
                                            exit();
                                        }
                                    },
                                    { appClosing: true }
                                );
                            } else {
                                exit();
                            }
                        },
                        cancel: () => {
                            Launcher.cancelRestart(false);
                        },
                        complete: () => {
                            this.exitAlertShown = false;
                        }
                    });
                }
                return Launcher.preventExit(e);
            }
            return Locale.appUnsavedWarnBody;
        } else if (
            Launcher &&
            !Launcher.exitRequested &&
            !Launcher.restartPending &&
            minimizeInsteadOfClose
        ) {
            Launcher.minimizeApp();
            this.appMinimized();
            return Launcher.preventExit(e);
        }
    },

    userIdle() {
        this.lockWorkspace(true);
    },

    osLocked() {
        if (this.model.settings.lockOnOsLock) {
            this.lockWorkspace(true);
        }
    },

    appMinimized() {
        if (this.model.settings.lockOnMinimize) {
            this.lockWorkspace(true);
        }
    },

    lockWorkspace(autoInit) {
        if (Alerts.alertDisplayed) {
            return;
        }
        if (this.model.files.hasUnsavedFiles()) {
            if (this.model.settings.autoSave) {
                this.saveAndLock();
            } else {
                const message = autoInit ? Locale.appCannotLockAutoInit : Locale.appCannotLock;
                Alerts.alert({
                    icon: 'lock',
                    header: 'Lock',
                    body: message,
                    buttons: [
                        { result: 'save', title: Locale.saveChanges },
                        { result: 'discard', title: Locale.discardChanges, error: true },
                        { result: '', title: Locale.alertCancel }
                    ],
                    checkbox: Locale.appAutoSave,
                    success: (result, autoSaveChecked) => {
                        if (result === 'save') {
                            if (autoSaveChecked) {
                                this.model.settings.autoSave = autoSaveChecked;
                            }
                            this.saveAndLock();
                        } else if (result === 'discard') {
                            this.model.closeAllFiles();
                        }
                    }
                });
            }
        } else {
            this.closeAllFilesAndShowFirst();
        }
    },

    saveAndLock(complete, options) {
        let pendingCallbacks = 0;
        const errorFiles = [];
        this.model.files.forEach(function (file) {
            if (!file.dirty) {
                return;
            }
            this.model.syncFile(file, null, fileSaved.bind(this, file));
            pendingCallbacks++;
        }, this);
        if (!pendingCallbacks) {
            this.closeAllFilesAndShowFirst();
        }
        function fileSaved(file, err) {
            if (err) {
                errorFiles.push(file.name);
            }
            if (--pendingCallbacks === 0) {
                if (errorFiles.length && this.model.files.hasDirtyFiles()) {
                    if (!Alerts.alertDisplayed) {
                        const buttons = [Alerts.buttons.ok];
                        const errorStr =
                            errorFiles.length > 1
                                ? Locale.appSaveErrorBodyMul
                                : Locale.appSaveErrorBody;
                        let body = errorStr + ' ' + errorFiles.join(', ') + '.';
                        if (options?.appClosing) {
                            buttons.unshift({
                                result: 'ignore',
                                title: Locale.appSaveErrorExitLoseChanges,
                                error: true
                            });
                            body += '\n' + Locale.appSaveErrorExitLoseChangesBody;
                        }
                        Alerts.error({
                            header: Locale.appSaveError,
                            body,
                            buttons,
                            complete: (res) => {
                                if (res === 'ignore') {
                                    this.model.closeAllFiles();
                                    if (complete) {
                                        complete(true);
                                    }
                                } else {
                                    if (complete) {
                                        complete(false);
                                    }
                                }
                            }
                        });
                    } else {
                        if (complete) {
                            complete(false);
                        }
                    }
                } else {
                    this.closeAllFilesAndShowFirst();
                    if (complete) {
                        complete(true);
                    }
                }
            }
        }
    },

    closeAllFilesAndShowFirst() {
        if (!this.model.files.hasOpenFiles()) {
            return;
        }
        let fileToShow = this.model.files.find(
            (file) => !file.demo && !file.created && !file.skipOpenList
        );
        this.model.closeAllFiles();
        if (!fileToShow) {
            fileToShow = this.model.fileInfos[0];
        }
        if (fileToShow) {
            const fileInfo = this.model.fileInfos.getMatch(
                fileToShow.storage,
                fileToShow.name,
                fileToShow.path
            );
            if (fileInfo) {
                this.views.open.showOpenFileInfo(fileInfo);
            }
        }
    }
};

export { AppViewLockMixin };

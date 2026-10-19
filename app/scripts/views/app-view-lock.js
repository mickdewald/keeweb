import { Events } from 'framework/events';
import { Launcher } from 'comp/launcher';
import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';
import * as BackgroundLockState from 'models/background-lock-state';

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
            Launcher?.cancelRestart();
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
                                } else {
                                    Launcher.cancelRestart();
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
                                        } else {
                                            Launcher.cancelRestart();
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

    appMinimized(options) {
        if (this.model.settings.lockOnMinimize || options?.forceSave) {
            this.lockWorkspace(true, options);
        }
    },

    lockWorkspace(autoInit, options = {}) {
        if (Alerts.alertDisplayed) {
            return;
        }
        if (options.forceSave) {
            this.saveAndLock(null, this.getBackgroundLockSaveOptions(options));
        } else if (this.model.files.hasUnsavedFiles()) {
            if (this.model.settings.autoSave || options.forceSave) {
                this.saveAndLock(
                    null,
                    options.forceSave ? this.getBackgroundLockSaveOptions(options) : options
                );
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
        options = options || {};
        const useBackgroundLockBoundary = Boolean(
            options?.cacheOnly || options?.forceSave || typeof options?.lockGeneration === 'number'
        );
        const lockGeneration = useBackgroundLockBoundary
            ? this.beginBackgroundLockBoundary(options.lockGeneration)
            : null;
        const errorFiles = [];
        const saveFile = options?.cacheOnly
            ? (file, callback) => this.model.cacheFileForLock(file, callback)
            : (file, callback) => {
                  if (file.syncing && file.once) {
                      file.once('change:syncing', (_file, syncing) => {
                          if (!syncing) {
                              Promise.resolve().then(() => saveFile(file, callback));
                          }
                      });
                      return;
                  }
                  this.model.syncFile(file, null, callback);
              };
        const savePending = () => {
            let pendingCallbacks = 0;
            const filesToSave = this.getFilesToSaveBeforeLock(options);
            pendingCallbacks = filesToSave.length;
            filesToSave.forEach((file) =>
                saveFile(file, (err) => {
                    if (file.lockCacheInProgress) {
                        Promise.resolve().then(() => fileSaved.call(this, file, err));
                    } else {
                        fileSaved.call(this, file, err);
                    }
                })
            );
            if (!filesToSave.length) {
                this.closeAllFilesAndShowFirst();
                if (useBackgroundLockBoundary) {
                    this.finishBackgroundLockBoundary(lockGeneration);
                }
                if (complete) {
                    complete(true);
                }
            }
            function fileSaved(file, err) {
                if (err) {
                    errorFiles.push(file.name);
                }
                if (--pendingCallbacks === 0) {
                    if (
                        errorFiles.length &&
                        (options?.cacheOnly || this.model.files.hasDirtyFiles())
                    ) {
                        if (useBackgroundLockBoundary) {
                            Events.emit('background-lock-failed', {
                                model: this.model,
                                generation: lockGeneration
                            });
                        }
                        this.showLockSaveError(errorFiles, options, complete);
                    } else {
                        savePending();
                    }
                }
            }
        };
        savePending();
    },

    beginBackgroundLockBoundary(lockGeneration) {
        const generation =
            typeof lockGeneration === 'number'
                ? BackgroundLockState.activateBackgroundLock(this.model, lockGeneration)
                : BackgroundLockState.beginBackgroundLock(this.model);
        this.$el?.addClass('app--background-locking');
        return generation;
    },

    finishBackgroundLockBoundary(generation) {
        BackgroundLockState.finishBackgroundLock(this.model, generation);
        this.$el?.removeClass('app--background-locking');
    },

    getBackgroundLockSaveOptions(options = {}) {
        return { ...options, cacheOnly: true };
    },

    getFilesToSaveBeforeLock(options) {
        if (!this.model.files.filter) {
            return [];
        }
        return this.model.files.filter((file) => {
            if (file.demo || file.active === false) {
                return false;
            }
            if (options?.cacheOnly) {
                return (
                    file.pendingMutations ||
                    file.syncing ||
                    file.lockCacheInProgress ||
                    (file.dirty && typeof file.editVersion !== 'number') ||
                    file.lockCacheEditVersion !== file.editVersion
                );
            }
            return file.dirty || file.pendingMutations || file.syncing;
        });
    },

    showLockSaveError(errorFiles, options, complete) {
        if (!Alerts.alertDisplayed) {
            const buttons = [Alerts.buttons.ok];
            const errorStr =
                errorFiles.length > 1 ? Locale.appSaveErrorBodyMul : Locale.appSaveErrorBody;
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
                    } else if (complete) {
                        complete(false);
                    }
                }
            });
        } else if (complete) {
            complete(false);
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

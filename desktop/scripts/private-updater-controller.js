class PrivateUpdaterController {
    constructor({
        app,
        autoUpdater,
        dialog,
        fetchRelease,
        settings,
        saveSettings,
        build,
        log,
        prepareDownload,
        progress
    }) {
        Object.assign(this, {
            app,
            autoUpdater,
            dialog,
            fetchRelease,
            settings,
            saveSettings,
            build,
            log,
            prepareDownload,
            progress
        });
        this.busy = false;
        this.ready = false;
        this.installRequested = false;
        autoUpdater.on('error', (error) => this.fail(error));
        autoUpdater.on('update-not-available', () => this.fail(new Error('Update not available')));
        autoUpdater.on('update-downloaded', () => {
            this.clearProgress();
            this.busy = false;
            this.ready = true;
            this.offerRestart().catch((error) => this.fail(error));
        });
    }

    start() {
        this.startTimer = setTimeout(() => this.check(false), 10000);
        this.timer = setInterval(() => this.check(false), 24 * 60 * 60 * 1000);
        this.startTimer.unref();
        this.timer.unref();
    }

    async setAutomatic(enabled) {
        const next = { ...this.settings, automatic: enabled };
        await this.saveSettings(next);
        this.settings = next;
    }

    async check(manual = true) {
        if (this.busy) {
            if (manual && this.progressState) this.progress.open(this.progressState);
            return;
        }
        if (!manual && this.settings.automatic === false) return;
        if (this.ready) {
            if (manual) {
                await this.offerRestart();
            }
            return;
        }
        this.busy = true;
        this.manual = manual;
        try {
            const release = await this.fetchRelease(this.build);
            if (!release) {
                if (manual) {
                    await this.dialog.showMessageBox({
                        type: 'info',
                        message: 'KeeWeb ist aktuell.',
                        detail: `Build ${this.build}`,
                        buttons: ['OK']
                    });
                }
                this.busy = false;
                return;
            }
            const { response } = await this.dialog.showMessageBox({
                type: 'info',
                message: 'Ein KeeWeb-Update ist verfügbar.',
                detail: `Version ${release.version} · Build ${release.build}\nJetzt herunterladen? Das Update wird beim nächsten Beenden installiert.`,
                buttons: ['Herunterladen', 'Später'],
                defaultId: 0,
                cancelId: 1
            });
            if (response !== 0) {
                this.busy = false;
                return;
            }
            this.manual = true;
            this.downloadAbort = new AbortController();
            this.progressState = {
                phase: 'downloading',
                version: release.version,
                received: 0,
                total: 0
            };
            this.progress.open(this.progressState);
            this.prepared = await this.prepareDownload(
                release,
                this.downloadAbort.signal,
                (value) => {
                    this.progressState = { ...this.progressState, ...value };
                    this.progress.update(this.progressState);
                }
            );
            this.downloadAbort = null;
            this.progressState = { ...this.progressState, phase: 'verifying' };
            this.progress.update(this.progressState);
            this.autoUpdater.setFeedURL({ url: this.prepared.updateURL });
            this.autoUpdater.checkForUpdates();
        } catch (error) {
            if (this.downloadAbort?.signal.aborted) {
                this.busy = false;
                this.clearProgress();
            } else {
                this.fail(error);
            }
        }
    }

    cancelDownload() {
        this.downloadAbort?.abort();
    }

    clearProgress() {
        this.downloadAbort?.abort();
        this.downloadAbort = null;
        this.progressState = null;
        this.progress.close();
        this.prepared?.dispose().catch((error) => this.log(`Update cleanup: ${error.message}`));
        this.prepared = null;
    }

    async offerRestart() {
        if (this.installRequested || this.promptingRestart) {
            return;
        }
        this.promptingRestart = true;
        try {
            const { response } = await this.dialog.showMessageBox({
                type: 'info',
                message: 'Das KeeWeb-Update ist bereit.',
                detail:
                    'KeeWeb prüft vor dem Neustart auf ungespeicherte Änderungen. Du kannst das Beenden abbrechen.',
                buttons: ['Neu starten', 'Später'],
                defaultId: 0,
                cancelId: 1
            });
            if (response === 0) {
                this.installRequested = true;
                // Normal quit first: the renderer gets its existing save/cancel flow.
                this.app.quit();
            }
        } finally {
            this.promptingRestart = false;
        }
    }

    finishInstall(event) {
        if (!this.installRequested || !this.ready) {
            return;
        }
        event.preventDefault();
        this.installRequested = false;
        this.ready = false;
        this.autoUpdater.quitAndInstall();
    }

    cancelInstall() {
        this.installRequested = false;
    }

    fail(error) {
        this.clearProgress();
        this.busy = false;
        this.log(`Private updater: ${error.message}`);
        if (this.manual) {
            this.dialog
                .showMessageBox({
                    type: 'error',
                    message: 'KeeWeb konnte das Update nicht laden.',
                    detail:
                        'Bitte versuche es später erneut. Deine Datenbanken bleiben unverändert.',
                    buttons: ['OK']
                })
                .catch(() => {});
        }
    }
}

module.exports = { PrivateUpdaterController };

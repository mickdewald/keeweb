import * as kdbxweb from 'kdbxweb';
import BaseLocale from 'locales/base.json';
import { SettingsManager } from 'comp/settings/settings-manager';
import { AppSettingsModel } from 'models/app-settings-model';
import { PluginApi } from 'plugins/plugin-api';

function createPluginLifecycleMixin(PluginStatus) {
    return {
        applyJs(name, data) {
            return new Promise((resolve, reject) => {
                try {
                    let text = kdbxweb.ByteUtils.bytesToString(data);
                    this.module = { exports: {} };
                    const jsVar = 'plugin-' + Date.now().toString() + Math.random().toString();
                    global[jsVar] = {
                        require: PluginApi.require,
                        module: this.module
                    };
                    text = `(function(require, module){${text}})(window["${jsVar}"].require,window["${jsVar}"].module);`;
                    const ts = this.logger.ts();

                    // Note that here we're calling eval to run the plugin code,
                    // previously it was loaded as 'blob:' scheme (see the code below), however:
                    // 1. we need to have eval enabled in our CSP anyway for WASM,
                    //      see https://github.com/WebAssembly/content-security-policy/issues/7
                    // 2. we would like to prevent Chrome extensions from injecting scripts to our page,
                    //      which is possible to do if we have 'blob:', but they can't call eval
                    // Previous implementation with 'blob:' can be found in git, if we ever need to restore it.

                    // eslint-disable-next-line no-eval
                    eval(text);
                    setTimeout(() => {
                        delete global[jsVar];
                        if (this.module.exports.uninstall) {
                            this.logger.debug('Plugin script installed', this.logger.ts(ts));
                            this.loadPluginSettings();
                            resolve();
                        } else {
                            reject('Plugin script installation failed');
                        }
                    }, 0);
                } catch (e) {
                    this.logger.error('Error installing plugin script', e);
                    reject(e);
                }
            });
        },

        createElementInHead(tagName, id, attrs) {
            let el = document.getElementById(id);
            if (el) {
                el.parentNode.removeChild(el);
            }
            el = document.createElement(tagName);
            el.setAttribute('id', id);
            for (const [name, value] of Object.entries(attrs)) {
                el.setAttribute(name, value);
            }
            document.head.appendChild(el);
            return el;
        },

        removeElement(id) {
            const el = document.getElementById(id);
            if (el) {
                el.parentNode.removeChild(el);
            }
        },

        applyLoc(locale, data) {
            return Promise.resolve().then(() => {
                const text = kdbxweb.ByteUtils.bytesToString(data);
                const localeData = JSON.parse(text);
                SettingsManager.allLocales[locale.name] = locale.title;
                SettingsManager.customLocales[locale.name] = localeData;
                this.logger.debug('Plugin locale installed');
            });
        },

        removeLoc(locale) {
            delete SettingsManager.allLocales[locale.name];
            delete SettingsManager.customLocales[locale.name];
            if (SettingsManager.activeLocale === locale.name) {
                AppSettingsModel.locale = 'en-US';
            }
        },

        getThemeLocaleKey(name) {
            return `setGenThemeCustom_${name}`;
        },

        removeTheme(theme) {
            delete SettingsManager.allThemes[theme.name];
            if (AppSettingsModel.theme === theme.name) {
                AppSettingsModel.theme = SettingsManager.getDefaultTheme();
            }
            delete BaseLocale[this.getThemeLocaleKey(theme.name)];
        },

        loadPluginSettings() {
            if (!this.module || !this.module.exports || !this.module.exports.setSettings) {
                return;
            }
            const ts = this.logger.ts();
            const settingPrefix = this.getSettingPrefix();
            let settings = null;
            for (const key of Object.keys(AppSettingsModel)) {
                if (key.lastIndexOf(settingPrefix, 0) === 0) {
                    if (!settings) {
                        settings = {};
                    }
                    settings[key.replace(settingPrefix, '')] = AppSettingsModel[key];
                }
            }
            if (settings) {
                this.setSettings(settings);
            }
            this.logger.debug('Plugin settings loaded', this.logger.ts(ts));
        },

        uninstallPluginCode() {
            if (
                this.manifest.resources.js &&
                this.module &&
                this.module.exports &&
                this.module.exports.uninstall
            ) {
                try {
                    this.module.exports.uninstall();
                } catch (e) {
                    this.logger.error('Plugin uninstall method returned an error', e);
                }
            }
        },

        uninstall() {
            const ts = this.logger.ts();
            return this.disable().then(() => {
                return this.deleteResources().then(() => {
                    this.status = '';
                    this.logger.info('Uninstall complete', this.logger.ts(ts));
                });
            });
        },

        disable() {
            const manifest = this.manifest;
            this.logger.info(
                'Disabling plugin with resources',
                Object.keys(manifest.resources).join(', ')
            );
            this.status = PluginStatus.STATUS_UNINSTALLING;
            const ts = this.logger.ts();
            return Promise.resolve().then(() => {
                if (manifest.resources.css) {
                    this.removeElement('plugin-css-' + this.name);
                }
                if (manifest.resources.js) {
                    this.uninstallPluginCode();
                }
                if (manifest.resources.loc) {
                    this.removeLoc(this.manifest.locale);
                }
                if (manifest.theme) {
                    this.removeTheme(manifest.theme);
                }
                this.status = PluginStatus.STATUS_INACTIVE;
                this.logger.info('Disable complete', this.logger.ts(ts));
            });
        },

        update(newPlugin) {
            const ts = this.logger.ts();
            const prevStatus = this.status;
            this.status = PluginStatus.STATUS_UPDATING;
            return Promise.resolve().then(() => {
                const manifest = this.manifest;
                const newManifest = newPlugin.manifest;
                if (manifest.version === newManifest.version) {
                    this.set({
                        status: prevStatus,
                        updateCheckDate: Date.now(),
                        updateError: null
                    });
                    this.logger.info(`v${manifest.version} is the latest plugin version`);
                    return;
                }
                this.logger.info(
                    `Updating plugin from v${manifest.version} to v${newManifest.version}`
                );
                const error =
                    newPlugin.validateManifest() || this.validateUpdatedManifest(newManifest);
                if (error) {
                    this.logger.error('Manifest validation error', error);
                    this.set({
                        status: prevStatus,
                        updateCheckDate: Date.now(),
                        updateError: error
                    });
                    throw 'Plugin validation error: ' + error;
                }
                this.uninstallPluginCode();
                return newPlugin
                    .installWithManifest(false)
                    .then(() => {
                        this.module = newPlugin.module;
                        this.resources = newPlugin.resources;
                        this.set({
                            status: PluginStatus.STATUS_ACTIVE,
                            manifest: newManifest,
                            installTime: this.logger.ts() - ts,
                            installError: null,
                            updateCheckDate: Date.now(),
                            updateError: null
                        });
                        this.logger.info('Update complete', this.logger.ts(ts));
                    })
                    .catch((err) => {
                        this.logger.error('Error updating plugin', err);
                        if (prevStatus === PluginStatus.STATUS_ACTIVE) {
                            this.logger.info('Activating previous version');
                            return this.installWithResources().then(() => {
                                this.set({ updateCheckDate: Date.now(), updateError: err });
                                throw err;
                            });
                        } else {
                            this.set({
                                status: prevStatus,
                                updateCheckDate: Date.now(),
                                updateError: err
                            });
                            throw err;
                        }
                    });
            });
        },

        setAutoUpdate(enabled) {
            this.autoUpdate = !!enabled;
        },

        getSettingPrefix() {
            return `plugin:${this.id}:`;
        },

        getSettings() {
            if (
                this.status === PluginStatus.STATUS_ACTIVE &&
                this.module &&
                this.module.exports &&
                this.module.exports.getSettings
            ) {
                try {
                    const settings = this.module.exports.getSettings();
                    const settingsPrefix = this.getSettingPrefix();
                    if (settings instanceof Array) {
                        return settings.map((setting) => {
                            setting = { ...setting };
                            const value = AppSettingsModel[settingsPrefix + setting.name];
                            if (value !== undefined) {
                                setting.value = value;
                            }
                            return setting;
                        });
                    }
                    this.logger.error('getSettings: expected Array, got ', typeof settings);
                } catch (e) {
                    this.logger.error('getSettings error', e);
                }
            }
        },

        setSettings(settings) {
            for (const key of Object.keys(settings)) {
                AppSettingsModel[this.getSettingPrefix() + key] = settings[key];
            }
            if (this.module.exports.setSettings) {
                try {
                    this.module.exports.setSettings(settings);
                } catch (e) {
                    this.logger.error('setSettings error', e);
                }
            }
        }
    };
}

export { createPluginLifecycleMixin };

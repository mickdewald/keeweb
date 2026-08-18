import BaseLocale from 'locales/base.json';
import { Model } from 'framework/model';
import { RuntimeInfo } from 'const/runtime-info';
import { Launcher } from 'comp/launcher';
import { SettingsManager } from 'comp/settings/settings-manager';
import { ThemeVars } from 'plugins/theme-vars';
import { IoCache } from 'storage/io-cache';
import { SemVer } from 'util/data/semver';
import { SignatureVerifier } from 'util/data/signature-verifier';
import { Logger } from 'util/logger';
import { createPluginLifecycleMixin } from 'plugins/plugin-lifecycle';

const commonLogger = new Logger('plugin');
const io = new IoCache({
    cacheName: 'PluginFiles',
    logger: new Logger('storage-plugin-files')
});

const PluginStatus = {
    STATUS_NONE: '',
    STATUS_ACTIVE: 'active',
    STATUS_INACTIVE: 'inactive',
    STATUS_INSTALLING: 'installing',
    STATUS_ACTIVATING: 'activating',
    STATUS_UNINSTALLING: 'uninstalling',
    STATUS_UPDATING: 'updating',
    STATUS_INVALID: 'invalid',
    STATUS_ERROR: 'error'
};

class Plugin extends Model {
    constructor(data) {
        const name = data.manifest.name;
        if (!name) {
            throw new Error('Cannot create a plugin without name');
        }
        super({
            id: name,
            name,
            resources: {},
            logger: new Logger(`plugin:${name}`),
            ...data
        });
    }

    install(activate, local) {
        const ts = this.logger.ts();
        this.status = PluginStatus.STATUS_INSTALLING;
        return Promise.resolve().then(() => {
            const error = this.validateManifest();
            if (error) {
                this.logger.error('Manifest validation error', error);
                this.status = PluginStatus.STATUS_INVALID;
                throw 'Plugin validation error: ' + error;
            }
            this.status = PluginStatus.STATUS_INACTIVE;
            if (!activate) {
                this.logger.info('Loaded inactive plugin');
                return;
            }
            return this.installWithManifest(local)
                .then(() => {
                    this.installTime = this.logger.ts() - ts;
                })
                .catch((err) => {
                    this.logger.error('Error installing plugin', err);
                    this.set({
                        status: PluginStatus.STATUS_ERROR,
                        installError: err,
                        installTime: this.logger.ts() - ts,
                        updateError: null
                    });
                    throw err;
                });
        });
    }

    validateManifest() {
        const manifest = this.manifest;
        if (!manifest.name) {
            return 'No plugin name';
        }
        if (!manifest.description) {
            return 'No plugin description';
        }
        if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) {
            return 'Invalid plugin version';
        }
        if (manifest.manifestVersion !== '0.1.0') {
            return 'Invalid manifest version ' + manifest.manifestVersion;
        }
        if (
            !manifest.author ||
            !manifest.author.email ||
            !manifest.author.name ||
            !manifest.author.url
        ) {
            return 'Invalid plugin author';
        }
        if (!manifest.url) {
            return 'No plugin url';
        }
        if (!manifest.publicKey) {
            return 'No plugin public key';
        }
        if (
            !this.skipSignatureValidation &&
            !SignatureVerifier.getPublicKeys().includes(manifest.publicKey)
        ) {
            return 'Public key mismatch';
        }
        if (!manifest.resources || !Object.keys(manifest.resources).length) {
            return 'No plugin resources';
        }
        if (
            manifest.resources.loc &&
            (!manifest.locale ||
                !manifest.locale.title ||
                !/^[a-z]{2}(-[A-Z]{2})?$/.test(manifest.locale.name))
        ) {
            return 'Bad plugin locale';
        }
        if (manifest.desktop && !Launcher) {
            return 'Desktop plugin';
        }
        if (manifest.versionMin) {
            if (!/^\d+\.\d+\.\d+$/.test(manifest.versionMin)) {
                return 'Invalid versionMin';
            }
            if (SemVer.compareVersions(manifest.versionMin, RuntimeInfo.version) > 0) {
                return `Required min app version is ${manifest.versionMin}, actual ${RuntimeInfo.version}`;
            }
        }
        if (manifest.versionMax) {
            if (!/^\d+\.\d+\.\d+$/.test(manifest.versionMax)) {
                return 'Invalid versionMin';
            }
            if (SemVer.compareVersions(manifest.versionMax, RuntimeInfo.version) < 0) {
                return `Required max app version is ${manifest.versionMax}, actual ${RuntimeInfo.version}`;
            }
        }
    }

    validateUpdatedManifest(newManifest) {
        const manifest = this.manifest;
        if (manifest.name !== newManifest.name) {
            return 'Plugin name mismatch';
        }
        if (manifest.publicKey !== newManifest.publicKey) {
            const wasOfficial = SignatureVerifier.getPublicKeys().includes(manifest.publicKey);
            const isOfficial = SignatureVerifier.getPublicKeys().includes(newManifest.publicKey);
            if (!wasOfficial || !isOfficial) {
                return 'Public key mismatch';
            }
        }
    }

    installWithManifest(local) {
        const manifest = this.manifest;
        this.logger.info(
            'Loading plugin with resources',
            Object.keys(manifest.resources).join(', '),
            local ? '(local)' : '(url)'
        );
        this.resources = {};
        const ts = this.logger.ts();
        const results = Object.keys(manifest.resources).map((res) =>
            this.loadResource(res, local, manifest)
        );
        return Promise.all(results)
            .catch(() => {
                throw 'Error loading plugin resources';
            })
            .then(() => this.installWithResources())
            .then(() => (local ? undefined : this.saveResources()))
            .then(() => {
                this.logger.info('Install complete', this.logger.ts(ts));
            });
    }

    getResourcePath(res) {
        switch (res) {
            case 'css':
                return 'plugin.css';
            case 'js':
                return 'plugin.js';
            case 'loc':
                return this.manifest.locale.name + '.json';
            default:
                throw `Unknown resource ${res}`;
        }
    }

    getStorageResourcePath(res) {
        return this.id + '_' + this.getResourcePath(res);
    }

    loadResource(type, local, manifest) {
        const ts = this.logger.ts();
        let res;
        if (local) {
            res = new Promise((resolve, reject) => {
                const storageKey = this.getStorageResourcePath(type);
                io.load(storageKey, (err, data) => (err ? reject(err) : resolve(data)));
            });
        } else {
            const url = this.url + this.getResourcePath(type) + '?v=' + manifest.version;
            res = httpGet(url, true);
        }
        return res.then((data) => {
            this.logger.debug('Resource data loaded', type, this.logger.ts(ts));
            return this.verifyResource(data, type).then((data) => {
                this.resources[type] = data;
            });
        });
    }

    verifyResource(data, type) {
        const ts = this.logger.ts();
        const manifest = this.manifest;
        const signature = manifest.resources[type];
        return SignatureVerifier.verify(data, signature, manifest.publicKey)
            .then((valid) => {
                if (valid) {
                    this.logger.debug('Resource signature validated', type, this.logger.ts(ts));
                    return data;
                } else {
                    this.logger.error('Resource signature invalid', type);
                    throw `Signature invalid: ${type}`;
                }
            })
            .catch(() => {
                this.logger.error('Error validating resource signature', type);
                throw `Error validating resource signature for ${type}`;
            });
    }

    installWithResources() {
        this.logger.info('Installing plugin resources');
        const manifest = this.manifest;
        const promises = [];
        if (this.resources.css) {
            promises.push(this.applyCss(manifest.name, this.resources.css, manifest.theme));
        }
        if (this.resources.js) {
            promises.push(this.applyJs(manifest.name, this.resources.js));
        }
        if (this.resources.loc) {
            promises.push(this.applyLoc(manifest.locale, this.resources.loc));
        }
        return Promise.all(promises)
            .then(() => {
                this.status = PluginStatus.STATUS_ACTIVE;
            })
            .catch((e) => {
                this.logger.info('Install error', e);
                this.status = PluginStatus.STATUS_ERROR;
                return this.disable().then(() => {
                    throw e;
                });
            });
    }

    saveResources() {
        const resourceSavePromises = [];
        for (const key of Object.keys(this.resources)) {
            resourceSavePromises.push(this.saveResource(key, this.resources[key]));
        }
        return Promise.all(resourceSavePromises).catch((e) => {
            this.logger.debug('Error saving plugin resources', e);
            return this.uninstall().then(() => {
                throw 'Error saving plugin resources';
            });
        });
    }

    saveResource(key, value) {
        return new Promise((resolve, reject) => {
            const storageKey = this.getStorageResourcePath(key);
            io.save(storageKey, value, (e) => {
                if (e) {
                    reject(e);
                } else {
                    resolve();
                }
            });
        });
    }

    deleteResources() {
        const resourceDeletePromises = [];
        for (const key of Object.keys(this.resources)) {
            resourceDeletePromises.push(this.deleteResource(key));
        }
        return Promise.all(resourceDeletePromises);
    }

    deleteResource(key) {
        return new Promise((resolve) => {
            const storageKey = this.getStorageResourcePath(key);
            io.remove(storageKey, () => resolve());
        });
    }

    applyCss(name, data, theme) {
        return new Promise((resolve, reject) => {
            try {
                const blob = new Blob([data], { type: 'text/css' });
                const objectUrl = URL.createObjectURL(blob);
                const id = 'plugin-css-' + name;
                const el = this.createElementInHead('link', id, {
                    rel: 'stylesheet',
                    href: objectUrl
                });
                el.addEventListener('load', () => {
                    URL.revokeObjectURL(objectUrl);
                    if (theme) {
                        const locKey = this.getThemeLocaleKey(theme.name);
                        SettingsManager.allThemes[theme.name] = locKey;
                        BaseLocale[locKey] = theme.title;
                        for (const styleSheet of Array.from(document.styleSheets)) {
                            if (styleSheet.ownerNode.id === id) {
                                this.processThemeStyleSheet(styleSheet, theme);
                                break;
                            }
                        }
                    }
                    this.logger.debug('Plugin style installed');
                    resolve();
                });
            } catch (e) {
                this.logger.error('Error installing plugin style', e);
                reject(e);
            }
        });
    }

    processThemeStyleSheet(styleSheet, theme) {
        const themeSelector = '.th-' + theme.name;
        const badSelectors = [];
        for (const rule of Array.from(styleSheet.cssRules)) {
            if (rule.selectorText && rule.selectorText.lastIndexOf(themeSelector, 0) !== 0) {
                badSelectors.push(rule.selectorText);
            }
            if (rule.selectorText === themeSelector) {
                this.addThemeVariables(rule);
            }
        }
        if (badSelectors.length) {
            this.logger.error(
                'Themes must not add rules outside theme namespace. Bad selectors:',
                badSelectors
            );
            throw 'Invalid theme';
        }
    }

    addThemeVariables(rule) {
        ThemeVars.apply(rule.style);
    }

    static loadFromUrl(url, expectedManifest) {
        if (url[url.length - 1] !== '/') {
            url += '/';
        }
        commonLogger.info('Installing plugin from url', url);
        const manifestUrl = url + 'manifest.json';
        return httpGet(manifestUrl)
            .catch((e) => {
                commonLogger.error('Error loading plugin manifest', e);
                throw 'Error loading plugin manifest';
            })
            .then((manifest) => {
                try {
                    manifest = JSON.parse(manifest);
                } catch (e) {
                    commonLogger.error('Failed to parse manifest', manifest);
                    throw 'Failed to parse manifest';
                }
                commonLogger.debug('Loaded manifest', manifest);
                if (expectedManifest) {
                    if (expectedManifest.name !== manifest.name) {
                        throw 'Bad plugin name';
                    }
                    if (expectedManifest.privateKey !== manifest.privateKey) {
                        throw 'Bad plugin private key';
                    }
                }
                return new Plugin({
                    manifest,
                    url
                });
            });
    }
}

Object.assign(Plugin.prototype, createPluginLifecycleMixin(PluginStatus));

Plugin.defineModelProperties({
    id: '',
    name: '',
    logger: null,
    manifest: '',
    url: '',
    status: '',
    autoUpdate: false,
    installTime: null,
    installError: null,
    updateCheckDate: null,
    updateError: null,
    skipSignatureValidation: false,
    resources: null,
    module: null
});

Object.assign(Plugin, PluginStatus);

function httpGet(url, binary) {
    commonLogger.debug('GET', url);
    const ts = commonLogger.ts();
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                commonLogger.debug('GET OK', url, commonLogger.ts(ts));
                resolve(xhr.response);
            } else {
                commonLogger.debug('GET error', url, xhr.status);
                reject(xhr.status ? `HTTP status ${xhr.status}` : 'network error');
            }
        });
        xhr.addEventListener('error', () => {
            commonLogger.debug('GET error', url, xhr.status);
            reject(xhr.status ? `HTTP status ${xhr.status}` : 'network error');
        });
        xhr.addEventListener('abort', () => {
            commonLogger.debug('GET aborted', url);
            reject('Network request timeout');
        });
        xhr.addEventListener('timeout', () => {
            commonLogger.debug('GET timeout', url);
            reject('Network request timeout');
        });
        if (binary) {
            xhr.responseType = binary ? 'arraybuffer' : 'text';
        }
        xhr.open('GET', url);
        xhr.send();
    });
}

export { Plugin, PluginStatus };

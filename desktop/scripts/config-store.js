const electron = require('electron');
const fs = require('fs');
const path = require('path');

const { logStartupMessage } = require('./startup-profile');
const { isUsingPortableUserDataDir } = require('./startup-env');
const { isDev } = require('./util/app-info');

const main = electron.app;

let configEncryptionKey;

function setConfigEncryptionKey(key) {
    configEncryptionKey = key;
}

function getAppMainRoot() {
    if (isDev) {
        return path.join(__dirname, '..');
    } else {
        return require.main.path;
    }
}

function getAppContentRoot() {
    return path.join(__dirname, '..');
}

function reqNative(mod) {
    const fileName = `${mod}-${process.platform}-${process.arch}.node`;

    const modulePath = `../node_modules/@keeweb/keeweb-native-modules/${fileName}`;
    const fullPath = path.join(getAppMainRoot(), modulePath);

    return require(fullPath);
}

function loadSettingsEncryptionKey() {
    return Promise.resolve().then(() => {
        if (isUsingPortableUserDataDir()) {
            return null;
        }

        // safeStorage needs the app to be ready
        return main.whenReady().then(() => {
            const { safeStorage } = electron;
            if (!safeStorage.isEncryptionAvailable()) {
                logStartupMessage('safeStorage unavailable, falling back to keytar');
                return loadSettingsEncryptionKeyFromKeytar();
            }

            const keyFilePath = path.join(main.getPath('userData'), 'settings-key.bin');
            if (fs.existsSync(keyFilePath)) {
                try {
                    const hex = safeStorage.decryptString(fs.readFileSync(keyFilePath));
                    fs.chmodSync(keyFilePath, 0o600);
                    return Buffer.from(hex, 'hex');
                } catch (e) {
                    // corrupted or written by another keychain state: fall through to keytar
                    logStartupMessage(`Error reading settings key file, trying keytar: ${e}`);
                }
            }

            // migrate the key from keytar, or create a fresh one on first run
            return loadSettingsEncryptionKeyFromKeytar().then((key) => {
                let keyPromise;
                if (key) {
                    keyPromise = Promise.resolve(key);
                } else {
                    key = require('crypto').randomBytes(48);
                    keyPromise = migrateOldConfigs(key).then(() => key);
                }
                return keyPromise.then((key) => {
                    try {
                        fs.writeFileSync(
                            keyFilePath,
                            safeStorage.encryptString(key.toString('hex')),
                            { mode: 0o600 }
                        );
                    } catch (e) {
                        logStartupMessage(`Error writing settings key file: ${e}`);
                    }
                    return key;
                });
            });
        });
    });
}

function loadSettingsEncryptionKeyFromKeytar() {
    return Promise.resolve()
        .then(() => {
            const keytar = reqNative('keytar');
            return keytar
                .getPassword('KeeWeb', 'settings-key')
                .then((key) => (key ? Buffer.from(key, 'hex') : null));
        })
        .catch((e) => {
            logStartupMessage(`Error reading settings key from keytar: ${e}`);
            return null;
        });
}

function loadConfig(name) {
    const ext = configEncryptionKey ? 'dat' : 'json';
    const configFilePath = path.join(main.getPath('userData'), `${name}.${ext}`);

    return new Promise((resolve, reject) => {
        fs.readFile(configFilePath, (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    resolve(null);
                } else {
                    reject(`Error reading config ${name}: ${err}`);
                }
                return;
            }

            try {
                if (configEncryptionKey) {
                    const key = configEncryptionKey.slice(0, 32);
                    const iv = configEncryptionKey.slice(32, 48);

                    const crypto = require('crypto');
                    const cipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

                    data = Buffer.concat([cipher.update(data), cipher.final()]);
                }

                resolve(data.toString('utf8'));
            } catch (err) {
                logStartupMessage(`Error reading config data (config ignored) ${name}: ${err}`);
                resolve(null);
            }
        });
    });
}

function saveConfig(name, data, key) {
    if (!key) {
        key = configEncryptionKey;
    }

    return new Promise((resolve, reject) => {
        try {
            data = Buffer.from(data);

            if (key) {
                const crypto = require('crypto');
                const cipher = crypto.createCipheriv(
                    'aes-256-cbc',
                    key.slice(0, 32),
                    key.slice(32, 48)
                );

                data = Buffer.concat([cipher.update(data), cipher.final()]);
            }
        } catch (err) {
            return reject(`Error writing config data ${name}: ${err}`);
        }

        const ext = key ? 'dat' : 'json';
        const configFilePath = path.join(main.getPath('userData'), `${name}.${ext}`);
        fs.writeFile(configFilePath, data, (err) => {
            if (err) {
                reject(`Error writing config ${name}: ${err}`);
            } else {
                resolve();
            }
        });
    });
}

// TODO: delete in 2021
function migrateOldConfigs(key) {
    const knownConfigs = [
        'file-info',
        'app-settings',
        'runtime-data',
        'update-info',
        'plugin-gallery',
        'plugins'
    ];

    const promises = [];

    for (const configName of knownConfigs) {
        promises.push(
            loadConfig(configName).then((data) => {
                if (data) {
                    return saveConfig(configName, data, key).then(() => {
                        fs.unlinkSync(path.join(main.getPath('userData'), `${configName}.json`));
                    });
                }
            })
        );
    }

    return Promise.all(promises);
}

module.exports = {
    setConfigEncryptionKey,
    getAppMainRoot,
    getAppContentRoot,
    loadSettingsEncryptionKey,
    loadConfig,
    saveConfig
};

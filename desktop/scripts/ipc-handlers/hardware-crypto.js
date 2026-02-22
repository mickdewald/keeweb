const { ipcMain } = require('electron');
const { spawnSync } = require('child_process');
const { readXoredValue, makeXoredValue } = require('../util/byte-utils');
const { reqNative } = require('../util/req-native');
const { isDev } = require('../util/app-info');

ipcMain.handle('hardwareCryptoDeleteKey', hardwareCryptoDeleteKey);
ipcMain.handle('hardwareCryptoGetStatus', hardwareCryptoGetStatus);
ipcMain.handle('hardwareEncrypt', hardwareEncrypt);
ipcMain.handle('hardwareDecrypt', hardwareDecrypt);

const keyTag = 'net.antelle.keeweb.encryption-key';

let testCipherParams;
let keyChecked = false;
let hardwareCryptoStatus;

const requiredTouchIdEntitlements = [
    '<key>com.apple.application-identifier</key>',
    '<key>com.apple.developer.team-identifier</key>',
    '<key>keychain-access-groups</key>'
];

async function hardwareCryptoDeleteKey() {
    const status = getHardwareCryptoStatus();
    if (!status.supported) {
        keyChecked = false;
        return false;
    }
    const secureEnclave = reqNative('secure-enclave');
    await secureEnclave.deleteKeyPair({ keyTag });
    keyChecked = false;
    return true;
}

async function hardwareCryptoGetStatus() {
    return getHardwareCryptoStatus();
}

async function hardwareEncrypt(e, value) {
    return await hardwareCrypto(value, true);
}

async function hardwareDecrypt(e, value, touchIdPrompt) {
    return await hardwareCrypto(value, false, touchIdPrompt);
}

async function hardwareCrypto(value, encrypt, touchIdPrompt) {
    if (process.platform !== 'darwin') {
        throw new Error('Not supported');
    }

    ensureHardwareCryptoSupported();

    // This is a native module, but why is it here and not in native-module-host?
    // It's because native-module-host is started as a fork,
    //  and macOS thinks it doesn't have necessary entitlements,
    //  so any attempt to use Secure Enclave API fails with an error.

    const secureEnclave = reqNative('secure-enclave');

    const data = readXoredValue(value);

    let res;
    if (isDev && process.env.KEEWEB_EMULATE_HARDWARE_ENCRYPTION) {
        const crypto = require('crypto');
        if (!testCipherParams) {
            let key, iv;
            if (process.env.KEEWEB_EMULATE_HARDWARE_ENCRYPTION === 'persistent') {
                key = Buffer.alloc(32, 0);
                iv = Buffer.alloc(16, 0);
            } else {
                key = crypto.randomBytes(32);
                iv = crypto.randomBytes(16);
            }
            testCipherParams = { key, iv };
        }
        const { key, iv } = testCipherParams;
        const algo = 'aes-256-cbc';
        let cipher;
        if (encrypt) {
            cipher = crypto.createCipheriv(algo, key, iv);
        } else {
            cipher = crypto.createDecipheriv(algo, key, iv);
        }
        res = Buffer.concat([cipher.update(data), cipher.final()]);
    } else {
        if (encrypt) {
            await checkKey();
            res = await secureEnclave.encrypt({ keyTag, data });
        } else {
            res = await secureEnclave.decrypt({ keyTag, data, touchIdPrompt });
        }
    }

    data.fill(0);

    return makeXoredValue(res);

    async function checkKey() {
        if (keyChecked) {
            return;
        }
        try {
            await secureEnclave.createKeyPair({ keyTag });
            keyChecked = true;
        } catch (e) {
            if (!e.keyExists) {
                throw e;
            }
        }
    }
}

function getHardwareCryptoStatus() {
    if (hardwareCryptoStatus) {
        return hardwareCryptoStatus;
    }

    if (isDev && process.env.KEEWEB_EMULATE_HARDWARE_ENCRYPTION) {
        hardwareCryptoStatus = { supported: true };
        return hardwareCryptoStatus;
    }

    const signatureInfo = getCodeSignInfo();
    if (!signatureInfo.signed) {
        hardwareCryptoStatus = {
            supported: false,
            code: 'signature-missing',
            message:
                'Touch ID is unavailable in this build because the app is not signed with a developer identity.'
        };
        return hardwareCryptoStatus;
    }

    if (!signatureInfo.hasRequiredEntitlements) {
        hardwareCryptoStatus = {
            supported: false,
            code: 'entitlements-missing',
            message:
                'Touch ID is unavailable in this build because required macOS entitlements are missing.'
        };
        return hardwareCryptoStatus;
    }

    hardwareCryptoStatus = { supported: true };
    return hardwareCryptoStatus;
}

function ensureHardwareCryptoSupported() {
    const status = getHardwareCryptoStatus();
    if (status.supported) {
        return;
    }

    const err = new Error(status.message || 'Touch ID is not available');
    err.notSupported = true;
    err.reasonCode = status.code || 'not-supported';
    throw err;
}

function getCodeSignInfo() {
    const signature = spawnSync('/usr/bin/codesign', ['-dv', process.execPath], {
        encoding: 'utf8'
    });
    const signatureOut = `${signature.stdout || ''}\n${signature.stderr || ''}`;
    const teamIdentifierMatch = signatureOut.match(/TeamIdentifier=(.*)$/m);
    const teamIdentifier = teamIdentifierMatch?.[1]?.trim();
    const signed = signature.status === 0 && !!teamIdentifier && teamIdentifier !== 'not set';

    if (!signed) {
        return {
            signed: false,
            hasRequiredEntitlements: false
        };
    }

    const entitlements = spawnSync(
        '/usr/bin/codesign',
        ['-d', '--entitlements', ':-', process.execPath],
        {
            encoding: 'utf8'
        }
    );
    const entitlementsOut = `${entitlements.stdout || ''}\n${entitlements.stderr || ''}`;
    const hasRequiredEntitlements =
        entitlements.status === 0 &&
        requiredTouchIdEntitlements.every((entitlement) => entitlementsOut.includes(entitlement));

    return {
        signed: true,
        hasRequiredEntitlements
    };
}

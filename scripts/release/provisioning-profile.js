/* eslint-env node */
// KeeWeb's Touch ID entitlements (application identifier, team identifier and
// keychain access group) are restricted: macOS only honours them when the app
// embeds a provisioning profile issued for the certificate that signed it.
// Public builds therefore need a Developer ID profile, never the device-bound
// development profile.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEAM_ID = 'GGYLL32K99';
const APP_IDENTIFIER = `${TEAM_ID}.com.mickdewald.keeweb`;
const DEVELOPER_ID = `Developer ID Application: Michael Dewald (${TEAM_ID})`;

function normalizeFingerprint(fingerprint) {
    const normalized = String(fingerprint || '')
        .replace(/[^a-fA-F0-9]/g, '')
        .toUpperCase();
    return /^[A-F0-9]{40}$/.test(normalized) ? normalized : undefined;
}

function validateDeveloperIdProfile(profile, now = new Date(), selectedIdentityFingerprint) {
    const entitlements = profile.entitlements || {};
    const groups = entitlements['keychain-access-groups'];
    const expires = Date.parse(profile.expirationDate);
    const failures = [
        [profile.provisionsAllDevices !== true, 'must provision all devices (Developer ID)'],
        [profile.provisionedDeviceCount !== 0, 'must not be bound to registered devices'],
        [!Array.isArray(profile.platforms) || !profile.platforms.includes('OSX'), 'must be macOS'],
        [!Number.isFinite(expires) || expires <= now.getTime(), 'is expired or undated'],
        [
            entitlements['com.apple.application-identifier'] !== APP_IDENTIFIER,
            `must be issued for ${APP_IDENTIFIER}`
        ],
        [entitlements['com.apple.developer.team-identifier'] !== TEAM_ID, 'has a foreign team'],
        [
            !Array.isArray(groups) ||
                !groups.some((group) => group === `${TEAM_ID}.*` || group === APP_IDENTIFIER) ||
                groups.some((group) => !group.startsWith(`${TEAM_ID}.`)),
            'must grant only this team keychain access group'
        ],
        [
            entitlements['get-task-allow'] === true ||
                entitlements['com.apple.security.get-task-allow'] === true,
            'must not allow debugging'
        ],
        [
            !Array.isArray(profile.certificateCommonNames) ||
                !profile.certificateCommonNames.includes(DEVELOPER_ID),
            `must include the certificate ${DEVELOPER_ID}`
        ],
        [
            selectedIdentityFingerprint &&
                (!Array.isArray(profile.certificateFingerprints) ||
                    !profile.certificateFingerprints.includes(selectedIdentityFingerprint)),
            'must include the selected Developer ID certificate'
        ]
    ];
    const failure = failures.find(([failed]) => failed);
    if (failure) {
        throw new Error(`Provisioning profile ${failure[1]}`);
    }
}

function extract(plist, keyPath, format) {
    const result = spawnSync('/usr/bin/plutil', ['-extract', keyPath, format, '-o', '-', '-'], {
        input: plist,
        encoding: 'utf8'
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
}

function convert(plist, format) {
    const result = spawnSync('/usr/bin/plutil', ['-convert', format, '-o', '-', '-'], {
        input: plist || '',
        encoding: 'utf8'
    });
    return result.status === 0 ? result.stdout : undefined;
}

function readProfile(profilePath) {
    const decoded = spawnSync('/usr/bin/security', ['cms', '-D', '-i', profilePath], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
    });
    if (decoded.status !== 0 || !decoded.stdout) {
        throw new Error('Cannot decode provisioning profile');
    }
    const plist = decoded.stdout;
    const count = (key) => Number(extract(plist, key, 'raw') || 0);
    const list = (key) =>
        Array.from({ length: count(key) }, (_, index) => extract(plist, `${key}.${index}`, 'raw'));
    return {
        provisionsAllDevices: extract(plist, 'ProvisionsAllDevices', 'raw') === 'true',
        provisionedDeviceCount: count('ProvisionedDevices'),
        platforms: list('Platform'),
        expirationDate: extract(plist, 'ExpirationDate', 'raw'),
        // plutil refuses JSON output while the surrounding plist holds dates/data.
        entitlements: JSON.parse(convert(extract(plist, 'Entitlements', 'xml1'), 'json') || '{}'),
        certificateCommonNames: list('DeveloperCertificates').map((der) => {
            const subject = new crypto.X509Certificate(Buffer.from(der, 'base64')).subject;
            return (/^CN=(.*)$/m.exec(subject) || [])[1];
        }),
        certificateFingerprints: list('DeveloperCertificates').map((der) =>
            crypto.createHash('sha1').update(Buffer.from(der, 'base64')).digest('hex').toUpperCase()
        )
    };
}

function readSelectedIdentityFingerprint(run = spawnSync) {
    const result = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
        encoding: 'utf8'
    });
    const identities = String(result.stdout || '')
        .split('\n')
        .map((line) => /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(.+)"\s*$/.exec(line))
        .filter(Boolean)
        .filter((match) => match[2] === DEVELOPER_ID)
        .map((match) => normalizeFingerprint(match[1]));
    if (result.status !== 0 || identities.length !== 1 || !identities[0]) {
        throw new Error('Expected exactly one selected Developer ID signing identity');
    }
    return identities[0];
}

function readAppLeafFingerprint(appPath, run = spawnSync, fileSystem = fs) {
    const directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'keeweb-profile-cert-'));
    const prefix = path.join(directory, 'certificate');
    try {
        fileSystem.chmodSync(directory, 0o700);
        const result = run('/usr/bin/codesign', ['-d', `--extract-certificates=${prefix}`, appPath], {
            encoding: 'utf8'
        });
        const leaf = `${prefix}0`;
        if (result.status !== 0 || !fileSystem.existsSync(leaf)) {
            throw new Error('Cannot extract the final app signing certificate');
        }
        return crypto
            .createHash('sha1')
            .update(fileSystem.readFileSync(leaf))
            .digest('hex')
            .toUpperCase();
    } finally {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    }
}

function verifyDeveloperIdProfile(profilePath, tools = {}) {
    const profile = (tools.readProfile || readProfile)(profilePath);
    const selectedIdentityFingerprint = normalizeFingerprint(
        (tools.selectedIdentityFingerprint || readSelectedIdentityFingerprint)(tools.run)
    );
    if (!selectedIdentityFingerprint) {
        throw new Error('Cannot determine the selected Developer ID signing identity');
    }
    validateDeveloperIdProfile(profile, new Date(), selectedIdentityFingerprint);
    return selectedIdentityFingerprint;
}

function verifyEmbeddedProfile(appPath, profilePath, tools = {}) {
    const fileSystem = tools.fs || fs;
    const embedded = path.join(appPath, 'Contents/embedded.provisionprofile');
    if (!fileSystem.existsSync(embedded)) {
        throw new Error('Public app has restricted entitlements but no provisioning profile');
    }
    const selectedIdentityFingerprint = verifyDeveloperIdProfile(embedded, tools);
    const appLeafFingerprint = normalizeFingerprint(
        (tools.appLeafFingerprint || readAppLeafFingerprint)(appPath, tools.run, fileSystem)
    );
    if (appLeafFingerprint !== selectedIdentityFingerprint) {
        throw new Error(
            'Final app leaf certificate does not match the selected Developer ID identity'
        );
    }
    if (
        profilePath &&
        !fileSystem.readFileSync(embedded).equals(fileSystem.readFileSync(profilePath))
    ) {
        throw new Error('Embedded provisioning profile differs from the supplied profile');
    }
}

module.exports = {
    validateDeveloperIdProfile,
    verifyDeveloperIdProfile,
    verifyEmbeddedProfile,
    readProfile,
    readAppLeafFingerprint,
    readSelectedIdentityFingerprint
};

if (require.main === module) {
    verifyDeveloperIdProfile(process.argv[2]);
}

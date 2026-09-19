const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    validateDeveloperIdProfile,
    verifyDeveloperIdProfile,
    verifyEmbeddedProfile,
    readAppLeafFingerprint
} = require('../../scripts/release/provisioning-profile');

const now = new Date('2026-09-19T12:00:00Z');
const profile = {
    provisionsAllDevices: true,
    provisionedDeviceCount: 0,
    platforms: ['OSX'],
    expirationDate: '2030-01-01T00:00:00Z',
    entitlements: {
        'com.apple.application-identifier': 'GGYLL32K99.com.mickdewald.keeweb',
        'com.apple.developer.team-identifier': 'GGYLL32K99',
        'keychain-access-groups': ['GGYLL32K99.*']
    },
    certificateCommonNames: ['Developer ID Application: Michael Dewald (GGYLL32K99)'],
    certificateFingerprints: ['F9B4CDC57E004EAF295676E6710057222CEA48EA']
};

test('accepts a Developer ID profile for the public KeeWeb app', () => {
    validateDeveloperIdProfile(profile, now);
    validateDeveloperIdProfile(
        {
            ...profile,
            entitlements: {
                ...profile.entitlements,
                'keychain-access-groups': ['GGYLL32K99.com.mickdewald.keeweb']
            }
        },
        now
    );
});

test('rejects a same-CN profile certificate that is not the selected keychain identity', () => {
    assert.throws(
        () =>
            verifyDeveloperIdProfile('/profile', {
                readProfile: () => ({
                    ...profile,
                    certificateFingerprints: ['1111111111111111111111111111111111111111']
                }),
                selectedIdentityFingerprint: () => profile.certificateFingerprints[0]
            }),
        /selected Developer ID certificate/
    );
});

test('requires the final app leaf certificate to match the selected identity and embedded profile', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-profile-'));
    const app = path.join(root, 'KeeWeb.app');
    fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents/embedded.provisionprofile'), 'fixture');
    const tools = {
        readProfile: () => profile,
        selectedIdentityFingerprint: () => profile.certificateFingerprints[0],
        appLeafFingerprint: () => profile.certificateFingerprints[0]
    };
    try {
        verifyEmbeddedProfile(app, undefined, tools);
        assert.throws(
            () =>
                verifyEmbeddedProfile(app, undefined, {
                    ...tools,
                    appLeafFingerprint: () => '2222222222222222222222222222222222222222'
                }),
            /leaf certificate does not match/
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('extracts the final app leaf into a private temporary directory and removes it', () => {
    let certificatePath;
    const fingerprint = readAppLeafFingerprint('/fixture/KeeWeb.app', (_command, args) => {
        const option = args.find((arg) => arg.startsWith('--extract-certificates='));
        assert.ok(option, 'codesign requires its optional prefix joined with =');
        certificatePath = `${option.slice('--extract-certificates='.length)}0`;
        fs.writeFileSync(certificatePath, 'certificate');
        return { status: 0, stdout: '', stderr: '' };
    });
    assert.equal(fingerprint, '735AD571C189D7BA84464BF4A9F1D2280175B128');
    assert.equal(fs.existsSync(certificatePath), false);
});

test('rejects development, device-bound, expired, foreign and debuggable profiles', () => {
    const entitlement = (change) => ({ entitlements: { ...profile.entitlements, ...change } });
    for (const change of [
        { provisionsAllDevices: false },
        { provisionsAllDevices: undefined },
        { provisionedDeviceCount: 2 },
        { platforms: ['iOS'] },
        { expirationDate: '2026-09-19T11:59:59Z' },
        { expirationDate: 'soon' },
        { certificateCommonNames: ['Apple Development: Michael Dewald (UUCWA5MCLV)'] },
        { certificateCommonNames: [] },
        entitlement({ 'com.apple.application-identifier': 'GGYLL32K99.*' }),
        entitlement({ 'com.apple.application-identifier': 'GGYLL32K99.net.antelle.keeweb' }),
        entitlement({ 'com.apple.developer.team-identifier': '3LE7JZ657W' }),
        entitlement({ 'keychain-access-groups': ['3LE7JZ657W.*'] }),
        entitlement({ 'keychain-access-groups': [] }),
        entitlement({ 'com.apple.security.get-task-allow': true }),
        entitlement({ 'get-task-allow': true })
    ]) {
        assert.throws(
            () => validateDeveloperIdProfile({ ...profile, ...change }, now),
            `accepted ${JSON.stringify(change)}`
        );
    }
});

/* eslint-env node */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { signingPolicy, verifyUpdateApp } = require('../release/verify-update-app');
const { readProfile, readAppLeafFingerprint } = require('../release/provisioning-profile');
const { assertDevelopmentDeployMetadata } = require('./check-private-update-deploy');

const DEVELOPMENT_POLICY = signingPolicy('development');
const PUBLIC_POLICY = signingPolicy('public');
const APP_IDENTIFIER = `${DEVELOPMENT_POLICY.teamId}.${DEVELOPMENT_POLICY.bundleId}`;

function defaultRun(command, args) {
    return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function defaultReadBundleId(appPath) {
    const result = defaultRun('/usr/libexec/PlistBuddy', [
        '-c',
        'Print :CFBundleIdentifier',
        path.join(appPath, 'Contents/Info.plist')
    ]);
    return result.status === 0 ? result.stdout.trim() : '';
}

function field(lines, prefix) {
    const line = lines.find((entry) => entry.startsWith(prefix));
    return line ? line.slice(prefix.length) : '';
}

function plistToObject(xml) {
    if (!String(xml || '').trim()) {
        return {};
    }
    const result = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
        input: xml,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error('Cannot parse entitlements');
    }
    return JSON.parse(result.stdout);
}

function readEntitlements(run, target) {
    const result = run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', target]);
    if (result.status !== 0) {
        throw new Error('Cannot read entitlements');
    }
    const text = String(result.stdout || '').trim();
    return text.startsWith('{') ? JSON.parse(text) : plistToObject(text);
}

function parseDesignatedRequirement(stdout) {
    const designated = String(stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('designated => '));
    if (designated.length !== 1) {
        throw new Error('Installed designated requirement is missing or malformed');
    }
    const requirement = designated[0].slice('designated => '.length).trim();
    if (!requirement || /[\n\r`$]/.test(requirement)) {
        throw new Error('Installed designated requirement is missing or malformed');
    }
    return requirement;
}

function channelFromAuthority(authority) {
    if (authority === PUBLIC_POLICY.authority) {
        return 'public';
    }
    if (authority === DEVELOPMENT_POLICY.authority) {
        return 'development';
    }
    throw new Error('Installed KeeWeb has an unsupported signing identity');
}

function inspectInstalledApp(appPath, tools = {}) {
    const fileSystem = tools.fs || fs;
    if (!fileSystem.existsSync(appPath)) {
        return { present: false };
    }
    const run = tools.run || defaultRun;
    const verified = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
    if (verified.status !== 0) {
        throw new Error('Installed KeeWeb signature is invalid or unreadable');
    }
    const info = run('/usr/bin/codesign', ['-d', '--verbose=4', appPath]);
    if (info.status !== 0) {
        throw new Error('Installed KeeWeb signature is invalid or unreadable');
    }
    const lines = String(info.stderr || '').split('\n');
    const identifier =
        field(lines, 'Identifier=') || (tools.readBundleId || defaultReadBundleId)(appPath);
    const teamId = field(lines, 'TeamIdentifier=');
    const authority = field(lines, 'Authority=');
    const channel = channelFromAuthority(authority);
    const policy = signingPolicy(channel);
    if (!identifier || identifier !== policy.bundleId) {
        throw new Error('Installed bundle identifier is not com.mickdewald.keeweb');
    }
    if (teamId !== policy.teamId) {
        throw new Error('Installed team identifier does not match');
    }
    const requirements = run('/usr/bin/codesign', ['-d', '-r-', appPath]);
    if (requirements.status !== 0) {
        throw new Error('Installed designated requirement is missing or malformed');
    }
    const entitlements = readEntitlements(run, appPath);
    return {
        present: true,
        identifier,
        teamId,
        authority,
        channel,
        designatedRequirement: parseDesignatedRequirement(requirements.stdout),
        cdhash: field(lines, 'CDHash='),
        applicationIdentifier: entitlements['com.apple.application-identifier'],
        teamIdentifierEntitlement: entitlements['com.apple.developer.team-identifier'],
        keychainAccessGroups: entitlements['keychain-access-groups'] || [],
        profilePresent: fileSystem.existsSync(
            path.join(appPath, 'Contents/embedded.provisionprofile')
        )
    };
}

function assertDevelopmentProfile(appPath, tools = {}) {
    const fileSystem = tools.fs || fs;
    const embedded = path.join(appPath, 'Contents/embedded.provisionprofile');
    if (!fileSystem.existsSync(embedded)) {
        throw new Error('Candidate is missing an embedded provisioning profile');
    }
    const profile = (tools.readProfile || readProfile)(embedded);
    const entitlements = profile.entitlements || {};
    const groups = entitlements['keychain-access-groups'];
    const expires = Date.parse(profile.expirationDate);
    if (
        !Array.isArray(profile.platforms) ||
        !profile.platforms.includes('OSX') ||
        !Number.isFinite(expires) ||
        expires <= Date.now() ||
        entitlements['com.apple.application-identifier'] !== APP_IDENTIFIER ||
        entitlements['com.apple.developer.team-identifier'] !== DEVELOPMENT_POLICY.teamId ||
        !Array.isArray(groups) ||
        !groups.some(
            (group) => group === `${DEVELOPMENT_POLICY.teamId}.*` || group === APP_IDENTIFIER
        ) ||
        groups.some((group) => !String(group).startsWith(`${DEVELOPMENT_POLICY.teamId}.`))
    ) {
        throw new Error('Candidate provisioning profile is incompatible');
    }
    assertProfileAllowsSigningCertificate(appPath, profile, tools);
}

function normalizeFingerprint(fingerprint) {
    const normalized = String(fingerprint || '')
        .replace(/[^a-fA-F0-9]/g, '')
        .toUpperCase();
    return /^[A-F0-9]{40}$/.test(normalized) ? normalized : undefined;
}

// The restricted Touch ID/keychain entitlements are only honoured when the
// embedded profile was issued for the certificate that actually signed the app.
function assertProfileAllowsSigningCertificate(appPath, profile, tools) {
    const allowed = Array.isArray(profile.certificateFingerprints)
        ? profile.certificateFingerprints.map(normalizeFingerprint)
        : [];
    if (!allowed.length || allowed.some((fingerprint) => !fingerprint)) {
        throw new Error(
            'Candidate provisioning profile has no valid signing certificate fingerprints'
        );
    }
    let leaf;
    let cause = 'no valid SHA-1 fingerprint';
    try {
        leaf = normalizeFingerprint(
            (tools.appLeafFingerprint || readAppLeafFingerprint)(appPath, tools.run, tools.fs)
        );
    } catch (error) {
        cause = error.message;
    }
    if (!leaf) {
        throw new Error(`Cannot determine the candidate signing certificate: ${cause}`);
    }
    if (!allowed.includes(leaf)) {
        throw new Error(
            'Candidate provisioning profile does not include the certificate that signed the app'
        );
    }
}

function verifyDevelopmentCandidate(candidatePath, tools = {}) {
    assertDevelopmentDeployMetadata(candidatePath, tools.readMetadata);
    const verifyTools = {};
    if (tools.run) {
        verifyTools.run = tools.run;
    }
    if (tools.readBundleId) {
        verifyTools.readBundleId = tools.readBundleId;
    }
    if (tools.entitlements) {
        verifyTools.entitlements = tools.entitlements;
    }
    (tools.verifyUpdateApp || verifyUpdateApp)(candidatePath, 'development', verifyTools);
    assertDevelopmentProfile(candidatePath, tools);
}

function checkCompatibility(installedPath, candidatePath, tools = {}) {
    const installed = inspectInstalledApp(installedPath, tools);
    if (!installed.present) {
        return installed;
    }
    if (installed.channel === 'public') {
        throw new Error(
            'Installed KeeWeb is a public Developer ID app; this development command will not replace it. Same team ID is not signing compatibility.'
        );
    }
    if (installed.channel !== 'development') {
        throw new Error('Installed KeeWeb has an unsupported signing channel');
    }
    const run = tools.run || defaultRun;
    const verified = run('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '-R',
        `=${installed.designatedRequirement}`,
        candidatePath
    ]);
    if (verified.status !== 0) {
        throw new Error('Candidate does not satisfy the installed designated requirement');
    }
    const candidateEntitlements = readEntitlements(run, candidatePath);
    if (
        candidateEntitlements['com.apple.application-identifier'] !==
        installed.applicationIdentifier
    ) {
        throw new Error(
            'Candidate application-identifier entitlement differs from the installed app'
        );
    }
    if (
        candidateEntitlements['com.apple.developer.team-identifier'] !==
        installed.teamIdentifierEntitlement
    ) {
        throw new Error('Candidate team-identifier entitlement differs from the installed app');
    }
    if (
        !isDeepStrictEqual(
            candidateEntitlements['keychain-access-groups'] || [],
            installed.keychainAccessGroups
        )
    ) {
        throw new Error('Candidate keychain-access-groups differ from the installed app');
    }
    return installed;
}

function checkActiveSession(installedPath, tools = {}) {
    const run = tools.run || defaultRun;
    const exe = path.join(installedPath, 'Contents/MacOS/KeeWeb');
    const processes = run('/usr/bin/pgrep', ['-f', exe]);
    const bundle = run('/usr/bin/osascript', [
        '-e',
        `application id "${DEVELOPMENT_POLICY.bundleId}" is running`
    ]);
    if (
        (processes.status === 0 && String(processes.stdout || '').trim()) ||
        (bundle.status === 0 && String(bundle.stdout || '').trim() === 'true')
    ) {
        throw new Error(
            'KeeWeb is still running. Close it normally (save or cancel) before replacing the app.'
        );
    }
}

function assertSnapshotUnchanged(previous, current) {
    if (!isDeepStrictEqual(previous, current)) {
        throw new Error('Installed app changed after preflight; refusing to replace it');
    }
}

function runPreflight({ installedPath, candidatePath }, tools = {}) {
    const snapshot = inspectInstalledApp(installedPath, tools);
    verifyDevelopmentCandidate(candidatePath, tools);
    checkCompatibility(installedPath, candidatePath, tools);
    checkActiveSession(installedPath, tools);
    assertSnapshotUnchanged(snapshot, inspectInstalledApp(installedPath, tools));
    return snapshot;
}

function option(argv, name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv, tools = {}) {
    const command = argv[0];
    if (command === 'inspect') {
        const snapshot = inspectInstalledApp(argv[1], tools);
        const snapshotPath = option(argv, '--write-snapshot');
        if (snapshotPath) {
            fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
        }
        process.stdout.write(
            snapshot.present
                ? `Installed channel: ${snapshot.channel}\n`
                : 'No installed KeeWeb app\n'
        );
        return snapshot;
    }
    if (command === 'verify-candidate') {
        verifyDevelopmentCandidate(argv[1], tools);
        process.stdout.write('Candidate verified\n');
        return;
    }
    if (command === 'compatibility') {
        const installed = checkCompatibility(argv[1], argv[2], tools);
        process.stdout.write(
            installed.present
                ? 'Candidate is compatible with the installed app\n'
                : 'First development install\n'
        );
        return installed;
    }
    if (command === 'session') {
        checkActiveSession(argv[1], tools);
        process.stdout.write('No active KeeWeb session\n');
        return;
    }
    if (command === 'recheck') {
        const previous = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
        assertSnapshotUnchanged(previous, inspectInstalledApp(argv[1], tools));
        process.stdout.write('Installed snapshot unchanged\n');
        return;
    }
    throw new Error(
        'Usage: check-installed-app-compatibility.js inspect|verify-candidate|compatibility|session|recheck'
    );
}

module.exports = {
    inspectInstalledApp,
    verifyDevelopmentCandidate,
    checkCompatibility,
    checkActiveSession,
    assertSnapshotUnchanged,
    runPreflight,
    main
};

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
}

/* eslint-env node */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const TEAM_ID = 'GGYLL32K99';
const BUNDLE_ID = 'com.mickdewald.keeweb';
const POLICIES = {
    development: {
        authority: 'Apple Development: Michael Dewald (UUCWA5MCLV)',
        certificate:
            'certificate leaf[subject.CN] = "Apple Development: Michael Dewald (UUCWA5MCLV)"'
    },
    public: {
        authority: 'Developer ID Application: Michael Dewald (GGYLL32K99)',
        // Apple's Developer ID intermediate and leaf marker extensions.
        certificate:
            'certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists'
    }
};
const MACH_O_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]);
const FAT_MAGICS = new Set([0xcafebabe, 0xcafebabf]);
const MH_EXECUTE = 2;

function signingPolicy(channel) {
    if (typeof channel !== 'string' || !Object.prototype.hasOwnProperty.call(POLICIES, channel)) {
        throw new Error('Unknown KeeWeb signing channel');
    }
    const { authority, certificate } = POLICIES[channel];
    const nestedRequirement = `anchor apple generic and ${certificate} and certificate leaf[subject.OU] = "${TEAM_ID}"`;
    return {
        channel,
        authority,
        teamId: TEAM_ID,
        bundleId: BUNDLE_ID,
        arch: 'arm64',
        nestedRequirement,
        requirement: `identifier "${BUNDLE_ID}" and ${nestedRequirement}`
    };
}

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

function plistToObject(xml) {
    if (!xml.trim()) {
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

function defaultEntitlements(channel) {
    const root = path.join(__dirname, '../../package/osx');
    const read = (name) => plistToObject(fs.readFileSync(path.join(root, name), 'utf8'));
    if (channel !== 'public' && channel !== 'development') {
        throw new Error('Unknown KeeWeb signing channel');
    }
    return { app: read('entitlements.plist'), inherit: read('entitlements-inherit.plist') };
}

// Returns the Mach-O file type, or null when the file is not Mach-O code.
function machOFileType(file) {
    const header = Buffer.alloc(64);
    const fd = fs.openSync(file, 'r');
    let length;
    try {
        length = fs.readSync(fd, header, 0, 64, 0);
        if (length < 16) {
            return null;
        }
        const magic = header.readUInt32BE(0);
        if (FAT_MAGICS.has(magic)) {
            const wide = magic === 0xcafebabf;
            const offset = wide ? Number(header.readBigUInt64BE(16)) : header.readUInt32BE(16);
            length = fs.readSync(fd, header, 0, 16, offset);
            if (length < 16 || !MACH_O_MAGICS.has(header.readUInt32BE(0))) {
                return null;
            }
        } else if (!MACH_O_MAGICS.has(magic)) {
            return null;
        }
    } finally {
        fs.closeSync(fd);
    }
    const bigEndian = [0xfeedface, 0xfeedfacf].includes(header.readUInt32BE(0));
    return bigEndian ? header.readUInt32BE(12) : header.readUInt32LE(12);
}

function listNestedCode(appPath) {
    const code = [];
    const walk = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(target);
            } else if (entry.isFile()) {
                const fileType = machOFileType(target);
                if (fileType !== null) {
                    code.push({ file: target, executable: fileType === MH_EXECUTE });
                }
            }
        }
    };
    walk(appPath);
    return code;
}

function verifyCode(run, policy, target, { requirement, runtime }) {
    const name = path.basename(target);
    const verified = run('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '-R',
        `=${requirement}`,
        target
    ]);
    if (verified.status !== 0) {
        throw new Error(`Signature does not satisfy the ${policy.channel} channel: ${name}`);
    }
    const info = run('/usr/bin/codesign', ['-d', '--verbose=4', target]);
    const lines = info.status === 0 ? info.stderr.split('\n') : [];
    if (
        !lines.includes(`TeamIdentifier=${policy.teamId}`) ||
        lines.find((line) => line.startsWith('Authority=')) !== `Authority=${policy.authority}`
    ) {
        throw new Error(`Signing identity must be ${policy.authority}: ${name}`);
    }
    if (runtime && !lines.some((line) => /\bflags=0x[0-9a-f]+\([^)]*\bruntime\b/.test(line))) {
        throw new Error(`Hardened Runtime is required: ${name}`);
    }
}

function readEntitlements(run, target) {
    const result = run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', target]);
    if (result.status !== 0) {
        throw new Error(`Cannot read entitlements: ${path.basename(target)}`);
    }
    const text = result.stdout.trim();
    return text.startsWith('{') ? JSON.parse(text) : plistToObject(text);
}

function verifyUpdateApp(appPath, channel, tools = {}) {
    const policy = signingPolicy(channel);
    const run = tools.run || defaultRun;
    const readBundleId = tools.readBundleId || defaultReadBundleId;
    const entitlements = tools.entitlements || defaultEntitlements(channel);
    if (readBundleId(appPath) !== policy.bundleId) {
        throw new Error('Unexpected bundle identifier');
    }
    const deep = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
    if (deep.status !== 0) {
        throw new Error('App bundle signature is invalid');
    }
    verifyCode(run, policy, appPath, { requirement: policy.requirement, runtime: true });
    if (!isDeepStrictEqual(readEntitlements(run, appPath), entitlements.app)) {
        throw new Error('App entitlements differ from package/osx/entitlements.plist');
    }
    const main = path.join(appPath, 'Contents/MacOS/KeeWeb');
    for (const { file, executable } of listNestedCode(appPath)) {
        verifyCode(run, policy, file, {
            requirement: policy.nestedRequirement,
            runtime: executable
        });
        if (file !== main) {
            for (const [key, value] of Object.entries(readEntitlements(run, file))) {
                if (!isDeepStrictEqual(entitlements.inherit[key], value)) {
                    throw new Error(`Unexpected nested entitlement ${key}: ${path.basename(file)}`);
                }
            }
        }
    }
    const arch = run('/usr/bin/lipo', ['-archs', main]);
    if (arch.status !== 0 || arch.stdout.trim() !== policy.arch) {
        throw new Error('This channel requires an arm64 app');
    }
}

module.exports = { signingPolicy, verifyUpdateApp };

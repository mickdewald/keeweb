const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signingPolicy } = require('../../scripts/release/verify-update-app');

const DEVELOPER_ID = 'Developer ID Application: Michael Dewald (GGYLL32K99)';
const DEVELOPMENT = 'Apple Development: Michael Dewald (UUCWA5MCLV)';
const TEAM = 'GGYLL32K99';
const BUNDLE = 'com.mickdewald.keeweb';
const APP_ID = `${TEAM}.${BUNDLE}`;
const BUILD = '20260919120000';
const DEVELOPMENT_REQUIREMENT = signingPolicy('development').requirement;
const PUBLIC_REQUIREMENT = signingPolicy('public').requirement;
const APP_ENTITLEMENTS = {
    'com.apple.security.cs.allow-jit': true,
    'com.apple.security.cs.allow-unsigned-executable-memory': true,
    'com.apple.security.cs.allow-dyld-environment-variables': true,
    'keychain-access-groups': [APP_ID],
    'com.apple.application-identifier': APP_ID,
    'com.apple.developer.team-identifier': TEAM
};
const INHERIT_ENTITLEMENTS = {
    'com.apple.security.cs.allow-jit': true,
    'com.apple.security.cs.allow-unsigned-executable-memory': true,
    'com.apple.security.cs.allow-dyld-environment-variables': true
};
const LEAF_CERTIFICATE = Buffer.from('fixture-development-leaf-certificate');
const OTHER_CERTIFICATE = Buffer.from('fixture-other-development-certificate');
const fingerprint = (der) => crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
const DEVELOPMENT_PROFILE = {
    platforms: ['OSX'],
    expirationDate: '2030-01-01T00:00:00Z',
    certificateFingerprints: [fingerprint(LEAF_CERTIFICATE)],
    entitlements: {
        'com.apple.application-identifier': APP_ID,
        'com.apple.developer.team-identifier': TEAM,
        'keychain-access-groups': [APP_ID]
    }
};

function machO(filetype) {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    header.writeUInt32LE(filetype, 12);
    return header;
}

function appFixture(name = 'KeeWeb.app') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-installed-compat-'));
    const app = path.join(root, name);
    const files = {
        main: 'Contents/MacOS/KeeWeb',
        helper: 'Contents/Frameworks/KeeWeb Helper.app/Contents/MacOS/KeeWeb Helper',
        framework: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
        native: 'Contents/Resources/app.asar.unpacked/keeweb-native.node'
    };
    for (const [kind, relative] of Object.entries(files)) {
        const file = path.join(app, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, machO(kind === 'main' || kind === 'helper' ? 2 : 6));
    }
    fs.writeFileSync(path.join(app, 'Contents/embedded.provisionprofile'), 'fixture-profile');
    fs.writeFileSync(path.join(app, 'Contents/Resources/app.asar'), 'asar-fixture');
    return {
        root,
        app,
        files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, path.join(app, v)]))
    };
}

function describeInfo(state) {
    return [
        `Identifier=${state.identifier || BUNDLE}`,
        `CodeDirectory v=20500 size=1 flags=${
            state.runtime === false ? '0x0(none)' : '0x10000(runtime)'
        } hashes=1`,
        `Authority=${state.authority}`,
        `TeamIdentifier=${state.teamId || TEAM}`,
        `CDHash=${state.cdhash || '1111111111111111111111111111111111111111'}`
    ].join('\n');
}

function fakeTools(states, options = {}) {
    const calls = [];
    const mutations = { stop: 0, delete: 0, copy: 0, open: 0 };
    const stateFor = (target) => {
        const match = Object.keys(states)
            .filter((appPath) => target === appPath || target.startsWith(`${appPath}/`))
            .sort((a, b) => b.length - a.length)[0];
        if (!match) {
            return {};
        }
        const state = states[match];
        if (target === match) {
            return state;
        }
        return {
            authority: state.authority,
            teamId: state.teamId,
            identifier: state.identifier,
            invalid: state.invalid,
            runtime: state.runtime,
            arch: state.arch
        };
    };
    const run = (command, args) => {
        calls.push([command, ...args]);
        const target = args[args.length - 1];
        const state = stateFor(target);
        if (command === '/usr/bin/pgrep') {
            return options.session
                ? { status: 0, stdout: '4242\n', stderr: '' }
                : { status: 1, stdout: '', stderr: '' };
        }
        if (command === '/usr/bin/osascript') {
            return {
                status: 0,
                stdout: `${options.bundleRunning ? 'true' : 'false'}\n`,
                stderr: ''
            };
        }
        if (command === '/usr/bin/lipo') {
            return { status: 0, stdout: `${state.arch || 'arm64'}\n`, stderr: '' };
        }
        const extract = args.find((arg) => String(arg).startsWith('--extract-certificates='));
        if (extract) {
            if (state.extractFails) {
                return { status: 1, stdout: '', stderr: 'cannot extract certificates' };
            }
            fs.writeFileSync(
                `${extract.slice('--extract-certificates='.length)}0`,
                state.leafCertificate || LEAF_CERTIFICATE
            );
            return { status: 0, stdout: '', stderr: '' };
        }
        if (args[0] === '--verify' && args.includes('-R')) {
            const requirement = args[args.indexOf('-R') + 1];
            if (!requirement.startsWith('=') || requirement.includes('\n')) {
                return { status: 1, stdout: '', stderr: 'malformed requirement' };
            }
            if (state.invalid || (state.failRequirement && requirement === state.failRequirement)) {
                return { status: 1, stdout: '', stderr: 'requirement failed' };
            }
            return { status: 0, stdout: '', stderr: '' };
        }
        if (args[0] === '--verify') {
            return { status: state.invalid ? 1 : 0, stdout: '', stderr: '' };
        }
        if (args.includes('--entitlements')) {
            return {
                status: 0,
                stdout: JSON.stringify(state.entitlements || {}),
                stderr: ''
            };
        }
        if (args.includes('-r-')) {
            const requirement = state.designatedRequirement;
            if (!requirement) {
                return { status: 1, stdout: '', stderr: '' };
            }
            return { status: 0, stdout: `designated => ${requirement}\n`, stderr: '' };
        }
        return {
            status: 0,
            stdout: '',
            stderr: describeInfo({
                authority: state.authority || DEVELOPMENT,
                teamId: state.teamId,
                identifier: state.identifier,
                cdhash: typeof options.cdhash === 'function' ? options.cdhash() : options.cdhash,
                runtime: state.runtime
            })
        };
    };
    return {
        run,
        calls,
        mutations,
        readBundleId: (appPath) => stateFor(appPath).identifier || BUNDLE,
        readMetadata: () =>
            options.metadata || {
                build: BUILD,
                channel: 'development'
            },
        readProfile: () => options.profile || DEVELOPMENT_PROFILE,
        entitlements: { app: APP_ENTITLEMENTS, inherit: INHERIT_ENTITLEMENTS },
        stop: () => mutations.stop++,
        delete: () => mutations.delete++,
        copy: () => mutations.copy++,
        open: () => mutations.open++
    };
}

function developmentState(extra = {}) {
    return {
        authority: DEVELOPMENT,
        designatedRequirement: DEVELOPMENT_REQUIREMENT,
        entitlements: APP_ENTITLEMENTS,
        ...extra
    };
}

function publicState(extra = {}) {
    return {
        authority: DEVELOPER_ID,
        designatedRequirement: PUBLIC_REQUIREMENT,
        entitlements: APP_ENTITLEMENTS,
        ...extra
    };
}

function assertNoMutations(tools) {
    assert.deepEqual(tools.mutations, { stop: 0, delete: 0, copy: 0, open: 0 });
    const launched = tools.calls.filter(
        (call) =>
            call[0] === '/usr/bin/osascript' && call.some((arg) => /\bquit\b/i.test(String(arg)))
    );
    assert.equal(launched.length, 0);
}

function assertRejected(fn, pattern, tools) {
    assert.throws(fn, pattern);
    assertNoMutations(tools);
}

module.exports = {
    DEVELOPER_ID,
    DEVELOPMENT,
    TEAM,
    BUNDLE,
    APP_ID,
    BUILD,
    DEVELOPMENT_REQUIREMENT,
    PUBLIC_REQUIREMENT,
    APP_ENTITLEMENTS,
    INHERIT_ENTITLEMENTS,
    LEAF_CERTIFICATE,
    OTHER_CERTIFICATE,
    fingerprint,
    DEVELOPMENT_PROFILE,
    machO,
    appFixture,
    describeInfo,
    fakeTools,
    developmentState,
    publicState,
    assertNoMutations,
    assertRejected
};

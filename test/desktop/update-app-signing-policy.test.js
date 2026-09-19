const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signingPolicy, verifyUpdateApp } = require('../../scripts/release/verify-update-app');

const DEVELOPER_ID = 'Developer ID Application: Michael Dewald (GGYLL32K99)';
const DEVELOPMENT = 'Apple Development: Michael Dewald (UUCWA5MCLV)';

test('public policy pins the exact Developer ID identity', () => {
    const policy = signingPolicy('public');
    assert.equal(policy.authority, DEVELOPER_ID);
    assert.equal(policy.teamId, 'GGYLL32K99');
    assert.equal(policy.bundleId, 'com.mickdewald.keeweb');
    assert.equal(policy.arch, 'arm64');
    assert.match(policy.requirement, /identifier "com\.mickdewald\.keeweb"/);
    assert.match(policy.requirement, /anchor apple generic/);
    assert.match(policy.requirement, /certificate leaf\[field\.1\.2\.840\.113635\.100\.6\.1\.13\]/);
    assert.match(policy.requirement, /certificate leaf\[subject\.OU\] = "GGYLL32K99"/);
    assert.doesNotMatch(policy.requirement, /Apple Development/);
});

test('development policy stays on the existing Apple Development identity', () => {
    const policy = signingPolicy('development');
    assert.equal(policy.authority, DEVELOPMENT);
    assert.match(policy.requirement, /Apple Development: Michael Dewald \(UUCWA5MCLV\)/);
    assert.doesNotMatch(policy.requirement, /Developer ID/);
});

test('there is no policy for a missing or unknown channel', () => {
    assert.throws(() => signingPolicy());
    assert.throws(() => signingPolicy('beta'));
    assert.throws(() => signingPolicy('constructor'));
});

// Thin arm64 Mach-O header: magic, cputype, cpusubtype, filetype.
function machO(filetype) {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    header.writeUInt32LE(filetype, 12);
    return header;
}

function appFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-signing-policy-'));
    const app = path.join(root, 'KeeWeb.app');
    const files = {
        main: 'Contents/MacOS/KeeWeb',
        helper: 'Contents/Frameworks/KeeWeb Helper.app/Contents/MacOS/KeeWeb Helper',
        framework: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
        native: 'Contents/Resources/app.asar.unpacked/keeweb-native.node'
    };
    for (const [name, relative] of Object.entries(files)) {
        const file = path.join(app, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, machO(name === 'main' || name === 'helper' ? 2 : 6));
    }
    fs.writeFileSync(path.join(app, 'Contents/Resources/readme.txt'), 'not code');
    fs.symlinkSync(
        'A',
        path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/Current')
    );
    return {
        app,
        files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, path.join(app, v)]))
    };
}

function fakeTools(fixture, overrides = {}) {
    const calls = [];
    const describe = (authority, runtime = true) =>
        `Identifier=x\nCodeDirectory v=20500 size=1 flags=${
            runtime ? '0x10000(runtime)' : '0x0(none)'
        } hashes=1\nAuthority=${authority}\nAuthority=Developer ID Certification Authority\nTeamIdentifier=GGYLL32K99\n`;
    const run = (command, args) => {
        calls.push([command, ...args]);
        const target = args[args.length - 1];
        const override = overrides[target];
        if (command === '/usr/bin/lipo') {
            return { status: 0, stdout: `${override?.arch || 'arm64'}\n`, stderr: '' };
        }
        if (args[0] === '--verify') {
            return { status: override?.invalid ? 1 : 0, stdout: '', stderr: '' };
        }
        if (args.includes('--entitlements')) {
            return { status: 0, stdout: JSON.stringify(override?.entitlements || {}), stderr: '' };
        }
        return {
            status: 0,
            stdout: '',
            stderr: describe(override?.authority || DEVELOPER_ID, override?.runtime !== false)
        };
    };
    return { run, calls, bundleId: () => 'com.mickdewald.keeweb', fixture };
}

const entitlementPolicy = {
    app: { 'com.apple.security.cs.allow-jit': true },
    inherit: { 'com.apple.security.cs.allow-jit': true }
};

function verify(fixture, overrides, extra = {}) {
    const tools = fakeTools(fixture, {
        [fixture.app]: { entitlements: entitlementPolicy.app },
        ...overrides
    });
    verifyUpdateApp(fixture.app, 'public', {
        run: tools.run,
        readBundleId: tools.bundleId,
        entitlements: entitlementPolicy,
        ...extra
    });
    return tools;
}

test('verifies the outer app and every nested Mach-O against the channel identity', () => {
    const fixture = appFixture();
    const { calls } = verify(fixture, {});
    const verified = calls.filter((call) => call[1] === '--verify').map((call) => call.at(-1));
    for (const file of Object.values(fixture.files)) {
        assert.ok(verified.includes(file), `did not verify ${file}`);
    }
    assert.ok(verified.includes(fixture.app));
    assert.ok(!verified.some((file) => file.endsWith('readme.txt')));
});

test('finds universal binaries and never follows symlinks out of the bundle', () => {
    const fixture = appFixture();
    const fat = path.join(fixture.app, 'Contents/Resources/universal-helper');
    const header = Buffer.alloc(4096);
    header.writeUInt32BE(0xcafebabe, 0);
    header.writeUInt32BE(1, 4);
    header.writeUInt32BE(2048, 16);
    machO(2).copy(header, 2048);
    fs.writeFileSync(fat, header);
    const outside = path.join(path.dirname(fixture.app), 'outside-tool');
    fs.writeFileSync(outside, machO(2));
    fs.symlinkSync(outside, path.join(fixture.app, 'Contents/Resources/linked-tool'));

    const { calls } = verify(fixture, {});
    const verified = calls.filter((call) => call[1] === '--verify').map((call) => call.at(-1));
    assert.ok(verified.includes(fat));
    assert.ok(!verified.some((file) => file.includes('linked-tool') || file === outside));
    assert.throws(() => verify(fixture, { [fat]: { runtime: false } }), /runtime/i);
    assert.throws(() => verify(fixture, { [fat]: { authority: DEVELOPMENT } }), /universal-helper/);
});

test('one incorrectly signed nested helper fails the whole app', () => {
    const fixture = appFixture();
    assert.throws(() => verify(fixture, { [fixture.files.helper]: { invalid: true } }), /Helper/);
    assert.throws(
        () => verify(fixture, { [fixture.files.native]: { authority: DEVELOPMENT } }),
        /keeweb-native\.node/
    );
    assert.throws(
        () => verify(fixture, { [fixture.files.framework]: { authority: 'adhoc' } }),
        /Electron Framework/
    );
});

test('requires Hardened Runtime on every executable', () => {
    const fixture = appFixture();
    assert.throws(
        () => verify(fixture, { [fixture.files.helper]: { runtime: false } }),
        /runtime/i
    );
    assert.throws(() => verify(fixture, { [fixture.files.main]: { runtime: false } }), /runtime/i);
});

test('rejects a wrong outer identity, bundle ID, architecture or entitlement set', () => {
    const fixture = appFixture();
    assert.throws(() =>
        verify(fixture, {
            [fixture.app]: { authority: DEVELOPMENT, entitlements: entitlementPolicy.app }
        })
    );
    assert.throws(() => verify(fixture, {}, { readBundleId: () => 'net.antelle.keeweb' }));
    assert.throws(() => verify(fixture, { [fixture.files.main]: { arch: 'x86_64 arm64' } }));
    assert.throws(
        () =>
            verify(fixture, {
                [fixture.app]: {
                    entitlements: {
                        ...entitlementPolicy.app,
                        'com.apple.security.get-task-allow': true
                    }
                }
            }),
        /entitlement/i
    );
    assert.throws(() => verify(fixture, { [fixture.app]: { entitlements: {} } }), /entitlement/i);
    assert.throws(
        () =>
            verify(fixture, {
                [fixture.files.helper]: {
                    entitlements: { 'com.apple.security.cs.disable-library-validation': true }
                }
            }),
        /entitlement/i
    );
});

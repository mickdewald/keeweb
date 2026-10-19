import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const CERT_SHA256 = 'a'.repeat(64);

function fixture(t, { dirty = false, scanStatus = 0, runnerStatus = 0, staleApk = false } = {}) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-build-release-'));
    const repo = path.join(work, 'repo');
    const bin = path.join(work, 'bin');
    const ops = path.join(work, 'ops-platform');
    const log = path.join(work, 'log');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(repo, 'scripts/android'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'android'), { recursive: true });
    for (const name of ['build-release.sh', 'assemble-release.sh']) {
        fs.copyFileSync(path.join(root, 'scripts/android', name), path.join(repo, 'scripts/android', name));
    }
    const sdk = path.join(work, 'sdk');
    fs.writeFileSync(path.join(repo, 'scripts/android/env.sh'), `export JAVA_HOME=/tmp/fake-jdk\nexport ANDROID_HOME=${sdk}\n`);
    fs.writeFileSync(path.join(repo, 'android/gradlew'), `#!/bin/sh
printf 'gradle:%s:%s:%s\\n' "$*" "$KEEWEB_ANDROID_KEYSTORE" "$KEEWEB_ANDROID_KEYSTORE_PASSWORD" >> "$FAKE_LOG"
mkdir -p app/build/outputs/apk/release
: > app/build/outputs/apk/release/app-release.apk
`, { mode: 0o700 });
    fs.mkdirSync(path.join(sdk, 'build-tools/35.0.0'), { recursive: true });
    fs.writeFileSync(path.join(sdk, 'build-tools/35.0.0/apksigner'), `#!/bin/sh
printf 'apksigner:%s\\n' "$*" >> "$FAKE_LOG"
printf 'Signer #1 certificate SHA-256 digest: %s\\n' "$FAKE_CERT_SHA256"
`, { mode: 0o700 });
    if (staleApk) {
        fs.mkdirSync(path.join(repo, 'android/app/build/outputs/apk/release'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'android/app/build/outputs/apk/release/app-release.apk'), 'stale');
    }
    fs.mkdirSync(path.join(ops, 'scripts/spark_release'), { recursive: true });
    fs.writeFileSync(path.join(ops, 'scripts/spark_release/android_signing_exec.py'), '');
    const executable = (name, body) => fs.writeFileSync(path.join(bin, name), body, { mode: 0o700 });
    executable('git', `#!/bin/sh
if [ "$1" = -C ]; then shift 2; fi
if [ "$1" = status ]; then ${dirty ? 'printf dirty' : 'exit 0'}; fi
if [ "$1" = remote ]; then printf 'git@github.com:mickdewald/ops-platform.git\\n'; exit 0; fi
if [ "$1" = merge-base ]; then exit 0; fi
exit 99
`);
    executable('npm', `#!/bin/sh
printf 'npm:%s:%s:%s\\n' "$*" "\${KEEWEB_ANDROID_KEYSTORE-unset}" "\${KEEWEB_ANDROID_KEYSTORE_PASSWORD-unset}" >> "$FAKE_LOG"
for name in TURBO_RN_RELEASE_STORE_PASSWORD BAO_TOKEN VAULT_TOKEN; do
  printenv "$name" >> "$FAKE_LOG" || :
done
`);
    executable('npx', `#!/bin/sh
printf 'npx:%s:%s:%s\\n' "$*" "\${KEEWEB_ANDROID_KEYSTORE-unset}" "\${KEEWEB_ANDROID_KEYSTORE_PASSWORD-unset}" >> "$FAKE_LOG"
for name in TURBO_RN_RELEASE_STORE_PASSWORD BAO_TOKEN VAULT_TOKEN; do
  printenv "$name" >> "$FAKE_LOG" || :
done
`);
    executable('security', `#!/bin/sh
printf 'keychain:%s\\n' "$*" >> "$FAKE_LOG"
exit 97
`);
    executable('python3', `#!/bin/sh
set +x
export KEEWEB_ANDROID_KEYSTORE=/tmp/ephemeral.p12
export KEEWEB_ANDROID_KEYSTORE_PASSWORD=runner-only-password
export KEEWEB_ANDROID_CERT_SHA256="$FAKE_CERT_SHA256"
printf 'runner:%s:%s:%s\\n' "$*" "$PYTHONPATH" "\${KEEWEB_ANDROID_CERT_SHA256-unset}" >> "$FAKE_LOG"
for last; do :; done
"$last" || exit $?
exit "$FAKE_RUNNER_STATUS"
`);
    executable('nice', `#!/bin/sh
shift 2
exec "$@"
`);
    executable('bash', `#!/bin/sh
if [ "$1" = scripts/android/check-apk-secrets.sh ]; then
  printf 'scan:%s\\n' "$2" >> "$FAKE_LOG"
  exit "$FAKE_SCAN_STATUS"
fi
exec /bin/bash "$@"
`);
    t.after(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });
    return { repo, log, bin, sdk, ops, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPS_PLATFORM_ROOT: ops,
        FAKE_LOG: log, FAKE_SCAN_STATUS: String(scanStatus), FAKE_RUNNER_STATUS: String(runnerStatus), FAKE_CERT_SHA256: CERT_SHA256,
        KEEWEB_ANDROID_KEYSTORE: '/tmp/caller-value.p12',
        KEEWEB_ANDROID_KEYSTORE_PASSWORD: 'caller-password', TURBO_RN_RELEASE_STORE_PASSWORD: 'caller-other-key',
        BAO_TOKEN: 'caller-admin-token', VAULT_TOKEN: 'caller-vault-token' } };
}

test('clean release builds web and Capacitor without credentials, then hands Gradle to OpenBao', (t) => {
    const f = fixture(t);
    const result = spawnSync('/bin/bash', ['scripts/android/build-release.sh'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const lines = fs.readFileSync(f.log, 'utf8').trim().split('\n');
    assert.deepEqual(lines.slice(0, 2), ['npm:run android:web:unset:unset', 'npx:cap sync android:unset:unset']);
    assert.match(lines[2], new RegExp(`^runner:-P -m scripts\\.spark_release\\.android_signing_exec --machine-identity android-release-signing --repo keeweb --app keeweb run -- .*scripts/android/assemble-release\\.sh:${f.env.OPS_PLATFORM_ROOT}:${CERT_SHA256}$`));
    assert.equal(lines[3], 'gradle:--no-daemon assembleRelease:/tmp/ephemeral.p12:runner-only-password');
    assert.match(lines[4], /^apksigner:verify --print-certs .*app-release\.apk$/);
    assert.match(lines[5], /^scan:.*app-release\.apk$/);
    assert.doesNotMatch(fs.readFileSync(f.log, 'utf8'), /caller-password|caller-value|caller-other-key|caller-admin-token|caller-vault-token/);
    assert.equal(lines.some((line) => line.startsWith('keychain:')), false);
});

test('dirty tree fails before web, Capacitor, or signing work', (t) => {
    const f = fixture(t, { dirty: true });
    const result = spawnSync('/bin/bash', ['scripts/android/build-release.sh'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /dirty tree/);
    assert.equal(fs.existsSync(f.log), false);
});

test('a failed APK scan removes the generated artifact', (t) => {
    const f = fixture(t, { scanStatus: 1 });
    const apk = path.join(f.repo, 'android/app/build/outputs/apk/release/app-release.apk');
    const result = spawnSync('/bin/bash', ['scripts/android/build-release.sh'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Secret check failed/);
    assert.equal(fs.existsSync(apk), false);
});

test('inherited xtrace does not write the signing password to build output', (t) => {
    const f = fixture(t);
    const result = spawnSync('/bin/bash', ['scripts/android/assemble-release.sh'], {
        cwd: f.repo,
        env: { ...f.env, ANDROID_HOME: f.sdk, KEEWEB_ANDROID_KEYSTORE: '/tmp/ephemeral.p12',
            KEEWEB_ANDROID_KEYSTORE_PASSWORD: 'runner-only-password', KEEWEB_ANDROID_CERT_SHA256: CERT_SHA256,
            SHELLOPTS: `${process.env.SHELLOPTS || 'braceexpand:hashall:interactive-comments'}:xtrace` },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /runner-only-password/);
});

test('a signing runner cleanup failure removes stale and newly built APKs before they can be scanned', (t) => {
    const f = fixture(t, { runnerStatus: 21, staleApk: true });
    const apk = path.join(f.repo, 'android/app/build/outputs/apk/release/app-release.apk');
    const result = spawnSync('/bin/bash', ['scripts/android/build-release.sh'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /signing runner failed; removed/);
    assert.equal(fs.existsSync(apk), false);
    assert.doesNotMatch(fs.readFileSync(f.log, 'utf8'), /scan:/);
});

test('the runner ignores a same-named cwd Python package and uses only the trusted ops checkout', (t) => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.repo, 'scripts/spark_release'), { recursive: true });
    fs.writeFileSync(path.join(f.repo, 'scripts/spark_release/android_signing_exec.py'), 'raise SystemExit("cwd shadow must not run")\n');
    fs.unlinkSync(path.join(f.bin, 'python3'));
    fs.writeFileSync(path.join(f.ops, 'scripts/spark_release/android_signing_exec.py'), 'print("trusted ops module")\n');
    const result = spawnSync('/bin/bash', ['scripts/android/build-release.sh'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /trusted ops module/);
});

for (const kind of ['mismatched', 'additional']) {
    test(`a ${kind} APK signer fails and removes the artifact`, (t) => {
        const f = fixture(t);
        const first = kind === 'mismatched' ? 'b'.repeat(64) : CERT_SHA256;
        const second = kind === 'additional' ? `Signer #2 certificate SHA-256 digest: ${'b'.repeat(64)}\n` : '';
        fs.writeFileSync(path.join(f.sdk, 'build-tools/35.0.0/apksigner'),
            `#!/bin/sh\nprintf '%s\\n' 'Signer #1 certificate SHA-256 digest: ${first}' '${second}'\n`);
        const result = spawnSync('/bin/bash', ['scripts/android/build-release.sh'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /certificate does not match/);
        assert.equal(fs.existsSync(path.join(f.repo, 'android/app/build/outputs/apk/release/app-release.apk')), false);
        assert.doesNotMatch(fs.readFileSync(f.log, 'utf8'), /scan:/);
    });
}

test('signer verification supports the default SDK without ANDROID_HOME', (t) => {
    const f = fixture(t);
    const home = path.join(path.dirname(f.repo), 'home');
    fs.mkdirSync(path.join(home, 'Library/Android'), { recursive: true });
    fs.symlinkSync(f.sdk, path.join(home, 'Library/Android/sdk'));
    const env = { ...f.env, HOME: home, KEEWEB_ANDROID_KEYSTORE: '/tmp/ephemeral.p12',
        KEEWEB_ANDROID_KEYSTORE_PASSWORD: 'runner-only-password', KEEWEB_ANDROID_CERT_SHA256: CERT_SHA256 };
    delete env.ANDROID_HOME;
    const result = spawnSync('/bin/bash', ['scripts/android/assemble-release.sh'], { cwd: f.repo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(f.log, 'utf8'), /apksigner:verify --print-certs/);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const installer = new URL('../scripts/install-chrome-headless-shell.sh', import.meta.url).pathname;
const expected = '89d80a6d26ccd0ccfd51e22d9e1297283862af2b0cd91dce07459b35ca0059f2';

function writeExecutable(path, body) {
    writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    chmodSync(path, 0o755);
}

function run(mode) {
    const work = mkdtempSync(join(tmpdir(), 'keeweb-chrome-bootstrap-test-'));
    try {
        const bin = join(work, 'bin');
        const temp = join(work, 'temp');
        const envFile = join(work, 'github-env');
        mkdirSync(bin); mkdirSync(temp); writeFileSync(envFile, '');
        writeExecutable(join(bin, 'curl'), mode === 'curl-fail' ? 'exit 22' : 'archive="${@: -2:1}"; printf archive > "$archive"');
        writeExecutable(join(bin, 'shasum'), `printf '%s  %s\\n' '${mode === 'checksum-mismatch' ? '0'.repeat(64) : expected}' "$3"`);
        writeExecutable(join(bin, 'unzip'), mode === 'invalid' ? 'exit 9' : `if [[ "$1" == '-Z' ]]; then ${mode === 'list-fail' ? 'exit 8' : mode === 'unsafe-path' ? "printf '../escape\\n'" : "printf 'chrome-headless-shell-mac-arm64/chrome-headless-shell\\n'"}; fi`);
        writeExecutable(join(bin, 'zipinfo'), mode === 'zipinfo-fail' ? 'exit 8' : mode === 'symlink-entry' ? "printf '%s\\n' 'Archive: mock' 'Zip file size: 1, number of entries: 1' 'lrwxr-xr-x  3.0 unx 0 0 stor 01-Jan-26 00:00 link'" : "printf '%s\\n' 'Archive: mock' 'Zip file size: 1, number of entries: 1' '-rwxr-xr-x 3.0 unx 1 1 stor 01-Jan-26 00:00 chrome-headless-shell-mac-arm64/chrome-headless-shell'");
        writeExecutable(join(bin, 'ditto'), `target="${'${@: -1}'}"; mkdir -p "$target/chrome-headless-shell-mac-arm64"; ${mode === 'zero-binary' ? 'true' : `printf '#!/usr/bin/env bash\\necho "Google Chrome for Testing ${mode === 'wrong-version' ? '152.0.0.0' : '153.0.8010.12'}"\\n' > "$target/chrome-headless-shell-mac-arm64/chrome-headless-shell"; chmod +x "$target/chrome-headless-shell-mac-arm64/chrome-headless-shell"`} ${mode === 'multiple' ? '; mkdir -p "$target/other"; cp "$target/chrome-headless-shell-mac-arm64/chrome-headless-shell" "$target/other/chrome-headless-shell"' : ''}`);
        const result = execFileSync('/bin/bash', [installer], {
            cwd: new URL('..', import.meta.url).pathname,
            encoding: 'utf8',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, GITHUB_ENV: envFile }
        });
        return { result, env: readFileSync(envFile, 'utf8') };
    } finally { rmSync(work, { recursive: true, force: true }); }
}

test('bootstraps one exact Chrome binary from the verified archive', () => {
    const { env } = run('success');
    assert.match(env, /^CHROME_BIN=.*chrome-headless-shell$/m);
});
for (const mode of ['curl-fail', 'checksum-mismatch', 'invalid', 'list-fail', 'unsafe-path', 'zipinfo-fail', 'symlink-entry', 'zero-binary', 'multiple', 'wrong-version']) {
    test(`fails closed for ${mode}`, () => assert.throws(() => run(mode)));
}

test('workflow invokes the shared verified bootstrap before tests', () => {
    const workflow = readFileSync(new URL('../.github/workflows/build-tests.yml', import.meta.url), 'utf8');
    assert.match(workflow, /scripts\/install-chrome-headless-shell\.sh/);
    const script = readFileSync(new URL('../scripts/install-chrome-headless-shell.sh', import.meta.url), 'utf8');
    assert.match(script, /chrome-for-testing-public\/\$\{CHROME_VERSION\}\/mac-arm64/);
    assert.match(script, /readonly CHROME_VERSION='153\.0\.8010\.12'/);
    assert.match(script, /89d80a6d26ccd0ccfd51e22d9e1297283862af2b0cd91dce07459b35ca0059f2/);
    assert.match(workflow, /chrome-headless-shell-bootstrap\.test\.mjs/);
});

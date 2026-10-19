import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/android/emulator.sh', import.meta.url));

function fixture(t, occupied) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-emulator-test-'));
    t.after(() => fs.rmSync(work, { recursive: true, force: true }));
    for (const dir of ['emulator', 'platform-tools', 'bin']) {
        fs.mkdirSync(path.join(work, dir));
    }
    const executable = (relative, content) => {
        fs.writeFileSync(path.join(work, relative), content, { mode: 0o700 });
    };
    executable(
        'emulator/emulator',
        `#!/usr/bin/env python3
import os, sys, time
from pathlib import Path
if '-list-avds' in sys.argv:
    print('KeeWebSpike')
else:
    Path(os.environ['FAKE_EMULATOR_PID']).write_text(str(os.getpid()))
    time.sleep(60)
`
    );
    executable(
        'platform-tools/adb',
        `#!/bin/sh
if [ "$3" = get-state ]; then exit ${occupied ? 0 : 1}; fi
exit 0
`
    );
    executable('bin/sleep', '#!/bin/sh\nexit 0\n');
    const pidFile = path.join(work, 'emulator.pid');
    t.after(() => {
        if (fs.existsSync(pidFile)) {
            try {
                process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGTERM');
            } catch {}
        }
    });
    return {
        work,
        pidFile,
        env: {
            ...process.env,
            ANDROID_HOME: work,
            TMPDIR: `${work}/`,
            PATH: `${work}/bin:${process.env.PATH}`,
            FAKE_EMULATOR_PID: pidFile
        }
    };
}

test('an occupied emulator port is refused before any new process starts', (t) => {
    const f = fixture(t, true);
    const result = spawnSync('bash', [script, 'start'], { env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already in use/);
    assert.equal(fs.existsSync(f.pidFile), false);
});

test('failed boot terminates the process launched by that start command', async (t) => {
    const f = fixture(t, false);
    const result = spawnSync('bash', [script, 'start'], {
        env: f.env,
        encoding: 'utf8',
        timeout: 10000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /did not boot/);
    assert.equal(fs.existsSync(f.pidFile), true, 'the test must have launched the emulator');
    const pid = Number(fs.readFileSync(f.pidFile, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

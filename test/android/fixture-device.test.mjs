import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/android/assert-fixture-device.sh', import.meta.url));

test('instrumentation only accepts the single intended online emulator', (t) => {
    const sdk = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-device-guard-'));
    t.after(() => fs.rmSync(sdk, { recursive: true, force: true }));
    fs.mkdirSync(path.join(sdk, 'platform-tools'));
    fs.writeFileSync(path.join(sdk, 'platform-tools/adb'), '#!/bin/sh\nprintf "List of devices attached\\n%s\\n" "$FAKE_DEVICES"\n', { mode: 0o700 });
    for (const [devices, serial, expected] of [
        ['emulator-5580\tdevice', 'emulator-5580', 0],
        ['emulator-5580\tdevice\nphone\tdevice', 'emulator-5580', 1],
        ['emulator-5580\tdevice\nphone\tunauthorized', 'emulator-5580', 1],
        ['emulator-5580\toffline', 'emulator-5580', 1],
        ['emulator-5582\tdevice', 'emulator-5580', 1],
        ['', 'emulator-5580', 1],
        ['phone\tdevice', 'phone', 1]
    ]) {
        const result = spawnSync('bash', [script, serial], {
            encoding: 'utf8', env: { ...process.env, ANDROID_HOME: sdk, FAKE_DEVICES: devices }
        });
        assert.equal(result.status, expected, `${serial}: ${devices}`);
    }
});

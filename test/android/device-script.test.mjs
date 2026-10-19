/* eslint-disable import/no-relative-parent-imports */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    assertDeviceTarget,
    assertFreshFileInfo,
    isFreshFileInfoState,
    assertUnusedForward
} from '../../scripts/android/e2e-device.mjs';

const script = fileURLToPath(new URL('../../scripts/android/e2e-device.mjs', import.meta.url));

function adbFor({ state = 'device', qemu = '0', forwards = '' } = {}) {
    return (...args) => {
        if (args.join(' ') === 'get-state') {
            return `${state}\n`;
        }
        if (args.join(' ') === 'shell getprop ro.kernel.qemu') {
            return `${qemu}\n`;
        }
        if (args.join(' ') === 'forward --list') {
            return forwards;
        }
        throw new Error(`unexpected adb call: ${args.join(' ')}`);
    };
}

test('physical QA requires an explicit online non-emulator debug target', () => {
    assert.throws(
        () => assertDeviceTarget('', 'com.mickdewald.keeweb.dev', adbFor()),
        /KEEWEB_SERIAL/
    );
    assert.throws(
        () => assertDeviceTarget('emulator-5580', 'com.mickdewald.keeweb.dev', adbFor()),
        /emulator/
    );
    assert.throws(
        () => assertDeviceTarget('phone', 'com.mickdewald.keeweb', adbFor()),
        /requires com\.mickdewald\.keeweb\.dev/
    );
    assert.throws(
        () => assertDeviceTarget('phone', 'com.mickdewald.keeweb.dev', adbFor({ qemu: '1' })),
        /emulator/
    );
    assert.throws(
        () =>
            assertDeviceTarget('phone', 'com.mickdewald.keeweb.dev', adbFor({ state: 'offline' })),
        /not online/
    );
    assert.doesNotThrow(() =>
        assertDeviceTarget('physical-serial', 'com.mickdewald.keeweb.dev', adbFor())
    );
});

test('physical QA refuses to replace an existing CDP forward', () => {
    assert.throws(
        () =>
            assertUnusedForward(
                adbFor({ forwards: 'physical-serial tcp:9333 localabstract:other\n' }),
                9333
            ),
        /existing adb forward/
    );
    assert.doesNotThrow(() =>
        assertUnusedForward(
            adbFor({ forwards: 'physical-serial tcp:9334 localabstract:other\n' }),
            9333
        )
    );
});

test('physical QA refuses forwards on the same local port from another device', () => {
    assert.throws(
        () =>
            assertUnusedForward(
                adbFor({ forwards: 'other-device tcp:9333 localabstract:other\n' }),
                9333
            ),
        /existing adb forward/
    );
});

test('physical runner aborts before fixture injection if state is nonempty or unknown', async () => {
    const ready = {
        fileInfo: null,
        inputVisible: true,
        lockOverlay: false,
        recent: 0,
        entries: 0
    };
    assert.equal(isFreshFileInfoState(ready), true);
    assert.equal(isFreshFileInfoState({ ...ready, fileInfo: '[]' }), true);
    assert.equal(isFreshFileInfoState({ ...ready, fileInfo: '[{"id":"saved"}]' }), false);
    assert.equal(isFreshFileInfoState({ ...ready, fileInfo: '{bad' }), false);
    assert.equal(isFreshFileInfoState({ ...ready, fileInfo: '{}' }), false);
    assert.equal(isFreshFileInfoState(null), false);
    assert.equal(isFreshFileInfoState({ ...ready, inputVisible: false }), false);
    assert.equal(isFreshFileInfoState({ ...ready, lockOverlay: true }), false);
    assert.equal(isFreshFileInfoState({ ...ready, entries: 1 }), false);
    await assert.doesNotReject(() => assertFreshFileInfo({ evaluate: async () => ready }));
    await assert.rejects(
        () => assertFreshFileInfo({ evaluate: async () => ({ ...ready, fileInfo: '{bad' }) }),
        /existing or unknown file state/
    );
});

test('physical runner contains no destructive package commands', () => {
    const source = fs.readFileSync(script, 'utf8');
    assert.doesNotMatch(source, /adb\('shell', 'pm'/);
    assert.doesNotMatch(source, /adb\('shell', 'am', 'force-stop'/);
    assert.match(source, /KEEWEB_SERIAL/);
    assert.match(source, /assertFreshFileInfo/);
});

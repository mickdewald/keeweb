// Physical-device E2E. It never changes package data or installation state.
/* eslint-disable no-console */
import { adb, connect, isMainModule } from './cdp.mjs';
import { Steps, connectWhenReady, openFixture, waitFor } from './e2e-emulator.mjs';

const appId = process.env.KEEWEB_APP_ID || 'com.mickdewald.keeweb.dev';
const serial = process.env.KEEWEB_SERIAL;
const port = Number(process.env.KEEWEB_CDP_PORT || 9333);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
}

export function assertDeviceTarget(targetSerial, targetAppId, runAdb) {
    if (!targetSerial) {
        throw new Error('KEEWEB_SERIAL must explicitly name the physical device');
    }
    if (/^emulator-\d+$/.test(targetSerial)) {
        throw new Error('Physical-device QA refuses emulator serials');
    }
    if (targetAppId !== 'com.mickdewald.keeweb.dev') {
        throw new Error('Physical-device QA requires com.mickdewald.keeweb.dev');
    }
    if (runAdb('get-state').trim() !== 'device') {
        throw new Error('Selected Android device is not online');
    }
    if (runAdb('shell', 'getprop', 'ro.kernel.qemu').trim() === '1') {
        throw new Error('Physical-device QA refuses emulator targets');
    }
}

export function assertUnusedForward(runAdb, targetPort) {
    const used = runAdb('forward', '--list')
        .split('\n')
        .some((line) => line.trim().split(/\s+/)[1] === `tcp:${targetPort}`);
    if (used) {
        throw new Error(`Refusing to replace existing adb forward tcp:${targetPort}`);
    }
}

export function isFreshFileInfoState(state) {
    if (
        !state ||
        typeof state !== 'object' ||
        !state.inputVisible ||
        state.lockOverlay ||
        state.recent ||
        state.entries
    ) {
        return false;
    }
    if (state.fileInfo === null) {
        return true;
    }
    try {
        const fileInfo = JSON.parse(state.fileInfo);
        return Array.isArray(fileInfo) && fileInfo.length === 0;
    } catch {
        return false;
    }
}

export async function assertFreshFileInfo(c) {
    const state = await c.evaluate(`(() => {
        const recent = document.querySelectorAll('.open__last-item').length;
        const entries = [...document.querySelectorAll('.list__item')]
            .filter((item) => item.getClientRects().length > 0).length;
        const input = document.querySelector('.open__pass-input');
        return {
            fileInfo: localStorage.getItem('fileInfo'),
            inputVisible: !!input && input.getClientRects().length > 0 &&
                getComputedStyle(input).visibility === 'visible',
            lockOverlay: !!document.querySelector('.android-lock-screen'),
            recent,
            entries
        };
    })()`);
    if (!isFreshFileInfoState(state)) {
        throw new Error('Debug app has existing or unknown file state; refusing to continue');
    }
}

async function run() {
    let c = null;
    let forwardOwned = false;
    let current = '(setup)';
    try {
        assertDeviceTarget(serial, appId, adb);
        assertUnusedForward(adb, port);
        adb('shell', 'am', 'start', '-W', '-n', `${appId}/com.mickdewald.keeweb.MainActivity`);
        forwardOwned = true;
        c = await connectWhenReady();
        await assertFreshFileInfo(c);
        for (const step of Steps) {
            current = step.name;
            process.stdout.write(`- ${step.name}\n`);
            const reconnect = async () => {
                c.close();
                c = await connect();
                return c;
            };
            await step.run(c, { adb, sleep, waitFor, assert, openFixture, reconnect });
        }
        console.log('Device E2E OK');
    } catch (error) {
        console.error(`FAILED: ${current}: ${error.message}`);
        process.exitCode = 1;
    } finally {
        try {
            c?.close();
            if (forwardOwned) {
                adb('forward', '--remove', `tcp:${port}`);
            }
        } catch {
            // cleanup must not hide the original failure
        }
    }
}

if (isMainModule(import.meta.url, process.argv[1])) {
    run();
}

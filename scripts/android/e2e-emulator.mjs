// scripts/android/e2e-emulator.mjs
// Usage: node scripts/android/e2e-emulator.mjs [--only <step>]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, adb } from './cdp.mjs';

const appId = process.env.KEEWEB_APP_ID || 'com.mickdewald.keeweb.dev';
const fixture = fs.readFileSync(fileURLToPath(new URL('../../test/android/fixtures/e2e-fixture.kdbx', import.meta.url))).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, message) {
    if (!cond) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
}

async function waitFor(c, expression, timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (await c.evaluate(expression)) {
            return;
        }
        await sleep(200);
    }
    throw new Error(`timeout waiting for: ${expression.slice(0, 120)}`);
}

// Loads the fixture through KeeWeb's own file input, without the system picker.
async function openFixture(c) {
    // KeeWeb only accepts file data after openAny() set its reading mode, and openAny() would
    // open the system picker via input.click(). Click the readonly password field to enter the
    // reading mode, with the file input's click() neutralised for that one call.
    await c.evaluate(`(() => {
        const input = document.querySelector('.open__file-ctrl');
        const origClick = input.click;
        input.click = () => {};
        document.querySelector('.open__pass-input').click();
        input.click = origClick;
        return true;
    })()`);
    await c.evaluate(`(() => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(fixture)}), (ch) => ch.charCodeAt(0));
        const file = new File([bytes], 'e2e-fixture.kdbx');
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.querySelector('.open__file-ctrl');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
    await waitFor(c, `!!document.querySelector('.open__pass-input') && document.querySelector('.open__pass-input').placeholder.includes('e2e-fixture')`);
    await c.evaluate(`(() => { const i = document.querySelector('.open__pass-input');
        i.value = 'e2e-fake-password'; i.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.open__pass-enter-btn').click(); return true; })()`);
    await waitFor(c, `document.querySelectorAll('.list__item').length > 0`);
}

const Steps = [
    {
        name: 'unlock',
        async run(c) {
            const t = Date.now();
            await openFixture(c);
            console.log(`  unlocked in ${Date.now() - t} ms`);
        }
    },
    {
        name: 'back-from-details',
        async run(c, { adb, sleep, assert }) {
            await sleep(1500);
            // The "Local file" notice is open after the unlock: back must close it first.
            const modal = `!!document.querySelector('.modal:not(.modal--hidden)')`;
            if (await c.evaluate(modal)) {
                adb('shell', 'input', 'keyevent', '4');
                await sleep(700);
                assert(!(await c.evaluate(modal)), 'back closes the open modal');
            }
            await c.evaluate(`document.querySelector('.list__item').click(), true`);
            await sleep(500);
            assert(await c.evaluate(`!!document.querySelector('.app--details-visible')`), 'details visible');
            adb('shell', 'input', 'keyevent', '4');
            await sleep(700);
            assert(await c.evaluate(`!document.querySelector('.app--details-visible')`), 'back returns to the list');
            assert(await c.evaluate(`document.querySelectorAll('.list__item').length > 0`), 'file still open');
        }
    },
    {
        name: 'back-to-background',
        async run(c, { adb, sleep, assert, reconnect }) {
            adb('shell', 'input', 'keyevent', '4');
            await sleep(1500);
            const focus = adb('shell', 'dumpsys', 'window').split('\n').find((l) => l.includes('mCurrentFocus')) || '';
            assert(!focus.includes('keeweb'), 'app moved to the background');
            assert(adb('shell', 'pidof', appId).trim() !== '', 'app process still alive (not finished)');
            adb('shell', 'am', 'start', '-n', `${appId}/com.mickdewald.keeweb.MainActivity`);
            await sleep(1500);
            const c2 = await reconnect();
            assert(!(await c2.evaluate(`document.body.innerText.includes('Too many tabs')`)), 'no multi-tab error');
            return { connection: c2 };
        }
    }
];

const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const names = Steps.map((st) => st.name);
if (onlyIdx >= 0 && (!only || !names.includes(only))) {
    console.error(`--only needs one of: ${names.join(', ')}`);
    process.exit(2);
}

let c = null;
let current = '(setup)';
try {
    adb('shell', 'am', 'force-stop', appId);
    adb('shell', 'pm', 'clear', appId);
    adb('shell', 'am', 'start', '-W', '-n', `${appId}/com.mickdewald.keeweb.MainActivity`);
    await sleep(4000);
    c = await connect();
    for (const step of Steps) {
        if (only && step.name !== only && step.name !== 'unlock') {
            continue;
        }
        current = step.name;
        process.stdout.write(`- ${step.name}\n`);
        const reconnect = async () => {
            c.close();
            c = await connect();
            return c;
        };
        const result = await step.run(c, { adb, sleep, waitFor, assert, openFixture, reconnect });
        if (result && result.connection) {
            c = result.connection;
        }
    }
    console.log('E2E OK');
} catch (e) {
    console.error(`FAILED: ${current}: ${e.message}`);
    process.exitCode = 1;
} finally {
    try {
        c?.close();
    } catch {
        // ignore
    }
}

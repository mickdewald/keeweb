// scripts/android/e2e-emulator.mjs
// Usage: node scripts/android/e2e-emulator.mjs [--only <step>]
import fs from 'node:fs';
import { connect, adb } from './cdp.mjs';

const appId = process.env.KEEWEB_APP_ID || 'com.mickdewald.keeweb.dev';
const fixture = fs.readFileSync('test/android/fixtures/e2e-fixture.kdbx').toString('base64');
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
    throw new Error(`timeout waiting for: ${expression}`);
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
    }
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
adb('shell', 'am', 'force-stop', appId);
adb('shell', 'pm', 'clear', appId);
adb('shell', 'am', 'start', '-W', '-n', `${appId}/com.mickdewald.keeweb.MainActivity`);
await sleep(4000);
let c = await connect();
for (const step of Steps) {
    if (only && step.name !== only && step.name !== 'unlock') {
        continue;
    }
    process.stdout.write(`- ${step.name}\n`);
    const result = await step.run(c, { adb, sleep, waitFor, assert, openFixture, reconnect: async () => { c.close(); c = await connect(); return c; } });
    if (result && result.connection) {
        c = result.connection;
    }
}
c.close();
console.log('E2E OK');

// scripts/android/cdp.mjs: evaluate JavaScript in the KeeWeb debug app's WebView.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const sdk = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const serial = process.env.KEEWEB_SERIAL || `emulator-${process.env.KEEWEB_EMU_PORT || 5580}`;
const appId = process.env.KEEWEB_APP_ID || 'com.mickdewald.keeweb.dev';
const port = Number(process.env.KEEWEB_CDP_PORT || 9333);

export function adb(...args) {
    return execFileSync(`${sdk}/platform-tools/adb`, ['-s', serial, ...args], { encoding: 'utf8' });
}

export function findPageTarget(targets) {
    const page =
        Array.isArray(targets) &&
        targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!page) {
        throw new Error('No debuggable WebView page is available yet');
    }
    return page;
}

export function isMainModule(url, entry) {
    return !!entry && url === pathToFileURL(entry).href;
}

export function assertFixtureTarget(targetSerial = serial, targetAppId = appId) {
    if (!/^emulator-\d+$/.test(targetSerial)) {
        throw new Error('Fixture tests may reset only an emulator');
    }
    if (targetAppId !== 'com.mickdewald.keeweb.dev') {
        throw new Error('Fixture tests may reset only the KeeWeb debug app');
    }
}

export async function connect() {
    const pid = adb('shell', 'pidof', appId).trim();
    if (!pid) {
        throw new Error(`${appId} is not running`);
    }
    adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
    const response = await fetch(`http://localhost:${port}/json`, {
        signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) {
        throw new Error(`WebView discovery failed: HTTP ${response.status}`);
    }
    const page = findPageTarget(await response.json());
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('WebView socket connection timed out'));
        }, 5000);
        ws.addEventListener(
            'open',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
        ws.addEventListener(
            'error',
            () => {
                clearTimeout(timer);
                reject(new Error('WebView socket connection failed'));
            },
            { once: true }
        );
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });
    return {
        async evaluate(expression) {
            const msgId = ++id;
            const res = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(msgId);
                    reject(new Error('WebView evaluation timed out after 30s'));
                }, 30000);
                pending.set(msgId, (msg) => {
                    clearTimeout(timer);
                    resolve(msg);
                });
                ws.send(
                    JSON.stringify({
                        id: msgId,
                        method: 'Runtime.evaluate',
                        params: { expression, awaitPromise: true, returnByValue: true }
                    })
                );
            });
            if (res.result?.exceptionDetails) {
                throw new Error(
                    res.result.exceptionDetails.exception?.description || 'evaluate failed'
                );
            }
            return res.result?.result?.value;
        },
        close: () => ws.close()
    };
}

if (isMainModule(import.meta.url, process.argv[1])) {
    const c = await connect();
    console.log(JSON.stringify(await c.evaluate(process.argv[2]), null, 1));
    c.close();
}

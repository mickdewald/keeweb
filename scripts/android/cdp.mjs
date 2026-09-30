// scripts/android/cdp.mjs: evaluate JavaScript in the KeeWeb debug app's WebView.
import { execFileSync } from 'node:child_process';

const sdk = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const serial = process.env.KEEWEB_SERIAL || 'emulator-5580';
const appId = process.env.KEEWEB_APP_ID || 'com.mickdewald.keeweb.dev';
const port = Number(process.env.KEEWEB_CDP_PORT || 9333);

export function adb(...args) {
    return execFileSync(`${sdk}/platform-tools/adb`, ['-s', serial, ...args], { encoding: 'utf8' });
}

export async function connect() {
    const pid = adb('shell', 'pidof', appId).trim();
    if (!pid) {
        throw new Error(`${appId} is not running`);
    }
    adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
    const targets = await (await fetch(`http://localhost:${port}/json`)).json();
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
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
                    reject(new Error(`evaluate timed out after 30s: ${String(expression).slice(0, 80)}`));
                }, 30000);
                pending.set(msgId, (msg) => {
                    clearTimeout(timer);
                    resolve(msg);
                });
                ws.send(JSON.stringify({ id: msgId, method: 'Runtime.evaluate',
                    params: { expression, awaitPromise: true, returnByValue: true } }));
            });
            if (res.result?.exceptionDetails) {
                throw new Error(res.result.exceptionDetails.exception?.description || 'evaluate failed');
            }
            return res.result?.result?.value;
        },
        close: () => ws.close()
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const c = await connect();
    console.log(JSON.stringify(await c.evaluate(process.argv[2]), null, 1));
    c.close();
}

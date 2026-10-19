# KeeWeb for Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the KeeWeb fork as an Android app (Capacitor shell) that opens the maintainer's Google Drive `.kdbx` through the Android document picker, unlocks with biometrics, copies with one tap, and never needs a restart.

**Architecture:** The existing Grunt web build is hosted by a Capacitor Android project in `android/`. On Android, `Launcher` stays undefined (browser semantics); Android capabilities are reached only through `comp/platform/android/*`, which wraps three local Capacitor plugins (`BiometricCrypto`, `SecureClipboard`, `DocumentFile`) plus the official `@capacitor/app` plugin. Existing contracts are reused: `NativeModules.hardwareEncrypt/hardwareDecrypt` for biometrics, `CopyPaste.simpleCopy` for the clipboard, and the storage `load/stat/save` + `revConflict` interface for file sync.

**Tech Stack:** KeeWeb JavaScript (Backbone-style views, webpack, Grunt), Mocha/Chai browser tests, Capacitor (Android), Java 17+ Android plugins, AndroidX Biometric, Android Keystore, Storage Access Framework, Node scripts driving the WebView through the Chrome DevTools Protocol.

**Spec:** `docs/superpowers/specs/2026-09-30-android-app-design.md`

## Global Constraints

- Application ID `com.mickdewald.keeweb`; debug builds use `applicationIdSuffix ".dev"` so both can be installed side by side.
- `minSdkVersion 30` (Android 11, needed for `setUserAuthenticationParameters`); `targetSdkVersion` = the Capacitor default of the pinned version.
- Pin exact Capacitor versions (no `^`/`~`), all from the same major line.
- On Android `Launcher` must stay `undefined`. Only `app/scripts/comp/platform/android/android-platform.js` may touch `window.Capacitor`.
- No passwords, tokens, keystore passwords or databases in the APK, in `capacitor.config.json`, or in git. The only committed database is the E2E fixture with fake entries and the documented fake password `e2e-fake-password`.
- Every tracked handwritten `.js` file stays at or below 500 lines (`python3 scripts/check-file-sizes.py`). New behaviour goes into new files; existing files get small hooks only.
- The macOS app keeps its behaviour. `npm test` and `npx grunt eslint` stay green after every task.
- No Gradle, emulator or `npm ci` work on the self-hosted CI runners of this Mac; run heavy local work with `nice -n 10` and `./gradlew --stop` afterwards.
- Emulator work runs headless (`-no-window`) on a dedicated AVD, never stealing the maintainer's focus. Use `-gpu host -feature -Vulkan`.
- In a fresh worktree install with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` (Electron is not needed for Android work).
- Never use the maintainer's real database or Google account in automated tests.
- Do not push, open PRs, merge, or delete the worktree without the maintainer's explicit instruction.

## Review Focus

1. **Stale or delayed file from the Drive app** (phone opens while the Drive app still serves an older copy): the app must never overwrite newer remote content; a hash mismatch at save time must end in merge, not loss. Test: Task 8 Step 1 (`save` with changed remote hash returns `revConflict` and writes nothing).
2. **Biometric key invalidated after a new fingerprint** (Keepass2Android's failure mode for the maintainer): must end in a one-line explanation plus the focused password field, then silent re-enrolment. Test: Task 7 Step 1 (`KEY_INVALIDATED` → `touchIdRecoveryRequired`).
3. **Back button while a file is open**: must never finish the activity. Test: Task 4 Step 1 (every state with an open file maps to a non-destructive action; the fallback is `background`, which calls `moveTaskToBack`, never `exitApp`).
4. **Clipboard cleared while the user already copied something else**: clearing must only remove our own value. Test: Task 5 Step 5 (instrumented test: copy A, copy B from elsewhere, timer fires, B stays).
5. **Password longer than a single RSA block** (long passphrases): quick unlock must still work. Test: Task 7 Step 7 (instrumented round trip with a 1,000-character password through the hybrid RSA/AES scheme).

---

## File Map

Create:
- `app/scripts/comp/platform/android/android-platform.js`: Capacitor detection and plugin access (only module touching `window.Capacitor`).
- `app/scripts/comp/platform/android/android-defaults.js`: one-time Android setting defaults.
- `app/scripts/comp/platform/android/android-init.js`: starts all Android behaviours.
- `app/scripts/comp/platform/android/android-back-navigation.js`: back-button state machine and actions.
- `app/scripts/comp/platform/android/android-lifecycle.js`: pause/resume → lock, auto-prompt, sync.
- `app/scripts/comp/platform/android/android-clipboard.js`: `SecureClipboard` wrapper.
- `app/scripts/comp/platform/android/android-native-modules.js`: `hardwareEncrypt/Decrypt/DeleteKey` over `BiometricCrypto`.
- `app/scripts/comp/platform/android/touch-field-actions.js`: pure tap/long-press decision for field values.
- `app/scripts/storage/impl/storage-android-document.js`: storage backed by `DocumentFile`.
- `android/` (generated by Capacitor, then edited): `MainActivity.java`, `BiometricCryptoPlugin.java`, `SecureClipboardPlugin.java`, `DocumentFilePlugin.java`, instrumented tests.
- `capacitor.config.json`
- `scripts/android/prepare-web.js`, `scripts/android/emulator.sh`, `scripts/android/cdp.mjs`, `scripts/android/e2e-emulator.mjs`, `scripts/android/make-e2e-fixture.mjs`, `scripts/android/build-release.sh`, `scripts/android/check-apk-secrets.sh`
- `test/android/fixtures/e2e-fixture.kdbx`, `test/android/fixtures/README.md`
- `test/src/comp/platform/*.js`, `test/src/storage/storage-android-document.js`
- `docs/android.md`

Modify (small hooks only):
- `app/scripts/app.js`, `app/scripts/comp/app/single-instance-checker.js`, `app/scripts/comp/app/updater.js`
- `app/scripts/comp/browser/copy-paste.js`, `app/scripts/views/fields/field-view.js`
- `app/scripts/comp/launcher/native-modules.js`, `app/scripts/comp/app/touch-id-recovery.js`, `app/scripts/views/open-view-operations.js`, `app/scripts/views/open-view-file-input.js`, `app/scripts/views/settings/settings-general-view.js`
- `app/scripts/storage/index.js`, `app/scripts/locales/base.json`, `app/scripts/locales/de-DE.json`
- `app/styles/areas/_details.scss`, `app/styles/areas/_open.scss`
- `package.json`, `package-lock.json`, `.gitignore`, `AGENTS.md`

---

### Task 1: Android platform detection and browser-only services

**Files:**
- Create: `app/scripts/comp/platform/android/android-platform.js`
- Create: `app/scripts/comp/platform/android/android-defaults.js`
- Create: `app/scripts/comp/platform/android/android-init.js`
- Modify: `app/scripts/comp/app/single-instance-checker.js:9-15`
- Modify: `app/scripts/comp/app/updater.js:41-44`
- Modify: `app/scripts/app.js` (`showView`)
- Test: `test/src/comp/platform/android-platform.js`

**Interfaces:**
- Produces: `AndroidPlatform { isAndroid: boolean, plugin(name: string): object }`, `createAndroidPlatform(win)`, `AndroidDefaults.apply(settings, runtimeData): boolean`, `AndroidInit.start(appModel)`, `SingleInstanceChecker.init(platform = AndroidPlatform)`.

- [ ] **Step 1: Write the failing tests**

```js
// test/src/comp/platform/android-platform.js
import { expect } from 'chai';
import { createAndroidPlatform } from 'comp/platform/android/android-platform';
import { AndroidDefaults } from 'comp/platform/android/android-defaults';
import { SingleInstanceChecker } from 'comp/app/single-instance-checker';

describe('AndroidPlatform', () => {
    it('is not Android in a plain browser window', () => {
        expect(createAndroidPlatform({}).isAndroid).to.equal(false);
    });

    it('is not Android on a non-Android Capacitor platform', () => {
        const win = { Capacitor: { getPlatform: () => 'web' } };
        expect(createAndroidPlatform(win).isAndroid).to.equal(false);
    });

    it('detects Capacitor Android and registers each plugin once', () => {
        const registered = [];
        const win = {
            Capacitor: {
                getPlatform: () => 'android',
                registerPlugin: (name) => {
                    registered.push(name);
                    return { name };
                }
            }
        };
        const platform = createAndroidPlatform(win);
        expect(platform.isAndroid).to.equal(true);
        expect(platform.plugin('App')).to.eql({ name: 'App' });
        platform.plugin('App');
        expect(registered).to.eql(['App']);
    });

    it('refuses plugin access outside Android', () => {
        expect(() => createAndroidPlatform({}).plugin('App')).to.throw('outside Android');
    });
});

describe('AndroidDefaults', () => {
    it('applies the Android defaults exactly once', () => {
        const values = { deviceOwnerAuth: null, clipboardSeconds: 0 };
        const settings = { set: (v) => Object.assign(values, v) };
        const runtimeData = {};
        expect(AndroidDefaults.apply(settings, runtimeData)).to.equal(true);
        expect(values).to.eql({ deviceOwnerAuth: 'file', clipboardSeconds: 30 });

        values.deviceOwnerAuth = null; // the user switched biometrics off later
        expect(AndroidDefaults.apply(settings, runtimeData)).to.equal(false);
        expect(values.deviceOwnerAuth).to.equal(null);
    });
});

describe('SingleInstanceChecker on Android', () => {
    it('does not arm the multi-tab guard', () => {
        const original = SingleInstanceChecker.setKey;
        let armed = false;
        SingleInstanceChecker.setKey = () => {
            armed = true;
        };
        try {
            SingleInstanceChecker.init({ isAndroid: true });
        } finally {
            SingleInstanceChecker.setKey = original;
        }
        expect(armed).to.equal(false);
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx cross-env NODE_OPTIONS=--openssl-legacy-provider grunt test 2>&1 | tail -40`
Expected: FAIL. Webpack cannot resolve `comp/platform/android/android-platform`.

- [ ] **Step 3: Implement the platform module, defaults and init**

```js
// app/scripts/comp/platform/android/android-platform.js
function createAndroidPlatform(win) {
    const capacitor = win && win.Capacitor;
    const isAndroid = !!(
        capacitor &&
        typeof capacitor.getPlatform === 'function' &&
        capacitor.getPlatform() === 'android'
    );
    const plugins = {};
    return {
        isAndroid,
        plugin(name) {
            if (!isAndroid) {
                throw new Error(`Android plugin ${name} requested outside Android`);
            }
            if (!plugins[name]) {
                plugins[name] = capacitor.registerPlugin(name);
            }
            return plugins[name];
        }
    };
}

const AndroidPlatform = createAndroidPlatform(window);

export { AndroidPlatform, createAndroidPlatform };
```

```js
// app/scripts/comp/platform/android/android-defaults.js
import { AppSettingsModel } from 'models/app-settings-model';
import { RuntimeDataModel } from 'models/runtime-data-model';

const AndroidDefaults = {
    values: { deviceOwnerAuth: 'file', clipboardSeconds: 30 },

    apply(settings = AppSettingsModel, runtimeData = RuntimeDataModel) {
        if (runtimeData.androidDefaultsApplied) {
            return false;
        }
        settings.set({ ...this.values });
        runtimeData.androidDefaultsApplied = true;
        return true;
    }
};

export { AndroidDefaults };
```

```js
// app/scripts/comp/platform/android/android-init.js
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { AndroidDefaults } from 'comp/platform/android/android-defaults';

const AndroidInit = {
    started: false,

    start(appModel) {
        if (!AndroidPlatform.isAndroid || this.started) {
            return;
        }
        this.started = true;
        this.appModel = appModel;
        AndroidDefaults.apply();
    }
};

export { AndroidInit };
```

- [ ] **Step 4: Hook the gates**

In `app/scripts/comp/app/single-instance-checker.js`, import the platform and change `init`:

```js
import { AndroidPlatform } from 'comp/platform/android/android-platform';
// ...
    init(platform = AndroidPlatform) {
        if (Launcher || platform.isAndroid) {
            return;
        }
        window.addEventListener('storage', SingleInstanceChecker.storageChanged);
        SingleInstanceChecker.setKey(LocalStorageKeyName, instanceKey);
    },
```

In `app/scripts/comp/app/updater.js`, import `AndroidPlatform` and extend the service-worker condition:

```js
        if (
            !Launcher &&
            !AndroidPlatform.isAndroid &&
            navigator.serviceWorker &&
            !RuntimeInfo.beta &&
            !RuntimeInfo.devMode
        ) {
```

In `app/scripts/app.js`, import `AndroidInit` and call it first in `showView()`:

```js
import { AndroidInit } from 'comp/platform/android/android-init';
// ...
    function showView() {
        AndroidInit.start(appModel);
        new AppView(appModel).render();
```

- [ ] **Step 5: Run the tests, lint and size check**

Run: `npx cross-env NODE_OPTIONS=--openssl-legacy-provider grunt test 2>&1 | tail -20 && npx grunt eslint && python3 scripts/check-file-sizes.py`
Expected: all tests pass (including the four new `describe` blocks), no lint errors, size check passes.

- [ ] **Step 6: Commit**

```bash
git add app/scripts/comp/platform test/src/comp/platform app/scripts/comp/app/single-instance-checker.js app/scripts/comp/app/updater.js app/scripts/app.js
git commit -m "feat(android): detect Capacitor Android and skip browser-only services"
```

---

### Task 2: Capacitor Android shell

**Files:**
- Modify: `package.json`, `package-lock.json`, `.gitignore`
- Create: `capacitor.config.json`, `scripts/android/prepare-web.js`, `scripts/android/emulator.sh`, `scripts/android/cdp.mjs`
- Create (generated, then edited): `android/**`, notably `android/app/src/main/java/com/mickdewald/keeweb/MainActivity.java`, `android/app/build.gradle`, `android/variables.gradle`

**Interfaces:**
- Produces: `npm run android:web` (builds `tmp/android-www`), `npm run android:debug` (debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`), `scripts/android/emulator.sh start|stop|serial`, `scripts/android/cdp.mjs` exporting `evaluate(expression)` against the app's WebView.

- [ ] **Step 1: Check the toolchain**

Run: `/usr/libexec/java_home -V 2>&1; node -v; npm view @capacitor/core version; npm view @capacitor/core@latest engines`
Expected: the latest Capacitor version prints. If that major version needs a JDK that is not installed (Capacitor 7 needs JDK 21), **stop and report** the missing JDK instead of installing one.

- [ ] **Step 2: Install Capacitor with exact versions**

```bash
V=$(npm view @capacitor/core version)
AV=$(npm view @capacitor/app version)
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --save-exact --save-dev \
  @capacitor/cli@$V @capacitor/core@$V @capacitor/android@$V @capacitor/app@$AV
```

Then check that `package.json` lists all four without `^`/`~`, and that `@capacitor/app`'s peer dependency matches the major of `@capacitor/core` (`npm ls @capacitor/core`, no `invalid`).

- [ ] **Step 3: Add the web preparation script and npm scripts**

```js
// scripts/android/prepare-web.js
// Copies the Grunt web build into tmp/android-www for Capacitor.
// The service worker and web update manifests are left out: APK installs update the app.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'dist');
const dest = path.join(root, 'tmp', 'android-www');
const Excluded = new Set(['service-worker.js', 'update.json', 'oauth-result']);

if (!fs.existsSync(path.join(src, 'index.html'))) {
    console.error('dist/index.html missing: run the web build first');
    process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
    if (!Excluded.has(name)) {
        fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
    }
}
console.log('Prepared', path.relative(root, dest));
```

Add to `package.json` `scripts`:

```json
"android:web": "cross-env NODE_OPTIONS=--openssl-legacy-provider grunt build-web-app && node scripts/android/prepare-web.js",
"android:debug": "npm run android:web && cap sync android && cd android && nice -n 10 ./gradlew assembleDebug && ./gradlew --stop",
"build:android": "bash scripts/android/build-release.sh"
```

Add `tmp/android-www/` to `.gitignore` if `tmp/` is not already ignored (`git check-ignore tmp/android-www` prints the path when it is).

- [ ] **Step 4: Create the Capacitor config and the Android project**

```json
{
    "appId": "com.mickdewald.keeweb",
    "appName": "KeeWeb",
    "webDir": "tmp/android-www",
    "android": {
        "allowMixedContent": false,
        "captureInput": false
    }
}
```

Run: `npm run android:web && npx cap add android`
Expected: an `android/` directory with a Gradle project.

In `android/variables.gradle` set `minSdkVersion = 30`. In `android/app/build.gradle` add inside `buildTypes`:

```gradle
        debug {
            applicationIdSuffix ".dev"
        }
```

- [ ] **Step 5: Harden `MainActivity`**

Replace `android/app/src/main/java/com/mickdewald/keeweb/MainActivity.java`:

```java
package com.mickdewald.keeweb;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // No screenshots and a blank recent-apps thumbnail.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
    }
}
```

Capacitor already opens every navigation outside the app origin in the system browser and enables WebView remote debugging only for debuggable builds. Leave both defaults in place.

- [ ] **Step 6: Add the emulator and CDP helpers**

```bash
#!/usr/bin/env bash
# scripts/android/emulator.sh: dedicated headless emulator for KeeWeb Android work.
set -euo pipefail
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
AVD="${KEEWEB_AVD:-KeeWebSpike}"
PORT="${KEEWEB_EMU_PORT:-5580}"
SERIAL="emulator-$PORT"
ADB="$SDK/platform-tools/adb"

case "${1:-}" in
    start)
        if ! "$SDK/emulator/emulator" -list-avds | grep -qx "$AVD"; then
            echo "AVD $AVD missing; create it with avdmanager (system-images;android-34;google_apis_playstore;arm64-v8a)" >&2
            exit 1
        fi
        nohup nice -n 10 "$SDK/emulator/emulator" -avd "$AVD" -port "$PORT" -no-window -no-audio \
            -no-boot-anim -gpu host -feature -Vulkan -memory 4096 -no-snapshot >/tmp/keeweb-emulator.log 2>&1 &
        for _ in $(seq 1 90); do
            [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && exit 0
            sleep 2
        done
        echo "emulator did not boot, see /tmp/keeweb-emulator.log" >&2
        exit 1
        ;;
    stop) "$ADB" -s "$SERIAL" emu kill ;;
    serial) echo "$SERIAL" ;;
    *) echo "usage: $0 start|stop|serial" >&2; exit 2 ;;
esac
```

```js
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
            const res = await new Promise((resolve) => {
                pending.set(msgId, resolve);
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
```

`chmod +x scripts/android/emulator.sh`.

- [ ] **Step 7: Build, install and smoke-test on the emulator**

```bash
npm run android:debug
scripts/android/emulator.sh start
A="$HOME/Library/Android/sdk/platform-tools/adb -s emulator-5580"
$A install -r android/app/build/outputs/apk/debug/app-debug.apk
$A shell am start -W -n com.mickdewald.keeweb.dev/com.mickdewald.keeweb.MainActivity
sleep 5
node scripts/android/cdp.mjs "({ android: !!(window.Capacitor && Capacitor.getPlatform() === 'android'), openView: !!document.querySelector('.open'), sw: navigator.serviceWorker ? 'present' : 'none' })"
```

(Use `eval "$A …"` or a small wrapper script, since zsh does not word-split `$A`.)

Expected: `{"android": true, "openView": true, ...}`. Then check `$A logcat -d | grep -i "Content Security Policy"`.
**Stop condition:** if the CSP of `dist/index.html` blocks the script Capacitor injects (a CSP violation mentioning an inline script, and `window.Capacitor` undefined), stop and report the exact console message. Do not add `'unsafe-inline'`.

Also take `$A exec-out screencap -p > /tmp/keeweb-shell.png` and check that the open screen is not covered by the status bar or the gesture bar. If it is, add `"adjustMarginsForEdgeToEdge": "force"` under `android` in `capacitor.config.json` when the pinned Capacitor version documents that option (`grep -r adjustMarginsForEdgeToEdge node_modules/@capacitor/cli/dist`). Rebuild and check again. **Stop condition:** if the option does not exist, report it and leave the inset handling to Task 6.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore capacitor.config.json android scripts/android
git commit -m "feat(android): add the Capacitor Android shell"
```

---

### Task 3: E2E fixture and emulator smoke flow

**Files:**
- Create: `scripts/android/make-e2e-fixture.mjs`, `test/android/fixtures/e2e-fixture.kdbx`, `test/android/fixtures/README.md`, `scripts/android/e2e-emulator.mjs`

**Interfaces:**
- Consumes: `connect()` and `adb()` from `scripts/android/cdp.mjs`.
- Produces: `node scripts/android/e2e-emulator.mjs [--only <step>]`, which exits non-zero on the first failed assertion. Later tasks append named steps to its `Steps` array.

- [ ] **Step 1: Generate the fixture (fake data only)**

```js
// scripts/android/make-e2e-fixture.mjs
// Usage: npm install --no-save hash-wasm@4 && node scripts/android/make-e2e-fixture.mjs
import fs from 'node:fs';
import * as kdbxweb from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';

kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
    const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
    const out = await fn({ password: new Uint8Array(password), salt: new Uint8Array(salt),
        memorySize: memory, iterations, hashLength: length, parallelism, outputType: 'binary' });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
});

const db = kdbxweb.Kdbx.create(
    new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString('e2e-fake-password')), 'E2E Fixture');
db.setVersion(4);
db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
db.header.kdfParameters.set('M', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(16 * 1024 * 1024));
db.header.kdfParameters.set('I', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(2));
const group = db.createGroup(db.getDefaultGroup(), 'Fixture');
for (let i = 1; i <= 40; i++) {
    const e = db.createEntry(group);
    e.fields.set('Title', `a-rather-long-example-site-name.test #${i}`);
    e.fields.set('UserName', `user${i}@example.test`);
    e.fields.set('Password', kdbxweb.ProtectedValue.fromString(`fake-password-${i}`));
    e.fields.set('URL', `https://example.test/${i}`);
}
fs.mkdirSync('test/android/fixtures', { recursive: true });
fs.writeFileSync('test/android/fixtures/e2e-fixture.kdbx', Buffer.from(await db.save()));
console.log('wrote test/android/fixtures/e2e-fixture.kdbx');
```

```markdown
<!-- test/android/fixtures/README.md -->
# Android E2E fixture

`e2e-fixture.kdbx` holds 40 fake entries. Its password is `e2e-fake-password`,
which is not a secret. Regenerate with `scripts/android/make-e2e-fixture.mjs`.
Never replace it with a real database.
```

Run: `npm install --no-save hash-wasm@4 && node scripts/android/make-e2e-fixture.mjs`
Expected: `wrote test/android/fixtures/e2e-fixture.kdbx`.

- [ ] **Step 2: Write the E2E runner with the open-and-unlock step**

```js
// scripts/android/e2e-emulator.mjs
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
```

- [ ] **Step 3: Verify the selectors, then run**

Run: `grep -n "open__file-ctrl\|open__pass-enter-btn" app/templates/open.hbs`
Expected: both classes exist. If a class name differs, use the one from the template in the runner.

Run: `node scripts/android/e2e-emulator.mjs`
Expected: `- unlock`, a timing line, `E2E OK`.

- [ ] **Step 4: Commit**

```bash
git add scripts/android/make-e2e-fixture.mjs scripts/android/e2e-emulator.mjs test/android/fixtures
git commit -m "test(android): add the emulator E2E runner and a fake fixture"
```

---

### Task 4: Back button and app lifecycle

**Files:**
- Create: `app/scripts/comp/platform/android/android-back-navigation.js`
- Create: `app/scripts/comp/platform/android/android-lifecycle.js`
- Modify: `app/scripts/comp/platform/android/android-init.js`
- Modify: `app/scripts/views/open-view-file-input.js` (listen for `android-resumed`)
- Test: `test/src/comp/platform/android-back-navigation.js`
- Modify: `scripts/android/e2e-emulator.mjs` (steps `back-from-details`, `back-to-background`)

**Interfaces:**
- Consumes: `AndroidPlatform.plugin('App')` → `{ addListener(event, cb), minimizeApp() }` (`@capacitor/app`).
- Produces: `BackAction` constants, `decideBackAction(state)`, `readBackState(doc)`, `performBackAction(action, deps)`, `AndroidLifecycle.start(appModel, app)`, the event `Events.emit('android-resumed')`.

- [ ] **Step 1: Write the failing tests**

```js
// test/src/comp/platform/android-back-navigation.js
import { expect } from 'chai';
import {
    BackAction,
    decideBackAction,
    readBackState,
    performBackAction
} from 'comp/platform/android/android-back-navigation';

const none = {
    modalOpen: false,
    dropdownOpen: false,
    fieldActionsOpen: false,
    detailsVisible: false,
    searchActive: false
};

describe('Android back navigation', () => {
    it('closes overlays before navigating', () => {
        expect(decideBackAction({ ...none, modalOpen: true, detailsVisible: true })).to.equal(BackAction.CloseModal);
        expect(decideBackAction({ ...none, dropdownOpen: true })).to.equal(BackAction.CloseDropdown);
        expect(decideBackAction({ ...none, fieldActionsOpen: true, detailsVisible: true })).to.equal(BackAction.CloseFieldActions);
    });

    it('goes from details to the list, then clears search', () => {
        expect(decideBackAction({ ...none, detailsVisible: true, searchActive: true })).to.equal(BackAction.ShowList);
        expect(decideBackAction({ ...none, searchActive: true })).to.equal(BackAction.ClearSearch);
    });

    it('never finishes the app: the fallback is moving to the background', () => {
        expect(decideBackAction(none)).to.equal(BackAction.Background);
        expect(Object.values(BackAction)).to.not.include('exit');
    });

    it('reads the state from the DOM', () => {
        const root = document.createElement('div');
        root.innerHTML = `<div class="app app--details-visible"><div class="details__field-mobile-actions"></div>
            <input class="list__search-field" value="abc"></div>`;
        document.body.appendChild(root);
        try {
            expect(readBackState(root)).to.eql({
                ...none,
                fieldActionsOpen: true,
                detailsVisible: true,
                searchActive: true
            });
        } finally {
            root.remove();
        }
    });

    it('moves the task to the background for the fallback action', () => {
        const calls = [];
        performBackAction(BackAction.Background, { app: { minimizeApp: () => calls.push('minimize') } });
        expect(calls).to.eql(['minimize']);
    });

    it('emits toggle-details(false) to return to the list', () => {
        const emitted = [];
        performBackAction(BackAction.ShowList, { events: { emit: (...a) => emitted.push(a) } });
        expect(emitted).to.eql([['toggle-details', false]]);
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx cross-env NODE_OPTIONS=--openssl-legacy-provider grunt test 2>&1 | tail -30`
Expected: FAIL. The module cannot be resolved.

- [ ] **Step 3: Implement the back navigation**

```js
// app/scripts/comp/platform/android/android-back-navigation.js
import { Events } from 'framework/events';
import { Keys } from 'const/keys';

const BackAction = {
    CloseModal: 'close-modal',
    CloseDropdown: 'close-dropdown',
    CloseFieldActions: 'close-field-actions',
    ShowList: 'show-list',
    ClearSearch: 'clear-search',
    Background: 'background'
};

function decideBackAction(state) {
    if (state.modalOpen) {
        return BackAction.CloseModal;
    }
    if (state.dropdownOpen) {
        return BackAction.CloseDropdown;
    }
    if (state.fieldActionsOpen) {
        return BackAction.CloseFieldActions;
    }
    if (state.detailsVisible) {
        return BackAction.ShowList;
    }
    if (state.searchActive) {
        return BackAction.ClearSearch;
    }
    return BackAction.Background;
}

function readBackState(root = document) {
    const search = root.querySelector('.list__search-field');
    return {
        modalOpen: !!root.querySelector('.modal:not(.modal--hidden)'),
        dropdownOpen: !!root.querySelector('.dropdown'),
        fieldActionsOpen: !!root.querySelector('.details__field-mobile-actions'),
        detailsVisible: !!root.querySelector('.app.app--details-visible'),
        searchActive: !!(search && search.value)
    };
}

function pressEscape() {
    $(document).trigger($.Event('keydown', { keyCode: Keys.DOM_VK_ESCAPE, which: Keys.DOM_VK_ESCAPE }));
}

function performBackAction(action, { app, events = Events, root = document } = {}) {
    switch (action) {
        case BackAction.CloseModal:
        case BackAction.CloseDropdown:
            pressEscape();
            break;
        case BackAction.CloseFieldActions:
            events.emit('click', { target: root.body || document.body });
            break;
        case BackAction.ShowList:
            events.emit('toggle-details', false);
            break;
        case BackAction.ClearSearch: {
            const input = root.querySelector('.list__search-field');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.blur();
            break;
        }
        case BackAction.Background:
            app.minimizeApp();
            break;
    }
}

export { BackAction, decideBackAction, readBackState, performBackAction };
```

Run: `grep -n "DOM_VK_ESCAPE" app/scripts/const/keys.js`. Expected: the constant exists (it is used by `modal-view.js`).

- [ ] **Step 4: Implement the lifecycle and wire it up**

```js
// app/scripts/comp/platform/android/android-lifecycle.js
import { Events } from 'framework/events';
import { decideBackAction, readBackState, performBackAction } from 'comp/platform/android/android-back-navigation';

const AndroidLifecycle = {
    start(appModel, app) {
        app.addListener('backButton', () => {
            performBackAction(decideBackAction(readBackState()), { app });
        });
        app.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                Events.emit('android-resumed');
            } else {
                // Maps "app went to the background" onto the existing lockOnMinimize setting.
                Events.emit('app-minimized');
            }
        });
    }
};

export { AndroidLifecycle };
```

In `android-init.js`, after `AndroidDefaults.apply();`:

```js
        AndroidLifecycle.start(appModel, AndroidPlatform.plugin('App'));
```

(with `import { AndroidLifecycle } from 'comp/platform/android/android-lifecycle';`).

In `open-view-file-input.js`, the auto-prompt runs once per `autoUnlockAttemptedRef`. Allow it again on every resume: in `OpenView`'s constructor/initializer (`open-view.js`, next to `this.listenTo(Events, 'user-idle', this.userIdle);`) add

```js
        this.listenTo(Events, 'android-resumed', this.androidResumed);
```

and in `open-view-file-input.js` add the method

```js
        androidResumed() {
            this.autoUnlockAttemptedRef = null;
            this.displayOpenDeviceOwnerAuth();
        },
```

Run `wc -l app/scripts/views/open-view.js app/scripts/views/open-view-file-input.js`. Both must stay ≤ 500 lines.

- [ ] **Step 5: Run the unit tests**

Run: `npx cross-env NODE_OPTIONS=--openssl-legacy-provider grunt test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Add E2E steps and run them on the emulator**

Append to `Steps` in `scripts/android/e2e-emulator.mjs`:

```js
    {
        name: 'back-from-details',
        async run(c, { adb, sleep, assert }) {
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
            adb('shell', 'am', 'start', '-n', 'com.mickdewald.keeweb.dev/com.mickdewald.keeweb.MainActivity');
            await sleep(1500);
            const c2 = await reconnect();
            assert(!(await c2.evaluate(`document.body.innerText.includes('Too many tabs')`)), 'no multi-tab error');
            return { connection: c2 };
        }
    }
```

Rebuild and run: `npm run android:debug && eval "$HOME/Library/Android/sdk/platform-tools/adb -s emulator-5580 install -r android/app/build/outputs/apk/debug/app-debug.apk" && node scripts/android/e2e-emulator.mjs`
Expected: `E2E OK`.

- [ ] **Step 7: Commit**

```bash
git add app/scripts/comp/platform app/scripts/views/open-view.js app/scripts/views/open-view-file-input.js test/src/comp/platform scripts/android/e2e-emulator.mjs
git commit -m "feat(android): handle the back button and app lifecycle"
```

---

### Task 5: Sensitive clipboard with native clearing

**Files:**
- Create: `android/app/src/main/java/com/mickdewald/keeweb/SecureClipboardPlugin.java`
- Create: `android/app/src/androidTest/java/com/mickdewald/keeweb/SecureClipboardTest.java`
- Create: `app/scripts/comp/platform/android/android-clipboard.js`
- Modify: `android/app/src/main/java/com/mickdewald/keeweb/MainActivity.java` (register the plugin)
- Modify: `app/scripts/comp/browser/copy-paste.js`
- Test: `test/src/comp/platform/android-clipboard.js`

**Interfaces:**
- Produces (native): plugin `SecureClipboard` with `copy({ text: string, clearAfterSeconds: number }) → {}`.
- Produces (JS): `AndroidClipboard.copy(text, seconds, plugin?) → { success: true, seconds }`. `CopyPaste.simpleCopy` is `true` on Android.

- [ ] **Step 1: Write the failing JS test**

```js
// test/src/comp/platform/android-clipboard.js
import { expect } from 'chai';
import { AndroidClipboard } from 'comp/platform/android/android-clipboard';

describe('AndroidClipboard', () => {
    it('passes the text and the clear timeout to the native plugin', () => {
        const calls = [];
        const plugin = { copy: (arg) => { calls.push(arg); return Promise.resolve(); } };
        const res = AndroidClipboard.copy('secret-value', 30, plugin);
        expect(res).to.eql({ success: true, seconds: 30 });
        expect(calls).to.eql([{ text: 'secret-value', clearAfterSeconds: 30 }]);
    });

    it('sends 0 when clearing is disabled', () => {
        const calls = [];
        AndroidClipboard.copy('x', 0, { copy: (arg) => { calls.push(arg); return Promise.resolve(); } });
        expect(calls[0].clearAfterSeconds).to.equal(0);
    });
});
```

Run the tests. Expected: FAIL with an unresolved module.

- [ ] **Step 2: Implement the JS wrapper and hook `CopyPaste`**

```js
// app/scripts/comp/platform/android/android-clipboard.js
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Logger } from 'util/logger';

const logger = new Logger('android-clipboard');

const AndroidClipboard = {
    copy(text, seconds, plugin = AndroidPlatform.plugin('SecureClipboard')) {
        plugin
            .copy({ text, clearAfterSeconds: seconds > 0 ? seconds : 0 })
            .catch((e) => logger.error('Native copy failed', e));
        return { success: true, seconds };
    }
};

export { AndroidClipboard };
```

In `copy-paste.js`:

```js
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { AndroidClipboard } from 'comp/platform/android/android-clipboard';
// ...
const CopyPaste = {
    simpleCopy: !!(Launcher && Launcher.clipboardSupported) || AndroidPlatform.isAndroid,

    copy(text) {
        if (AndroidPlatform.isAndroid) {
            return AndroidClipboard.copy(text, AppSettingsModel.clipboardSeconds);
        }
        if (this.simpleCopy) {
```

(The rest of `copy` stays unchanged.)

Run the tests. Expected: PASS.

- [ ] **Step 3: Implement the native plugin**

```java
package com.mickdewald.keeweb;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureClipboard")
public class SecureClipboardPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void copy(PluginCall call) {
        String text = call.getString("text");
        int clearAfterSeconds = call.getInt("clearAfterSeconds", 0);
        if (text == null) {
            call.reject("text is required");
            return;
        }
        copySensitive(getContext(), text);
        if (clearAfterSeconds > 0) {
            handler.postDelayed(() -> clearIfUnchanged(getContext(), text), clearAfterSeconds * 1000L);
        }
        call.resolve(new JSObject());
    }

    static void copySensitive(Context context, String text) {
        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText("KeeWeb", text);
        if (Build.VERSION.SDK_INT >= 33) {
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
        }
        cm.setPrimaryClip(clip);
    }

    /** Clears the clipboard only when it still holds the value this app put there. */
    static void clearIfUnchanged(Context context, String text) {
        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData current = cm.getPrimaryClip();
        if (current == null || current.getItemCount() == 0) {
            return;
        }
        CharSequence value = current.getItemAt(0).getText();
        if (value != null && value.toString().equals(text)) {
            cm.clearPrimaryClip();
        }
    }
}
```

Register it in `MainActivity.onCreate` **before** `super.onCreate(savedInstanceState);`:

```java
        registerPlugin(SecureClipboardPlugin.class);
```

- [ ] **Step 4: Write the instrumented test**

```java
package com.mickdewald.keeweb;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SecureClipboardTest {
    private Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    private ClipboardManager cm() {
        return (ClipboardManager) context().getSystemService(Context.CLIPBOARD_SERVICE);
    }

    private void onMain(Runnable r) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(r);
    }

    @Test
    public void marksTheClipSensitive() {
        onMain(() -> SecureClipboardPlugin.copySensitive(context(), "fake-secret"));
        ClipDescription d = cm().getPrimaryClipDescription();
        assertTrue(d.getExtras().getBoolean(ClipDescription.EXTRA_IS_SENSITIVE));
    }

    @Test
    public void clearsItsOwnValue() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            SecureClipboardPlugin.clearIfUnchanged(context(), "fake-secret");
        });
        ClipData clip = cm().getPrimaryClip();
        assertTrue(clip == null || clip.getItemCount() == 0 || clip.getItemAt(0).getText() == null
                || clip.getItemAt(0).getText().length() == 0);
    }

    @Test
    public void keepsAValueCopiedElsewhere() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            cm().setPrimaryClip(ClipData.newPlainText("other", "copied-elsewhere"));
            SecureClipboardPlugin.clearIfUnchanged(context(), "fake-secret");
        });
        assertEquals("copied-elsewhere", cm().getPrimaryClip().getItemAt(0).getText().toString());
    }
}
```

Instrumented tests run in the foreground app process, so clipboard reads are allowed there. If `clearsItsOwnValue` fails because `clearPrimaryClip` leaves an empty clip on this API level, the assertion above already accepts an empty clip. Do not weaken it any further.

- [ ] **Step 5: Run the instrumented tests on the emulator**

Run: `cd android && nice -n 10 ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.mickdewald.keeweb.SecureClipboardTest; ./gradlew --stop`
Expected: `BUILD SUCCESSFUL`, 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add android app/scripts/comp/platform app/scripts/comp/browser/copy-paste.js test/src/comp/platform/android-clipboard.js
git commit -m "feat(android): copy passwords as sensitive clips and clear them natively"
```

---

### Task 6: Touch field actions and mobile layout fixes

**Files:**
- Create: `app/scripts/comp/platform/android/touch-field-actions.js` (shared by all mobile browsers, despite the folder)
- Modify: `app/scripts/views/fields/field-view.js:20-27` (events), `:141-155` (`fieldValueClick`)
- Modify: `app/styles/areas/_details.scss`, `app/styles/areas/_open.scss`
- Test: `test/src/comp/platform/touch-field-actions.js`
- Modify: `scripts/android/e2e-emulator.mjs` (steps `tap-copies`, `layout`)

**Interfaces:**
- Produces: `touchValueAction({ isMobile, readonly, hasValue, targetTag, hasSelection }) → 'copy' | 'edit' | 'none'`, `touchLongPressAction({ isMobile, readonly }) → 'actions' | 'none'`.

- [ ] **Step 1: Write the failing tests**

```js
// test/src/comp/platform/touch-field-actions.js
import { expect } from 'chai';
import { touchValueAction, touchLongPressAction } from 'comp/platform/android/touch-field-actions';

const base = { isMobile: true, readonly: false, hasValue: true, targetTag: 'div', hasSelection: false };

describe('touch field actions', () => {
    it('copies on a single tap on mobile', () => {
        expect(touchValueAction(base)).to.equal('copy');
    });

    it('keeps links and inputs working', () => {
        expect(touchValueAction({ ...base, targetTag: 'a' })).to.equal('none');
        expect(touchValueAction({ ...base, targetTag: 'input' })).to.equal('none');
    });

    it('does nothing while text is selected or the field is empty', () => {
        expect(touchValueAction({ ...base, hasSelection: true })).to.equal('none');
        expect(touchValueAction({ ...base, hasValue: false })).to.equal('edit');
    });

    it('keeps the desktop behaviour (click edits)', () => {
        expect(touchValueAction({ ...base, isMobile: false })).to.equal('edit');
    });

    it('opens the action bar on a long press of an editable field', () => {
        expect(touchLongPressAction({ isMobile: true, readonly: false })).to.equal('actions');
        expect(touchLongPressAction({ isMobile: true, readonly: true })).to.equal('none');
        expect(touchLongPressAction({ isMobile: false, readonly: false })).to.equal('none');
    });
});
```

An empty field on mobile returns `'edit'`, so that tapping an empty field starts editing. Run the tests. Expected: FAIL (module missing).

- [ ] **Step 2: Implement the decisions and hook `FieldView`**

```js
// app/scripts/comp/platform/android/touch-field-actions.js
const PassThroughTags = ['a', 'input', 'textarea'];

function touchValueAction({ isMobile, readonly, hasValue, targetTag, hasSelection }) {
    if (PassThroughTags.includes(targetTag) || hasSelection) {
        return 'none';
    }
    if (!isMobile || !hasValue) {
        return readonly ? 'none' : 'edit';
    }
    return 'copy';
}

function touchLongPressAction({ isMobile, readonly }) {
    return isMobile && !readonly ? 'actions' : 'none';
}

export { touchValueAction, touchLongPressAction };
```

In `field-view.js` add the event `'contextmenu .details__field-value': 'fieldValueLongPress'` and replace `fieldValueClick`:

```js
    fieldValueClick(e) {
        this.hideOptionsDropdown();
        const action = touchValueAction({
            isMobile: Features.isMobile,
            readonly: this.readonly,
            hasValue: !!this.value,
            targetTag: e.target.tagName.toLowerCase(),
            hasSelection: !!window.getSelection().toString()
        });
        if (action === 'copy') {
            e.stopPropagation();
            this.copyValue();
        } else if (action === 'edit') {
            this.edit();
        }
    }

    fieldValueLongPress(e) {
        if (touchLongPressAction({ isMobile: Features.isMobile, readonly: this.readonly }) === 'actions') {
            e.preventDefault();
            e.stopPropagation();
            this.showMobileActions();
        }
    }
```

Import: `import { touchValueAction, touchLongPressAction } from 'comp/platform/android/touch-field-actions';`. Run `wc -l app/scripts/views/fields/field-view.js`; it must stay ≤ 500.

Run the tests. Expected: PASS.

- [ ] **Step 3: Measure the detail-title defect on the emulator**

Rebuild and install the debug APK, run `node scripts/android/e2e-emulator.mjs --only unlock`, open an entry (`node scripts/android/cdp.mjs "document.querySelector('.list__item').click(), true"`), then:

```bash
node scripts/android/cdp.mjs "(() => { const h = document.querySelector('.details__header'); return [...h.children].map((el) => [el.className, Math.round(el.getBoundingClientRect().width), getComputedStyle(el).flex, getComputedStyle(el).display]); })()"
```

Expected: a list showing which sibling of `.details__header-title` takes the width (the spike measured the title at 77 of 384 px). Record the output in the commit message.

- [ ] **Step 4: Fix the layout inside `@include mobile`**

In `_details.scss`, inside the `&__header` block, add a mobile rule that lets the title take the free width:

```scss
        @include mobile {
            flex-wrap: nowrap;
            .details__header-title {
                flex: 1 1 auto;
                max-width: none;
            }
        }
```

If Step 3 showed a sibling with a fixed or `flex: 1` width, give that sibling `flex: 0 0 auto` in the same mobile block, naming the class shown in Step 3's output.

In `_open.scss`, inside the password-field rules, reserve room for the Enter icon on mobile so the placeholder cannot run under it:

```scss
    @include mobile {
        .open__pass-input {
            padding-right: 3em;
            text-overflow: ellipsis;
        }
    }
```

Before editing, check the selector with `grep -n "open__pass-input" app/styles/areas/_open.scss`.

- [ ] **Step 5: Add E2E assertions and run them**

Append to `Steps`:

```js
    {
        name: 'layout',
        async run(c, { assert, sleep }) {
            await c.evaluate(`document.querySelector('.list__item').click(), true`);
            await sleep(500);
            const ratio = await c.evaluate(`(() => { const t = document.querySelector('.details__header-title');
                const h = document.querySelector('.details__header');
                return t.getBoundingClientRect().width / h.getBoundingClientRect().width; })()`);
            assert(ratio > 0.5, `detail title uses more than half the header (got ${ratio.toFixed(2)})`);
            const top = await c.evaluate(`document.querySelector('.app').getBoundingClientRect().top`);
            assert(top >= 0, 'app is not pushed under the status bar');
        }
    },
    {
        name: 'tap-copies',
        async run(c, { assert, sleep }) {
            await c.evaluate(`(() => { const v = [...document.querySelectorAll('.details__field')]
                .find((f) => f.querySelector('.details__field-label').textContent.trim() === 'Password')
                .querySelector('.details__field-value'); v.click(); return true; })()`);
            await sleep(300);
            const tip = await c.evaluate(`(document.querySelector('.tip') || {}).textContent || ''`);
            assert(tip.startsWith('Copied'), `a single tap shows the copied tip (got "${tip}")`);
            assert(!(await c.evaluate(`!!document.querySelector('.details__field-mobile-actions')`)),
                'a single tap does not open the action bar');
        }
    }
```

`tap-copies` checks the UI side; Task 5's instrumented tests already cover the native clipboard. Run `node scripts/android/e2e-emulator.mjs`. Expected: `E2E OK`. Take a screenshot of the details view (`adb exec-out screencap -p > /tmp/keeweb-details.png`) and look at it: the title is on one or two lines, not broken every few characters.

- [ ] **Step 6: Commit**

```bash
git add app/scripts/comp/platform/android/touch-field-actions.js app/scripts/views/fields/field-view.js app/styles test/src/comp/platform/touch-field-actions.js scripts/android/e2e-emulator.mjs
git commit -m "feat(mobile): copy field values with one tap and fix the narrow detail title"
```

---

### Task 7: Biometric unlock

**Files:**
- Create: `android/app/src/main/java/com/mickdewald/keeweb/BiometricCryptoPlugin.java`
- Create: `android/app/src/main/java/com/mickdewald/keeweb/HybridCrypto.java`
- Create: `android/app/src/androidTest/java/com/mickdewald/keeweb/HybridCryptoTest.java`
- Create: `app/scripts/comp/platform/android/android-native-modules.js`
- Modify: `android/app/build.gradle` (dependency `androidx.biometric:biometric`)
- Modify: `MainActivity.java` (register), `app/scripts/comp/launcher/native-modules.js` (export Android impl)
- Modify: `app/scripts/comp/app/touch-id-recovery.js:8-16`, `app/scripts/views/open-view-operations.js:64-66`
- Modify: `app/scripts/views/settings/settings-general-view.js:156`
- Test: `test/src/comp/platform/android-native-modules.js`

**Interfaces:**
- Produces (native): plugin `BiometricCrypto`:
  - `encrypt({ data: base64 }) → { data: base64 }` (no prompt; public key);
  - `decrypt({ data: base64, prompt: string }) → { data: base64 }` (BiometricPrompt);
  - `deleteKey() → {}`.

  Rejections carry `code` `USER_CANCELED` | `KEY_INVALIDATED` | `LOCKOUT` | `NO_BIOMETRICS` | `FAILED`.
- Produces (JS): `createAndroidNativeModules(plugin) → { hardwareEncrypt(pv), hardwareDecrypt(pv, prompt), hardwareCryptoDeleteKey() }`, with rejections as `Error` objects carrying `.code`.
- Consumes: `NativeModules` call sites in `touch-id-recovery.js`, `open-view-operations.js`, `app-model.js` (unchanged).

- [ ] **Step 1: Write the failing JS tests**

```js
// test/src/comp/platform/android-native-modules.js
import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { createAndroidNativeModules } from 'comp/platform/android/android-native-modules';
import { TouchIdRecovery } from 'comp/app/touch-id-recovery';

describe('Android NativeModules', () => {
    const plugin = {
        encrypt: ({ data }) => Promise.resolve({ data: data.split('').reverse().join('') }),
        decrypt: ({ data }) => Promise.resolve({ data: data.split('').reverse().join('') }),
        deleteKey: () => Promise.resolve({})
    };

    it('round-trips a ProtectedValue through the plugin', async () => {
        const nm = createAndroidNativeModules(plugin);
        const enc = await nm.hardwareEncrypt(kdbxweb.ProtectedValue.fromString('pw'));
        const dec = await nm.hardwareDecrypt(enc, 'Unlock');
        expect(dec.getText()).to.equal('pw');
    });

    it('turns plugin rejections into errors with a code', async () => {
        const failing = { ...plugin, decrypt: () => Promise.reject({ code: 'KEY_INVALIDATED', message: 'invalidated' }) };
        const nm = createAndroidNativeModules(failing);
        try {
            await nm.hardwareDecrypt(kdbxweb.ProtectedValue.fromString('x'), 'Unlock');
            expect.fail('should reject');
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect(err.code).to.equal('KEY_INVALIDATED');
        }
    });

    it('lets TouchIdRecovery recognise an invalidated Android key', () => {
        const err = Object.assign(new Error('invalidated'), { code: 'KEY_INVALIDATED' });
        expect(TouchIdRecovery.handleDecryptionError(err, 'file-1')).to.equal(true);
        expect(TouchIdRecovery.isRequired('file-1')).to.equal(true);
    });
});
```

`TouchIdRecovery` keeps module state (`recoveryFileIds`), which would leak into the existing `app-model-touch-id-recovery.js` tests. Add to `touch-id-recovery.js`:

```js
    resetForTests() {
        recoveryFileIds.clear();
    },
```

and add `afterEach(() => TouchIdRecovery.resetForTests());` inside this `describe`.

Run the tests. Expected: FAIL (module missing).

- [ ] **Step 2: Implement the JS side**

```js
// app/scripts/comp/platform/android/android-native-modules.js
import * as kdbxweb from 'kdbxweb';

function toError(e) {
    const err = new Error((e && e.message) || 'Biometric operation failed');
    err.code = (e && e.code) || 'FAILED';
    return err;
}

function createAndroidNativeModules(plugin) {
    const b64 = (pv) => kdbxweb.ByteUtils.bytesToBase64(pv.getBinary());
    const fromB64 = (s) => kdbxweb.ProtectedValue.fromBinary(kdbxweb.ByteUtils.base64ToBytes(s).buffer);
    return {
        async hardwareEncrypt(value) {
            try {
                return fromB64((await plugin.encrypt({ data: b64(value) })).data);
            } catch (e) {
                throw toError(e);
            }
        },
        async hardwareDecrypt(value, prompt) {
            try {
                return fromB64((await plugin.decrypt({ data: b64(value), prompt })).data);
            } catch (e) {
                throw toError(e);
            }
        },
        async hardwareCryptoDeleteKey() {
            try {
                await plugin.deleteKey();
            } catch (e) {
                throw toError(e);
            }
        }
    };
}

export { createAndroidNativeModules };
```

Check: `grep -n "base64ToBytes\|bytesToBase64" ~/projects/keeweb/node_modules/kdbxweb/dist/types/utils/byte-utils.d.ts`, and that `kdbxweb.ByteUtils` is the export name (`grep -n "ByteUtils" node_modules/kdbxweb/dist/types/index.d.ts`). If `base64ToBytes` returns a view with an offset, pass `bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)` instead of `.buffer`.

In `native-modules.js`, before `export { NativeModules };`:

```js
if (!NativeModules && AndroidPlatform.isAndroid) {
    NativeModules = createAndroidNativeModules(AndroidPlatform.plugin('BiometricCrypto'));
}
```

(Import both modules at the top.)

In `touch-id-recovery.js` `handleDecryptionError`:

```js
        const isInvalidatedKey =
            error?.code === 'KEY_INVALIDATED' ||
            /SecKeyCreateDecryptedData: OSStatus -1(?:\s|$)/.test(error?.message || '');
```

In `open-view-operations.js` replace `if (err.message.includes('User refused')) {` with

```js
                        if (err.message.includes('User refused') || err.code === 'USER_CANCELED') {
```

In `settings-general-view.js` replace `hasDeviceOwnerAuth: Features.isDesktop && Features.isMac,` with `hasDeviceOwnerAuth: (Features.isDesktop && Features.isMac) || AndroidPlatform.isAndroid,` (import `AndroidPlatform`).

Run the tests. Expected: PASS, including the existing Touch ID recovery tests.

- [ ] **Step 3: Implement the hybrid crypto (no UI, testable)**

```java
package com.mickdewald.keeweb;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.ByteBuffer;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/**
 * Master-password protection: a random AES-256-GCM key encrypts the password, and an RSA-OAEP key
 * pair in the Android Keystore wraps that AES key. Encrypting needs only the public key (no prompt);
 * unwrapping needs the biometric-bound private key. Layout: [2-byte wrapped length][wrapped key][12-byte IV][ciphertext].
 */
final class HybridCrypto {
    static final String ALIAS = "keeweb-master-password";
    private static final String RSA = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    // Keystore RSA-OAEP only supports SHA-1 for MGF1 on many devices.
    static final OAEPParameterSpec OAEP = new OAEPParameterSpec(
            "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT);

    private HybridCrypto() {}

    static KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks;
    }

    static void ensureKey(boolean requireBiometrics) throws Exception {
        if (keyStore().containsAlias(ALIAS)) {
            return;
        }
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                        ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP);
        if (requireBiometrics) {
            spec.setUserAuthenticationRequired(true)
                    .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                    .setInvalidatedByBiometricEnrollment(true);
        }
        KeyPairGenerator gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
        gen.initialize(spec.build());
        gen.generateKeyPair();
    }

    static void deleteKey() throws Exception {
        keyStore().deleteEntry(ALIAS);
    }

    static byte[] encrypt(byte[] plain) throws Exception {
        PublicKey stored = keyStore().getCertificate(ALIAS).getPublicKey();
        PublicKey pub = KeyFactory.getInstance(stored.getAlgorithm())
                .generatePublic(new X509EncodedKeySpec(stored.getEncoded()));
        KeyGenerator kg = KeyGenerator.getInstance("AES");
        kg.init(256);
        SecretKey aes = kg.generateKey();
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.ENCRYPT_MODE, aes, new GCMParameterSpec(128, iv));
        byte[] body = gcm.doFinal(plain);
        Cipher rsa = Cipher.getInstance(RSA);
        rsa.init(Cipher.ENCRYPT_MODE, pub, OAEP);
        byte[] wrapped = rsa.doFinal(aes.getEncoded());
        return ByteBuffer.allocate(2 + wrapped.length + iv.length + body.length)
                .putShort((short) wrapped.length).put(wrapped).put(iv).put(body).array();
    }

    /** Returns an RSA cipher ready for decryption; the caller authenticates it via BiometricPrompt. */
    static Cipher decryptCipher() throws Exception {
        PrivateKey key = (PrivateKey) keyStore().getKey(ALIAS, null);
        Cipher rsa = Cipher.getInstance(RSA);
        rsa.init(Cipher.DECRYPT_MODE, key, OAEP);
        return rsa;
    }

    static byte[] decrypt(Cipher authenticatedRsa, byte[] blob) throws Exception {
        ByteBuffer in = ByteBuffer.wrap(blob);
        byte[] wrapped = new byte[in.getShort()];
        in.get(wrapped);
        byte[] iv = new byte[12];
        in.get(iv);
        byte[] body = new byte[in.remaining()];
        in.get(body);
        SecretKeySpec aes = new SecretKeySpec(authenticatedRsa.doFinal(wrapped), "AES");
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.DECRYPT_MODE, aes, new GCMParameterSpec(128, iv));
        return gcm.doFinal(body);
    }
}
```

- [ ] **Step 4: Implement the plugin**

```java
package com.mickdewald.keeweb;

import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import javax.crypto.Cipher;

@CapacitorPlugin(name = "BiometricCrypto")
public class BiometricCryptoPlugin extends Plugin {
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    @PluginMethod
    public void encrypt(PluginCall call) {
        try {
            if (BiometricManager.from(getContext()).canAuthenticate(STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
                call.reject("No strong biometrics enrolled", "NO_BIOMETRICS");
                return;
            }
            HybridCrypto.ensureKey(true);
            byte[] out = HybridCrypto.encrypt(Base64.decode(call.getString("data"), Base64.NO_WRAP));
            call.resolve(result(out));
        } catch (Exception e) {
            call.reject(e.getMessage(), "FAILED", e);
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        final byte[] blob = Base64.decode(call.getString("data"), Base64.NO_WRAP);
        final Cipher cipher;
        try {
            cipher = HybridCrypto.decryptCipher();
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("Biometric key invalidated", "KEY_INVALIDATED", e);
            return;
        } catch (Exception e) {
            // A missing key after a reinstall or data clear behaves like an invalidated key.
            call.reject(e.getMessage(), "KEY_INVALIDATED", e);
            return;
        }
        FragmentActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                            try {
                                call.resolve(result(HybridCrypto.decrypt(r.getCryptoObject().getCipher(), blob)));
                            } catch (Exception e) {
                                call.reject(e.getMessage(), "FAILED", e);
                            }
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence msg) {
                            boolean canceled = code == BiometricPrompt.ERROR_USER_CANCELED
                                    || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                    || code == BiometricPrompt.ERROR_CANCELED;
                            boolean lockout = code == BiometricPrompt.ERROR_LOCKOUT
                                    || code == BiometricPrompt.ERROR_LOCKOUT_PERMANENT;
                            call.reject(msg.toString(), canceled ? "USER_CANCELED" : lockout ? "LOCKOUT" : "FAILED");
                        }
                    });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(call.getString("prompt", "Unlock"))
                    .setNegativeButtonText("Use password")
                    .setAllowedAuthenticators(STRONG)
                    .build();
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        try {
            HybridCrypto.deleteKey();
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject(e.getMessage(), "FAILED", e);
        }
    }

    private static JSObject result(byte[] data) {
        JSObject o = new JSObject();
        o.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        return o;
    }
}
```

Add `implementation "androidx.biometric:biometric:<version>"` to `android/app/build.gradle`, using the latest stable version from `https://developer.android.com/jetpack/androidx/releases/biometric` (pin it exactly). Register `registerPlugin(BiometricCryptoPlugin.class);` in `MainActivity` before `super.onCreate`.

- [ ] **Step 5: Write the instrumented crypto test (no biometrics required)**

```java
package com.mickdewald.keeweb;

import static org.junit.Assert.assertArrayEquals;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.nio.charset.StandardCharsets;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class HybridCryptoTest {
    @Before
    public void createKeyWithoutBiometrics() throws Exception {
        HybridCrypto.deleteKey();
        HybridCrypto.ensureKey(false);
    }

    @After
    public void deleteKey() throws Exception {
        HybridCrypto.deleteKey();
    }

    @Test
    public void roundTripsAShortPassword() throws Exception {
        byte[] plain = "fake-password".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(plain, HybridCrypto.decrypt(HybridCrypto.decryptCipher(), HybridCrypto.encrypt(plain)));
    }

    @Test
    public void roundTripsAThousandCharacterPassword() throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1000; i++) {
            sb.append((char) ('a' + i % 26));
        }
        byte[] plain = sb.toString().getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(plain, HybridCrypto.decrypt(HybridCrypto.decryptCipher(), HybridCrypto.encrypt(plain)));
    }
}
```

- [ ] **Step 6: Run the instrumented tests**

Run: `npm run android:debug && cd android && nice -n 10 ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.mickdewald.keeweb.HybridCryptoTest; ./gradlew --stop`
Expected: 2 tests passed.

- [ ] **Step 7: Verify the biometric flow on the emulator (scripted where possible)**

1. Set a device PIN: `adb shell locksettings set-pin 1111`.
2. Enrol a fingerprint:
   - start enrolment with `adb shell am start -a android.settings.FINGERPRINT_ENROLL`;
   - confirm the PIN with `adb shell input text 1111 && adb shell input keyevent 66`;
   - then repeat `adb -e emu finger touch 1` until the enrolment screen reports success (screenshot between touches to confirm; about 6 touches).
3. Run `node scripts/android/e2e-emulator.mjs --only unlock`. Unlocking with the password now shows a prompt to confirm biometrics once. Answer it with `adb -e emu finger touch 1`.
4. Background the app, then return to it. After resuming, the biometric prompt must appear without a tap. Unlock with `adb -e emu finger touch 1` and confirm that the list is shown.
5. Cancel path: return to the app and press back on the prompt. The password field must be focused, with no error dialog.
6. Invalidation path: enrol a second fingerprint (repeat step 2 with `finger touch 2`). The next resume must show the explanation, then the password field. After unlocking with the password (`e2e-fake-password`), the next resume must show the biometric prompt again.

Record the screenshots of steps 4–6 in the task report. **Stop condition:** if step 2 cannot enrol a fingerprint headlessly on this image, report it and hand steps 4–6 to the device acceptance (Task 10).

- [ ] **Step 8: Commit**

```bash
git add android app/scripts test/src/comp/platform/android-native-modules.js
git commit -m "feat(android): unlock with biometrics through the Keystore"
```

---

### Task 8: Drive file through the document picker

**Files:**
- Create: `android/app/src/main/java/com/mickdewald/keeweb/DocumentFilePlugin.java`
- Create: `app/scripts/storage/impl/storage-android-document.js`
- Modify: `app/scripts/storage/index.js`, `app/scripts/views/open-view-operations.js` (`openStorage`), `app/scripts/comp/platform/android/android-lifecycle.js` (sync on resume), `app/scripts/locales/base.json`, `app/scripts/locales/de-DE.json`, `MainActivity.java` (register)
- Test: `test/src/storage/storage-android-document.js`

**Interfaces:**
- Produces (native): plugin `DocumentFile`:
  - `pick() → { uri, name }`;
  - `read({ uri }) → { data: base64, rev: sha256hex }`;
  - `stat({ uri }) → { rev }`;
  - `write({ uri, data: base64, expectedRev? }) → { rev } | reject { code: 'REV_CONFLICT' }`.

  Other rejections carry `NOT_FOUND` | `PERMISSION_LOST` | `IO`.
- Produces (JS): `StorageAndroidDocument` (`name = 'androiddoc'`) with `pick(callback)`, `load`, `stat`, `save` in the storage-base callback shapes; `Storage.androiddoc` exists only on Android.
- Consumes: `appModel.syncFile(file)` (`app/scripts/models/app-model-sync.js:8`).

- [ ] **Step 1: Write the failing storage tests**

```js
// test/src/storage/storage-android-document.js
import { expect } from 'chai';
import { StorageAndroidDocument } from 'storage/impl/storage-android-document';

function storageWith(plugin) {
    const s = new StorageAndroidDocument(plugin);
    s.logger = { debug() {}, error() {}, info() {} };
    return s;
}

const cb = () => {
    let resolve;
    const p = new Promise((r) => (resolve = r));
    return { fn: (...args) => resolve(args), p };
};

describe('StorageAndroidDocument', () => {
    it('loads bytes and returns the content hash as rev', async () => {
        const s = storageWith({ read: () => Promise.resolve({ data: btoa('abc'), rev: 'h1' }) });
        const c = cb();
        s.load('content://doc', {}, c.fn);
        const [err, data, stat] = await c.p;
        expect(err).to.equal(null);
        expect(new Uint8Array(data)).to.eql(new Uint8Array([97, 98, 99]));
        expect(stat).to.eql({ rev: 'h1' });
    });

    it('reports a rev conflict and writes nothing when the remote changed', async () => {
        const s = storageWith({
            write: () => Promise.reject({ code: 'REV_CONFLICT' }),
            stat: () => Promise.resolve({ rev: 'h2' })
        });
        const c = cb();
        s.save('content://doc', {}, new Uint8Array([1]).buffer, c.fn, 'h1');
        const [err, stat] = await c.p;
        expect(err).to.eql({ revConflict: true });
        expect(stat).to.eql({ rev: 'h2' });
    });

    it('returns the new rev after a successful save', async () => {
        const s = storageWith({ write: ({ expectedRev }) => Promise.resolve({ rev: `after-${expectedRev}` }) });
        const c = cb();
        s.save('content://doc', {}, new Uint8Array([1]).buffer, c.fn, 'h1');
        const [err, stat] = await c.p;
        expect(err).to.equal(null);
        expect(stat).to.eql({ rev: 'after-h1' });
    });

    it('maps a lost permission to notFound so KeeWeb offers to reopen', async () => {
        const s = storageWith({ stat: () => Promise.reject({ code: 'PERMISSION_LOST', message: 'gone' }) });
        const c = cb();
        s.stat('content://doc', {}, c.fn);
        const [err] = await c.p;
        expect(err.notFound).to.equal(true);
    });

    it('opens the picker and hands back path and name', async () => {
        const s = storageWith({ pick: () => Promise.resolve({ uri: 'content://doc', name: 'Main.kdbx' }) });
        const c = cb();
        s.pick(c.fn);
        const [err, file] = await c.p;
        expect(err).to.equal(null);
        expect(file).to.eql({ path: 'content://doc', name: 'Main.kdbx' });
    });
});
```

Run the tests. Expected: FAIL (module missing).

- [ ] **Step 2: Implement the storage**

```js
// app/scripts/storage/impl/storage-android-document.js
import * as kdbxweb from 'kdbxweb';
import { StorageBase } from 'storage/storage-base';
import { AndroidPlatform } from 'comp/platform/android/android-platform';

function toError(e) {
    const code = e && e.code;
    const err = { message: (e && e.message) || String(e), code };
    if (code === 'NOT_FOUND' || code === 'PERMISSION_LOST') {
        err.notFound = true;
    }
    return err;
}

class StorageAndroidDocument extends StorageBase {
    name = 'androiddoc';
    icon = 'folder-open';
    enabled = AndroidPlatform.isAndroid;
    uipos = 5;

    constructor(plugin) {
        super();
        this._plugin = plugin;
    }

    get plugin() {
        if (!this._plugin) {
            this._plugin = AndroidPlatform.plugin('DocumentFile');
        }
        return this._plugin;
    }

    pick(callback) {
        this.plugin
            .pick()
            .then(({ uri, name }) => callback(null, { path: uri, name }))
            .catch((e) => callback(toError(e)));
    }

    load(path, opts, callback) {
        this.plugin
            .read({ uri: path })
            .then(({ data, rev }) => {
                const bytes = kdbxweb.ByteUtils.base64ToBytes(data);
                const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                callback(null, buffer, { rev });
            })
            .catch((e) => {
                this.logger.error('Load error', e);
                callback(toError(e));
            });
    }

    stat(path, opts, callback) {
        this.plugin
            .stat({ uri: path })
            .then(({ rev }) => callback(null, { rev }))
            .catch((e) => callback(toError(e)));
    }

    save(path, opts, data, callback, rev) {
        const payload = { uri: path, data: kdbxweb.ByteUtils.bytesToBase64(data) };
        if (rev) {
            payload.expectedRev = rev;
        }
        this.plugin
            .write(payload)
            .then((res) => callback(null, { rev: res.rev }))
            .catch((e) => {
                if (e && e.code === 'REV_CONFLICT') {
                    return this.stat(path, opts, (err, stat) =>
                        err ? callback(err) : callback({ revConflict: true }, stat)
                    );
                }
                this.logger.error('Save error', e);
                callback(toError(e));
            });
    }
}

export { StorageAndroidDocument };
```

`StorageBase.init()` sets `this.logger`; the tests stub it. If `StorageBase` requires constructor arguments, `grep -n "constructor" app/scripts/storage/storage-base.js` shows none today.

Register it in `app/scripts/storage/index.js`:

```js
import { StorageAndroidDocument } from 'storage/impl/storage-android-document';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
// ...
if (AndroidPlatform.isAndroid) {
    Storage.androiddoc = new StorageAndroidDocument();
}
```

Check how storages are initialised (`grep -rn "\.init()" app/scripts/app.js app/scripts/storage | head`). Put the Android storage into the same loop, so that `init()` runs on it.

In `open-view-operations.js` `openStorage`, before `} else if (storage.list) {`:

```js
            } else if (storage.pick) {
                storage.pick((err, file) => {
                    if (!err && file) {
                        this.openStorageFile(storage, file);
                    }
                });
```

Add the locale strings `"androiddoc": "Open file (Drive, device)"` to `base.json` and `"androiddoc": "Datei öffnen (Drive, Gerät)"` to `de-DE.json`, next to `"gdrive"`.

Run the tests. Expected: PASS.

- [ ] **Step 3: Implement the native plugin**

```java
package com.mickdewald.keeweb;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "DocumentFile")
public class DocumentFilePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Picker canceled", "CANCELED");
            return;
        }
        Uri uri = result.getData().getData();
        getContext().getContentResolver().takePersistableUriPermission(uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", displayName(uri));
        call.resolve(o);
    }

    @PluginMethod
    public void read(PluginCall call) {
        io.execute(() -> {
            try {
                byte[] data = readAll(Uri.parse(call.getString("uri")));
                JSObject o = new JSObject();
                o.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                o.put("rev", sha256(data));
                call.resolve(o);
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    @PluginMethod
    public void stat(PluginCall call) {
        io.execute(() -> {
            try {
                JSObject o = new JSObject();
                o.put("rev", sha256(readAll(Uri.parse(call.getString("uri")))));
                call.resolve(o);
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        io.execute(() -> {
            try {
                Uri uri = Uri.parse(call.getString("uri"));
                String expected = call.getString("expectedRev");
                if (expected != null && !expected.equals(sha256(readAll(uri)))) {
                    call.reject("Remote file changed", "REV_CONFLICT");
                    return;
                }
                byte[] data = Base64.decode(call.getString("data"), Base64.NO_WRAP);
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    out.write(data);
                }
                JSObject o = new JSObject();
                o.put("rev", sha256(data));
                call.resolve(o);
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    private byte[] readAll(Uri uri) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        try (InputStream in = cr.openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri,
                new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return c.getString(0);
            }
        }
        return "Database.kdbx";
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : d) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static void reject(PluginCall call, Exception e) {
        String code = e instanceof FileNotFoundException ? "NOT_FOUND"
                : e instanceof SecurityException ? "PERMISSION_LOST" : "IO";
        call.reject(e.getMessage(), code, e);
    }
}
```

Register `registerPlugin(DocumentFilePlugin.class);` in `MainActivity` before `super.onCreate`.

- [ ] **Step 4: Sync on resume**

In `android-lifecycle.js`, inside the `isActive` branch, after emitting `android-resumed`:

```js
                appModel.files
                    .filter((f) => f.storage === 'androiddoc' && !f.syncing)
                    .forEach((f) => appModel.syncFile(f));
```

Check the property names with `grep -n "syncing\|storage" app/scripts/models/file-model.js | head`, and adapt them if the file model names them differently.

- [ ] **Step 5: Verify on the emulator with the Downloads provider**

1. Push the fixture: `adb push test/android/fixtures/e2e-fixture.kdbx /sdcard/Download/`.
2. Rebuild and install. Open the app, tap "More", then the new storage icon. The system picker opens. Tap the fixture: dump the UI with `adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml /tmp/ui.xml`, find the node with `text="e2e-fixture.kdbx"` and tap the centre of its `bounds`.
3. Unlock with `e2e-fake-password`, edit the first entry's title through CDP (`.details__header-title` click, type `X`, blur), and wait for the save.
4. Conflict test:
   - background the app;
   - on the host, modify the fixture on the device with a second copy: `adb push` a version made by opening the fixture in the macOS KeeWeb **copy** in `tmp/` and adding an entry (or by re-running `make-e2e-fixture.mjs` with one extra entry into `tmp/`);
   - resume the app.

   Expected: KeeWeb merges. Both the edited title and the new entry are present, and the file on the device afterwards contains both (pull it and open it in the macOS app).
5. Permission lost: delete the file on the device (`adb shell rm /sdcard/Download/e2e-fixture.kdbx`) and resume. Expected: a clear "file not found" message and the open screen, with no empty or stuck screen.

- [ ] **Step 6: Commit**

```bash
git add android app/scripts test/src/storage
git commit -m "feat(android): open and sync the database through the document picker"
```

---

### Task 9: Release build, signing, secret check and docs

**Files:**
- Create: `scripts/android/build-release.sh`, `scripts/android/check-apk-secrets.sh`, `docs/android.md`
- Modify: `android/app/build.gradle` (release signing from env), `AGENTS.md`

**Interfaces:**
- Consumes: env `KEEWEB_ANDROID_KEYSTORE` (path, default `$HOME/.keeweb-android/release.jks`), Keychain item `keeweb-android-keystore` (password, read with `security find-generic-password -s keeweb-android-keystore -w`).
- Produces: `npm run build:android` → `android/app/build/outputs/apk/release/app-release.apk`, verified by `check-apk-secrets.sh`.

- [ ] **Step 1: Release signing from the environment**

In `android/app/build.gradle`:

```gradle
android {
    signingConfigs {
        release {
            storeFile System.getenv("KEEWEB_ANDROID_KEYSTORE") ? file(System.getenv("KEEWEB_ANDROID_KEYSTORE")) : null
            storePassword System.getenv("KEEWEB_ANDROID_KEYSTORE_PASSWORD")
            keyAlias "keeweb"
            keyPassword System.getenv("KEEWEB_ANDROID_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

Merge this into the existing `android { … }` and `buildTypes { … }` blocks; do not add a second `android` block.

- [ ] **Step 2: Secret check**

```bash
#!/usr/bin/env bash
# scripts/android/check-apk-secrets.sh <apk>: fails if the APK or the Capacitor config holds credential-shaped values.
set -euo pipefail
APK="$1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$APK" -d "$WORK"
PATTERN='(password|passwd|secret|token|api[_-]?key|client[_-]?secret)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9+/_-]{12,}'
if grep -rEiI --exclude-dir=res "$PATTERN" "$WORK/assets" capacitor.config.json; then
    echo "credential-shaped value found" >&2
    exit 1
fi
if find "$WORK" -name '*.kdbx' | grep -q .; then
    echo "a KeePass database is inside the APK" >&2
    exit 1
fi
echo "no credentials found"
```

The web bundle contains the upstream OAuth client IDs and the placeholder `gdriveClientSecret: null` in `cloud-storage-apps.js`. If the pattern matches those, list each match in the task report and narrow the pattern to exclude exactly those known constants by file (`--exclude=`). Never weaken the check wholesale.

Test it: run it against the debug APK. Expected: `no credentials found`. Then run it against a copy with an injected fake secret (`printf 'apiKey="abcdefghijklmnopqrstuv"' > "$WORK2/assets/public/fake.js"`, zip it back) and expect exit code 1.

- [ ] **Step 3: Release script**

```bash
#!/usr/bin/env bash
# scripts/android/build-release.sh: signed release APK, credentials read at build time only.
set -euo pipefail
cd "$(dirname "$0")/../.."
export KEEWEB_ANDROID_KEYSTORE="${KEEWEB_ANDROID_KEYSTORE:-$HOME/.keeweb-android/release.jks}"
if [ ! -f "$KEEWEB_ANDROID_KEYSTORE" ]; then
    echo "Keystore missing: $KEEWEB_ANDROID_KEYSTORE (see docs/android.md)" >&2
    exit 1
fi
KEEWEB_ANDROID_KEYSTORE_PASSWORD="$(security find-generic-password -s keeweb-android-keystore -w)"
export KEEWEB_ANDROID_KEYSTORE_PASSWORD
if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to build a release from a dirty tree" >&2
    exit 1
fi
npm run android:web
npx cap sync android
(cd android && nice -n 10 ./gradlew assembleRelease; ./gradlew --stop)
bash scripts/android/check-apk-secrets.sh android/app/build/outputs/apk/release/app-release.apk
echo "Built android/app/build/outputs/apk/release/app-release.apk"
```

- [ ] **Step 4: Documentation**

Write `docs/android.md` covering:
- **one-time keystore creation:** `keytool -genkeypair -keystore ~/.keeweb-android/release.jks -alias keeweb -keyalg RSA -keysize 4096 -validity 10000`, store the password with `security add-generic-password -s keeweb-android-keystore -a "$USER" -w`, and back the keystore up; losing it breaks in-place updates;
- **building:** `npm run android:debug` and `npm run build:android`;
- **installing:** `adb install -r android/app/build/outputs/apk/release/app-release.apk` (the debug build is `com.mickdewald.keeweb.dev` and installs side by side);
- **emulator workflow:** `scripts/android/emulator.sh`, `scripts/android/e2e-emulator.mjs`, and the instrumented-test commands;
- **first use:** open through "More" → the storage icon → Drive → pick the `.kdbx`; enable biometrics when asked.

Add to `AGENTS.md` a repo delta: "Android: build only through the `npm run android:*` scripts and `scripts/android/build-release.sh`; emulator work headless through `scripts/android/emulator.sh`; E2E only against `test/android/fixtures`; never commit a keystore or print its password."

- [ ] **Step 5: Verify and commit**

Run: `npm test && npx grunt eslint && python3 scripts/check-file-sizes.py && npm run android:debug`
Expected: all green. (The release build itself runs in Task 10, once the maintainer has created the keystore.)

```bash
git add scripts/android android/app/build.gradle docs/android.md AGENTS.md
git commit -m "build(android): add signed release builds and an APK secret check"
```

---

### Task 10: Device acceptance with the maintainer

**Files:**
- Create: `docs/superpowers/plans/2026-09-30-android-app-acceptance.md` (results)

This task needs the maintainer and their phone. The agent prepares everything, announces each step, and bundles the interactions.

- [ ] **Step 1: Maintainer creates the keystore** (follow `docs/android.md`). The agent never sees the password.

- [ ] **Step 2: Build and install the release**

Run `npm run build:android`, then `adb devices -l` (the phone must be the only physical device), then `adb -s <serial> install -r android/app/build/outputs/apk/release/app-release.apk`.

- [ ] **Step 3: Maintainer opens the real file** through "More" → storage icon → Drive → their `.kdbx`, unlocks with the master password, and confirms biometrics when prompted.

- [ ] **Step 4: Measure and record**

| Check | Target | Result |
|---|---|---|
| Biometric confirmation → list visible | ≤ 1.5 s (else native Argon2 becomes a follow-up task) | |
| Edit on phone → visible on Mac | record the time | |
| Edit on Mac → visible on phone after resume | record the time | |
| Parallel edit on both, then sync | both edits present, nothing lost | |
| Tap on password copies; preview masked; cleared after 30 s | yes | |
| Back from details → list; back from list → background; reopen needs no restart | yes | |
| New fingerprint enrolled → one-line message → password → biometrics work again | yes | |
| Airplane mode, open the app: the cached copy opens and is marked unsynced; edits sync after reconnecting | yes | |
| One day of real use without restarting the app | yes | |

Timing: measure unlock with `adb logcat -s chromium` plus a `console.time`-style log. Add a temporary `logger.info('unlock-ms', ...)` only if needed, and remove it before committing.

- [ ] **Step 5: Decide follow-ups from the results**

- Sync too slow or unreliable → direct Drive API follow-up (spec "Known risk").
- Unlock above 1.5 s → native Argon2 follow-up.
- Collect the maintainer's list of further frictions for the next plan.

- [ ] **Step 6: Commit the acceptance record**

```bash
git add docs/superpowers/plans/2026-09-30-android-app-acceptance.md
git commit -m "docs(android): record device acceptance results"
```

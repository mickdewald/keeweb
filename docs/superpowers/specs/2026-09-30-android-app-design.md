# KeeWeb for Android Design

**Status:** Draft for review (2026-09-30)

## Goal

Replace Keepass2Android on the maintainer's Android phone with this fork of
KeeWeb, so that the Mac and the phone run the same client with the same design,
behaviour and fixes.

Keepass2Android's core functions are adequate. Its problems are in handling:

- the design and handling do not suit the maintainer;
- biometric unlock sometimes fails after an intermediate prompt, and the app
  has to be closed and reopened before it works again;
- tapping a password does not copy it; a confirmation dialog comes first;
- many further small frictions that add up.

The Android app therefore has to be at least as reliable as Keepass2Android
for everyday use (open, find, copy, edit, sync) and remove these frictions. It
does not need feature parity.

## Existing State

- The fork is a web application (`app/`, built by Grunt into a single
  `dist/index.html`) wrapped by Electron (`desktop/`) for macOS.
- The KeePass database lives in Google Drive. Changes made on one device are
  visible on the other shortly afterwards; this sync behaviour must be kept.
- The Google Drive storage (`app/scripts/storage/impl/storage-gdrive.js`) uses
  the `drive.file` scope, Drive revisions (`headRevisionId`) for conflict
  detection, and KeeWeb's KDBX merge on conflict. Tokens are obtained through
  a browser OAuth popup (`storage-base.js`, `_oauthAuthorize`).
- The Google OAuth clients currently in use belong to the upstream KeeWeb
  Cloud project (`const/cloud-storage-apps.js`), unless custom
  `gdriveClientId`/`gdriveClientSecret` settings are set.
- Touch ID on macOS stores a hardware-encrypted copy of the master password
  (`encryptedPassword`, settings `deviceOwnerAuth` and
  `deviceOwnerAuthTimeoutMinutes`) and decrypts it through
  `NativeModules.hardwareEncrypt` / `hardwareDecrypt`. `TouchIdRecovery`
  handles a key that can no longer decrypt.
- Copying goes through `comp/browser/copy-paste.js`. With a launcher that
  supports the clipboard (`simpleCopy`), the text is written natively and
  cleared after `clipboardSeconds`.
- `Launcher` (`comp/launcher`) is defined only under Electron. About 67 call
  sites treat "`Launcher` is set" as "desktop app with a Node file system and
  native modules".

### Feasibility Spike (2026-09-30)

A throwaway APK hosted `dist/` in a plain Android WebView (the runtime
Capacitor uses) on an API 34 emulator. A test database with 300 entries,
Argon2id, 64 MiB and 10 iterations, was opened through the Android document
picker. Results:

| Check | Result |
|---|---|
| Unlock (Enter to rendered list) | 1.3 s with WASM Argon2, emulator on a heavily loaded host |
| Tap entry to details | 13 ms |
| Tap on the "Password" label | copies immediately, no dialog |
| Clipboard preview | KeeWeb's copy shows the password in plain text in Android's preview; a native copy with `ClipDescription.EXTRA_IS_SENSITIVE` shows dots |
| Detail title | wraps after every few characters (title box shrinks to 77 px) |
| Android back button | leaves the app; on restart, `SingleInstanceChecker` shows "Too many tabs" |

Not testable in the spike: Google sign-in, biometrics, and performance on real
hardware.

## Design Principles

1. **One code base.** Android is a third shell beside the browser and Electron,
   not a fork of the fork. Web-layer changes must keep the macOS app working.
2. **Browser semantics plus explicit Android capabilities.** On Android,
   `Launcher` stays undefined, so no desktop branch (Node file system, native
   host, auto-type, updater) is reached by accident. Android features are
   reached through a separate, narrow platform bridge.
3. **Reuse existing contracts.** Biometric unlock implements the same
   `hardwareEncrypt`/`hardwareDecrypt` contract as Touch ID. Clipboard handling
   plugs into `CopyPaste.simpleCopy`. Google Drive keeps its storage code and
   only swaps how a token is obtained.
4. **No dead ends.** Every failure in unlock or sign-in ends in a usable state
   with a clear message and a way forward (typically the master-password field,
   focused). Nothing ever requires killing and restarting the app.
5. **No secrets in the build.** No passwords, tokens, OAuth secrets, keystore
   passwords or databases in the APK, in `capacitor.config.*` or in the
   repository.

## Architecture

```
app/ (shared web UI, built by Grunt)
  scripts/comp/platform/android/   new: bridge wrappers, Android-only behaviour
android/                           new: Capacitor Android project
  app/src/main/java/.../keeweb/
    BiometricCryptoPlugin          Keystore + BiometricPrompt
    SecureClipboardPlugin          sensitive copy + timed clearing
    GoogleDriveAuthPlugin          Google Identity Authorization API
    MainActivity                   FLAG_SECURE, back button, lifecycle
capacitor.config.json              webDir: dist, no server.url in release
```

- **Shell:** [Capacitor](https://capacitorjs.com) with its bundled Android
  WebView. `webDir` is the Grunt build output. The version is pinned in the
  implementation plan.
- **Platform detection:** a single module,
  `comp/platform/android/android-platform.js`, exposes `isAndroid` (from
  `window.Capacitor?.getPlatform() === 'android'`) and typed wrappers around
  the three plugins. No other module touches `window.Capacitor` directly.
- **Native plugins:** local Capacitor plugins in `android/app`, no separately
  published npm packages. Each plugin has one responsibility and a promise
  interface.

### Web Build Differences on Android

The Grunt flag `--android` produces the same `dist/` with these
differences only:

- no service-worker registration and no web update check (`updater.js`), since
  APK installs handle updates;
- `SingleInstanceChecker` disabled (one WebView per process);
- Android behaviours from `comp/platform/android` initialised at start.

## Components

### 1. Biometric Unlock (`BiometricCryptoPlugin`)

- **Key:** an AES-256-GCM key in the Android Keystore with
  `setUserAuthenticationRequired(true)`, authentication valid for a single use
  (`setUserAuthenticationParameters(0, BIOMETRIC_STRONG)`), and
  `setInvalidatedByBiometricEnrollment(true)`. The key is StrongBox-backed
  where available and TEE-backed otherwise.
- **Operations:** `encrypt`, `decrypt(prompt)` and `deleteKey` mirror
  `NativeModules.hardwareEncrypt`, `hardwareDecrypt` and
  `hardwareCryptoDeleteKey`. Values cross the bridge as base64 and are wrapped
  back into `kdbxweb.ProtectedValue` on the JS side.
- **Integration:** `NativeModules` gets an Android implementation that provides
  exactly these three functions. The open-view flow (`open-view-operations.js`,
  `app-model-file-open.js`) stays unchanged apart from choosing the
  implementation.
- **Default on Android:** `deviceOwnerAuth = 'file'`, so the encrypted master
  password survives Android killing the process. `deviceOwnerAuthTimeoutMinutes`
  keeps its meaning: how often the master password is required anyway.
- **Error paths:**
  - User cancels the prompt: the master-password field is shown, focused, with
    the keyboard open.
  - Key invalidated (new fingerprint enrolled, screen lock removed): a one-line
    explanation ("Biometrics changed, enter the master password once"), the
    password field, and after a successful unlock the password is encrypted
    again silently. This reuses `TouchIdRecovery` semantics.
  - Too many attempts or biometric lockout: the same as cancel, plus the
    system's message.
- **Automatic prompt:** when the app starts or returns in a locked state and a
  biometric password exists for the last file, the prompt appears without an
  extra tap. It appears at most once per resume; afterwards a button offers it
  again.

### 2. Tap-to-Copy (`SecureClipboardPlugin`)

- **Bridge:** `copy(text, { sensitive: true, clearAfterSeconds })` and
  `clearIfUnchanged()`.
- **Sensitive flag:** set on API 33 and newer. Older versions copy normally,
  with no preview in any case.
- **Clearing:** after `clipboardSeconds` (Android default 30 s), only if the
  clipboard still holds the copied value. Clearing runs natively so that it
  also works while the WebView is paused in the background.
- **Integration:** `CopyPaste.simpleCopy` becomes true on Android, and
  `CopyPaste.copy` delegates to the bridge. The existing "copied" toast stays.
- **UX change on touch devices:** a single tap on the **value** of User,
  Password, URL or one-time code copies it. A long press opens the existing
  field action bar (copy, edit, show, generate). A tap on the label keeps
  copying. This applies when `Features.isMobile` is true, so mobile browsers
  benefit too.

### 3. Google Drive Sign-In (`GoogleDriveAuthPlugin`)

- **Why native:** Google rejects OAuth inside embedded WebViews, and new
  Android OAuth clients no longer support custom URI-scheme redirects. The
  token is therefore obtained natively through the Google Identity Services
  Authorization API (`Identity.getAuthorizationClient(...).authorize(...)`),
  using the phone's Google account and the `drive.file` scope.
- **Bridge:** `authorize({ interactive })` returns
  `{ accessToken, expiresInSeconds }`, and `revoke()`. No refresh token ever
  reaches JavaScript. When a token expires, a silent `authorize` fetches a new
  one.
- **Integration:** `StorageGDrive` overrides token acquisition on Android.
  `_oauthAuthorize` and `_oauthGetNewToken` call the bridge instead of opening
  a popup. The resulting token goes through the existing
  `_oauthMsgToToken`/`runtimeData` path. Drive REST calls, revision checks,
  merge and the IndexedDB offline cache stay unchanged.
- **Google Cloud project (maintainer action):** create a dedicated project for
  the fork containing:
  - an Android OAuth client for `com.mickdewald.keeweb` with the SHA-1 of the
    release signing key (and the debug key for development);
  - a Desktop OAuth client that the macOS fork uses through the existing
    `gdriveClientId`/`gdriveClientSecret` settings, entered at runtime and not
    committed.

  `drive.file` grants are per Cloud project, so the Mac and the phone must use
  clients from the same project to see the same file.
- **One-time migration (maintainer, guided):**
  1. Back up the current `.kdbx` (download from Drive).
  2. In the macOS fork, switch to the new Desktop client and save the open
     database to Google Drive as a new file. The new project can then access
     that file.
  3. Open that file on Android.
  4. Rename the old file in Drive (for example `…-before-migration.kdbx`), but
     keep it.

  Keepass2Android keeps working with the new file through its own Drive
  access during the transition.

### 4. Android Lifecycle and Navigation (`MainActivity` + JS)

- **Back button:** handled in JS through Capacitor's `backButton` event, in
  this order:
  1. close an open modal, dropdown or field action bar;
  2. go from details back to the list;
  3. clear an active search;
  4. otherwise move the task to the background (`moveTaskToBack`) instead of
     finishing the activity.

  The back button never destroys the open database.
- **Background and lock:** `appStateChange` maps to the existing settings.
  Going to the background counts as "minimise" (`lockOnMinimize`), and
  `idleMinutes` keeps working. Locking uses the existing lock flow, and
  returning to a locked app triggers the automatic biometric prompt (component
  1).
- **Screen protection:** `FLAG_SECURE` is set at all times, so no screenshots
  are possible and the recent-apps thumbnail is blank.
- **WebView hardening:**
  - no file or content URL access beyond the picker;
  - navigation restricted to the app origin;
  - external links open in the system browser (Custom Tab);
  - remote debugging only in debug builds.

### 5. Mobile Layout Fixes (Shared Web Code)

Version 1 fixes only what blocks daily use on a phone. It is not a redesign.

- The detail title no longer wraps per character (flex sizing in
  `_details.scss`; the root cause is pinned in the plan).
- Safe-area insets (status bar, gesture bar) are respected.
- The unlock screen: the password placeholder must not overlap the Enter icon,
  and the field is focused automatically when no biometric password exists.
- A short list of further frictions, collected in the first week of real use,
  goes into a follow-up plan rather than this one.

## Out of Scope (Version 1)

- the Android Autofill service and a custom keyboard (IME); Keepass2Android can
  stay installed for autofill until a follow-up covers it;
- storages other than Google Drive (Dropbox, OneDrive, WebDAV, local files):
  they may work but are not tested or supported;
- YubiKey challenge-response, auto-type, the browser-extension connector and
  the plugin gallery;
- iOS and Play Store distribution;
- native Argon2, which is added only if the device measurement below misses its
  target (the `NativeModules.argon2` contract already exists).

## Build, Signing and Installation

- **Commands:**
  - `npm run build:android`: Grunt web build with the Android flag, then
    `cap sync android`, then Gradle `assembleRelease`;
  - `npm run dev:android`: debug build loading the Grunt dev server through
    `adb reverse`.
- **Application ID:** `com.mickdewald.keeweb`. A debug build uses the suffix
  `.dev` so that both builds can be installed side by side.
- **Release signing:** a dedicated, stable Android keystore kept outside the
  repository. Its password comes from the macOS Keychain or OpenBao at build
  time, as the notarization lane does. A lost or rotated key breaks in-place
  updates and changes the OAuth SHA-1, so the key is backed up.
- **Installation:** version 1 installs with `adb install -r` from the Mac. A
  private update channel, like the macOS one, is a follow-up.
- **CI:** version 1 builds the APK locally only; web unit tests keep running in
  the existing CI. An Android CI lane is a follow-up, and it must not run
  Gradle on the self-hosted runners on the maintainer's Mac.

## Testing

- **Web unit tests (existing mocha runner, `test/src`):**
  - back-button state machine: each state leads to the expected action and
    never finishes the activity while a file is open;
  - the `CopyPaste` Android path with a stubbed bridge: sensitive flag and
    clear timeout are passed through;
  - touch copy: a tap on a value copies and a long press opens the action bar;
  - `StorageGDrive` token acquisition with a stubbed bridge, including 401 →
    silent refresh → retry;
  - the biometric error paths map to "password field focused" states.
- **Native unit tests (JVM):** the plugin argument and response mapping and
  the base64 round trip.
- **Instrumented tests (emulator):** Keystore encrypt/decrypt round trip with
  an emulator fingerprint (`adb -e emu finger touch`), key invalidation after
  enrolling a new fingerprint, and the clipboard sensitive flag and clearing.
- **End-to-end on the emulator:** a scripted flow over the WebView DevTools
  protocol, as in the spike. It covers open test DB → unlock → search → copy →
  back → background → resume, and runs against generated test databases only
  (`spike-test`-style credentials created by the test itself).
- **Physical device acceptance (the maintainer's phone):**
  - Google sign-in and the migrated file sync both ways with the Mac: edit on
    the phone and see it on the Mac, and the reverse;
  - biometric unlock;
  - unlock time with the maintainer's real KDF parameters: target ≤ 1.5 s from
    biometric confirmation to list, otherwise native Argon2 moves into scope;
  - one day of real use without an app restart being needed.

## Acceptance Criteria

1. A password is copied with one tap and the Android preview does not reveal
   it. It is cleared after the configured time.
2. Returning to the locked app shows the biometric prompt automatically. Cancel
   or failure always leads to a focused password field. No path needs an app
   restart.
3. The back button never closes the open database. From details it returns to
   the list.
4. Edits on the phone reach the Mac through Google Drive and the reverse, with
   conflicts merged as on the Mac today.
5. The macOS app builds and passes its existing tests unchanged in behaviour.
6. The APK contains no credentials. A check greps the built APK and the
   Capacitor config for credential-shaped values and fails the build.

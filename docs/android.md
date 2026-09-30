# KeeWeb for Android

A Capacitor 8 wrapper around the KeeWeb web app. Application ID `com.mickdewald.keeweb`; the debug build is
`com.mickdewald.keeweb.dev` and installs side by side with the release build. Requires Android 11 (API 30) or newer.

All Gradle work needs JDK 21; the scripts source `scripts/android/env.sh` for you. Capacitor logging is off
(`loggingBehavior: none` in `capacitor.config.json`), so passwords never reach logcat.

## One-time keystore setup

Create the release keystore once, with the alias `keeweb`:

```sh
mkdir -p ~/.keeweb-android
keytool -genkeypair -keystore ~/.keeweb-android/release.jks -alias keeweb \
    -keyalg RSA -keysize 4096 -validity 10000
```

Store the keystore password in the macOS Keychain (the `-w` flag without a value prompts for it):

```sh
security add-generic-password -s keeweb-android-keystore -a "$USER" -w
```

Back the keystore up somewhere safe. If it is lost, releases can no longer update an installed app in place; the app
would have to be uninstalled first. Never commit the keystore and never print its password. To use another location,
set `KEEWEB_ANDROID_KEYSTORE`.

## Building

- Debug: `npm run android:debug` produces `android/app/build/outputs/apk/debug/app-debug.apk`.
- Release: `npm run build:android` builds the web app, syncs Capacitor, runs `assembleRelease` signed with the
  keystore (password read from the Keychain at build time only) and finishes with
  `scripts/android/check-apk-secrets.sh`. The script refuses to build from a dirty git tree.

For CI or agent test builds with a throwaway keystore, `KEEWEB_ANDROID_KEYSTORE_PASSWORD` may be set in the
environment to skip the Keychain lookup. Never do this with the real keystore, and never put its password on a command
line. The script passes it only to the Gradle signing step, and deletes the APK if the secret check fails.

`scripts/android/check-apk-secrets.sh <apk>` fails when the APK assets or `capacitor.config.json` contain
credential-shaped values or a `.kdbx` file. The web bundle legitimately contains the upstream OAuth client secrets from
`app/scripts/const/cloud-storage-apps.js` (public by design) and three identifier strings that match the pattern
(`ProtectPassword`, `dropboxAppSecret`, `changeShortLivedStorageToken`). Because the bundle is inlined into one
`index.html`, the script allows exactly those matched strings, each compared whole up to its closing quote instead of excluding a file. Anything else fails.

## Installing

```sh
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Emulator workflow

```sh
scripts/android/emulator.sh start        # headless dedicated AVD, prints nothing on success
node scripts/android/e2e-emulator.mjs    # E2E against test/android/fixtures (fake password e2e-fake-password)
node scripts/android/e2e-emulator.mjs --only unlock
(cd android && source ../scripts/android/env.sh && ./gradlew connectedDebugAndroidTest)   # instrumented tests
scripts/android/emulator.sh stop
```

E2E runs use only the committed fixture database, never a real one. Stop the Gradle daemon afterwards with
`./gradlew --stop`.

## First use

1. Open the menu "More" and tap the Android file storage icon.
2. In the system picker choose Drive and pick your `.kdbx` file.
3. Unlock it with the master password. The app then offers quick unlock with biometrics; accept to enable it. The
   master password is asked again after a week by default.

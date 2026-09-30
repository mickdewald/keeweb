#!/usr/bin/env bash
# scripts/android/build-release.sh: signed release APK, credentials read at build time only.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/android/env.sh
export KEEWEB_ANDROID_KEYSTORE="${KEEWEB_ANDROID_KEYSTORE:-$HOME/.keeweb-android/release.jks}"
if [ ! -f "$KEEWEB_ANDROID_KEYSTORE" ]; then
    echo "Keystore missing: $KEEWEB_ANDROID_KEYSTORE (see docs/android.md)" >&2
    exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to build a release from a dirty tree" >&2
    exit 1
fi
if [ -n "${KEEWEB_ANDROID_KEYSTORE_PASSWORD:-}" ]; then
    : # password supplied by the caller (CI-less override); never echoed
else
    KEEWEB_ANDROID_KEYSTORE_PASSWORD="$(security find-generic-password -s keeweb-android-keystore -w)"
fi
export KEEWEB_ANDROID_KEYSTORE_PASSWORD
npm run android:web
npx cap sync android
rc=0
(cd android && nice -n 10 ./gradlew assembleRelease) || rc=$?
(cd android && ./gradlew --stop) || true
[ "$rc" -eq 0 ] || exit "$rc"
bash scripts/android/check-apk-secrets.sh android/app/build/outputs/apk/release/app-release.apk
echo "Built android/app/build/outputs/apk/release/app-release.apk"

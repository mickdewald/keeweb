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
    pw="$KEEWEB_ANDROID_KEYSTORE_PASSWORD"
else
    pw="$(security find-generic-password -s keeweb-android-keystore -w)"
fi
# Keep the password out of the environment of npm, cap and everything but the Gradle signing step.
unset KEEWEB_ANDROID_KEYSTORE_PASSWORD
npm run android:web
npx cap sync android
APK=android/app/build/outputs/apk/release/app-release.apk
rc=0
(cd android && KEEWEB_ANDROID_KEYSTORE_PASSWORD="$pw" nice -n 10 ./gradlew assembleRelease) || rc=$?
(cd android && ./gradlew --stop) || true
[ "$rc" -eq 0 ] || exit "$rc"
if ! bash scripts/android/check-apk-secrets.sh "$APK"; then
    rm -f "$APK"
    echo "Secret check failed; removed $APK" >&2
    exit 1
fi
echo "Built $APK"

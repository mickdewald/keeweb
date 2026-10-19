#!/usr/bin/env bash
# Invoked only by ops-platform's Android signing runner after it has injected
# the ephemeral KEEWEB_ANDROID_KEYSTORE variables for this child process.
set +x
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$ROOT/android"

: "${KEEWEB_ANDROID_KEYSTORE:?OpenBao signing runner did not provide KEEWEB_ANDROID_KEYSTORE}"
: "${KEEWEB_ANDROID_KEYSTORE_PASSWORD:?OpenBao signing runner did not provide KEEWEB_ANDROID_KEYSTORE_PASSWORD}"
: "${KEEWEB_ANDROID_CERT_SHA256:?OpenBao signing runner did not provide KEEWEB_ANDROID_CERT_SHA256}"
[[ "$KEEWEB_ANDROID_CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
    echo "OpenBao signing runner provided an invalid KEEWEB_ANDROID_CERT_SHA256" >&2
    exit 1
}

nice -n 10 ./gradlew --no-daemon assembleRelease

APK=app/build/outputs/apk/release/app-release.apk
apksigner=""
for candidate in "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/apksigner; do
    [[ -x "$candidate" ]] && apksigner="$candidate"
done
[[ -n "$apksigner" ]] || {
    echo "Android SDK apksigner not found" >&2
    exit 1
}
actual_cert_sha256="$("$apksigner" verify --print-certs "$APK" | awk -F ': ' '/^Signer #[0-9]+ certificate SHA-256 digest: / { print tolower($2) }')"
[[ "$actual_cert_sha256" == "$KEEWEB_ANDROID_CERT_SHA256" ]] || {
    echo "Release APK certificate does not match the OpenBao signing certificate" >&2
    exit 1
}

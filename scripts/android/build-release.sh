#!/usr/bin/env bash
# Build a signed release APK. The OpenBao runner materializes signing data only
# for scripts/android/assemble-release.sh, never for the web or Capacitor steps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$ROOT"

die() {
    echo "$*" >&2
    exit 1
}

require_ops_platform() {
    local ops origin status
    ops="${OPS_PLATFORM_ROOT:-$HOME/projects/ops-platform}"
    [[ "$ops" == /* ]] || die "OPS_PLATFORM_ROOT must be an absolute path: $ops"
    [[ -d "$ops" ]] || die "ops-platform checkout not found: $ops (set OPS_PLATFORM_ROOT)."
    [[ -f "$ops/scripts/spark_release/android_signing_exec.py" ]] ||
        die "ops-platform checkout $ops has no Android signing runner; update it to origin/main."
    origin="$(git -C "$ops" remote get-url origin 2>/dev/null || true)"
    [[ "$origin" =~ ^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)mickdewald/ops-platform(\.git)?$ ]] ||
        die "ops-platform checkout $ops has an unexpected origin (expected github.com/mickdewald/ops-platform)."
    status="$(git -C "$ops" status --porcelain 2>/dev/null)" ||
        die "ops-platform checkout $ops is not a readable git checkout."
    [[ -z "$status" ]] || die "ops-platform checkout $ops is dirty; the signing runner must come from a clean checkout."
    git -C "$ops" merge-base --is-ancestor HEAD refs/remotes/origin/main 2>/dev/null ||
        die "ops-platform checkout $ops HEAD is not contained in origin/main; the signing runner must be reviewed code."
    OPS_PLATFORM_ROOT="$ops"
}

if [ -n "$(git status --porcelain)" ]; then
    die "Refusing to build a release from a dirty tree"
fi

# Signing inputs are owned by the OpenBao runner. Do not let a caller's local
# environment reach npm, Capacitor, or Gradle as an undocumented fallback.
for signing_var in ${!KEEWEB_ANDROID_@} ${!TURBO_RN_RELEASE_@} ${!BAO_@} ${!VAULT_@}; do
    unset "$signing_var"
done
unset signing_var
source scripts/android/env.sh
require_ops_platform
APK=android/app/build/outputs/apk/release/app-release.apk
rm -f "$APK"
npm run android:web
npx cap sync android

if ! PYTHONPATH="$OPS_PLATFORM_ROOT" python3 -P -m scripts.spark_release.android_signing_exec \
    --machine-identity android-release-signing \
    --repo keeweb \
    --app keeweb \
    run -- "$ROOT/scripts/android/assemble-release.sh"; then
    rm -f "$APK"
    die "Android signing runner failed; removed $APK"
fi

if ! bash scripts/android/check-apk-secrets.sh "$APK"; then
    rm -f "$APK"
    die "Secret check failed; removed $APK"
fi
echo "Built $APK"

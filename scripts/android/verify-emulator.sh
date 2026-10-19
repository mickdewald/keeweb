#!/usr/bin/env bash
# Keep emulator and test processes in one supervised session, including cleanup on failure.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/android/env.sh
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SERIAL="$(bash scripts/android/emulator.sh serial)"
export KEEWEB_SERIAL="$ANDROID_SERIAL"
started=0
cleanup() {
    rc=$?
    trap - EXIT
    (cd android && ./gradlew --stop) >/dev/null 2>&1 || true
    if [ "$started" = 1 ]; then
        bash scripts/android/emulator.sh stop >/dev/null 2>&1 || true
    fi
    exit "$rc"
}
trap cleanup EXIT
npm run android:debug
bash scripts/android/emulator.sh start
started=1
bash scripts/android/assert-fixture-device.sh "$ANDROID_SERIAL"
# This fixture AVD uses the test PIN from the Android plan. sys.boot_completed
# does not mean credential-encrypted app storage is unlocked after a cold boot.
for _ in $(seq 1 30); do
    if "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell dumpsys user | grep -q 'State: RUNNING_UNLOCKED'; then
        break
    fi
    # GateKeeper can still be starting even after sys.boot_completed is set.
    "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell locksettings verify \
        --old "${KEEWEB_EMULATOR_PIN:-1111}" >/dev/null 2>&1 || true
    sleep 1
done
"$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell dumpsys user | grep -q 'State: RUNNING_UNLOCKED' || {
    echo "Fixture emulator storage is still locked; check KEEWEB_EMULATOR_PIN" >&2
    exit 1
}
bash scripts/android/assert-fixture-device.sh "$ANDROID_SERIAL"
# Verifying GateKeeper unlocks credential storage, but leaves secure keyguard visible.
# Clipboard reads require the app's window to actually own foreground focus.
"$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell svc power stayon true
if "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell dumpsys window | grep -q 'isKeyguardShowing=true'; then
    "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell input keyevent KEYCODE_WAKEUP
    "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell wm dismiss-keyguard
    "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell input keyevent 82
    sleep 1
    "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell input text "${KEEWEB_EMULATOR_PIN:-1111}"
    "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell input keyevent 66
fi
for _ in $(seq 1 10); do
    if "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell dumpsys window | grep -q 'isKeyguardShowing=false'; then
        break
    fi
    sleep 1
done
"$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" shell dumpsys window | grep -q 'isKeyguardShowing=false' || {
    echo "Fixture emulator keyguard is still showing; check KEEWEB_EMULATOR_PIN" >&2
    exit 1
}
(cd android && python3 -c 'import subprocess; subprocess.run(["./gradlew", ":app:connectedDebugAndroidTest"], check=True, timeout=180)')
# Gradle may remove instrumented APKs on completion; reinstall the debug lane in place for E2E.
"$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" install -r android/app/build/outputs/apk/debug/app-debug.apk
node scripts/android/e2e-emulator.mjs
bash scripts/android/check-apk-secrets.sh android/app/build/outputs/apk/debug/app-debug.apk

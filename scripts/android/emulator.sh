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
        if "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
            echo "Emulator port $PORT is already in use; reuse it explicitly or choose KEEWEB_EMU_PORT" >&2
            exit 1
        fi
        if ! "$SDK/emulator/emulator" -list-avds | grep -qx "$AVD"; then
            echo "AVD $AVD missing; create it with avdmanager (system-images;android-34;google_apis_playstore;arm64-v8a)" >&2
            exit 1
        fi
        log="$(mktemp "${TMPDIR:-/tmp/}keeweb-emulator.${PORT}.XXXXXX")"
        nohup nice -n 10 "$SDK/emulator/emulator" -avd "$AVD" -port "$PORT" -no-window -no-audio \
            -no-boot-anim -gpu host -feature -Vulkan -memory 4096 -no-snapshot >"$log" 2>&1 &
        emulator_pid=$!
        trap 'kill "$emulator_pid" 2>/dev/null || true' EXIT
        for _ in $(seq 1 90); do
            if [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
                trap - EXIT
                exit 0
            fi
            sleep 2
        done
        echo "emulator did not boot, see $log" >&2
        exit 1
        ;;
    stop) "$ADB" -s "$SERIAL" emu kill ;;
    serial) echo "$SERIAL" ;;
    *) echo "usage: $0 start|stop|serial" >&2; exit 2 ;;
esac

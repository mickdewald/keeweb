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

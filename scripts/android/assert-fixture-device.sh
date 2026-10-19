#!/usr/bin/env bash
# AGP connected tests can target all connected devices, unlike adb -s.
set -euo pipefail
serial="${1:?fixture emulator serial required}"
adb="${ANDROID_HOME:?ANDROID_HOME required}/platform-tools/adb"
if [[ ! "$serial" =~ ^emulator-[0-9]+$ ]]; then
    echo "Instrumentation requires a fixture emulator" >&2
    exit 1
fi
devices="$("$adb" devices | awk 'NR > 1 && NF >= 2 { print $1 "\t" $2 }')"
if [ "$devices" != "$serial"$'\tdevice' ]; then
    echo "Instrumentation requires the fixture emulator to be the only connected device; disconnect other devices" >&2
    exit 1
fi

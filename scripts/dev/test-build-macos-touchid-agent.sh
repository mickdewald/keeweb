#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TRACE="$(bash -x "$SCRIPT_DIR/build-macos-touchid-agent.sh" --help 2>&1)"

if [[ "$TRACE" != *"DEPLOY_PATH=/Applications/KeeWeb.app"* ]]; then
    echo "Expected the default deploy target to be /Applications/KeeWeb.app" >&2
    exit 1
fi

if [[ "$TRACE" != *"default: /Applications/KeeWeb.app"* ]]; then
    echo "Expected --help to document the KeeWeb.app deploy target" >&2
    exit 1
fi

if bash "$SCRIPT_DIR/build-macos-touchid-agent.sh" --backup --help >/dev/null 2>&1; then
    echo "The removed --backup option must be rejected" >&2
    exit 1
fi

BUILD_SCRIPT="$(<"$SCRIPT_DIR/build-macos-touchid-agent.sh")"
if [[ "$BUILD_SCRIPT" == *"BACKUP_ON_DEPLOY"* || "$BUILD_SCRIPT" == *"-backup-"* || "$TRACE" == *"--backup"* ]]; then
    echo "The deploy script must not create or advertise app backups" >&2
    exit 1
fi

APP_SOURCE="$(<"$SCRIPT_DIR/../../app/scripts/app.js")"

if [[ "$BUILD_SCRIPT" == *"build-darwin-installer"* || "$BUILD_SCRIPT" == *"desktop-darwin-installer-helper"* ]]; then
    echo "The private macOS build must not embed KeeWeb's privileged installer" >&2
    exit 1
fi

if [[ "$BUILD_SCRIPT" != *'APP_BUILD_PATH/Contents/Installer'* ]]; then
    echo "The private macOS build must reject an embedded installer before deploy" >&2
    exit 1
fi

if [[ "$BUILD_SCRIPT" != *'tmp/desktop/app/scripts/update-installer.js'* ]]; then
    echo "The private macOS build must strip the unused update-installer runtime" >&2
    exit 1
fi

if [[ "$BUILD_SCRIPT" != *'Run once: sudo chown -R'* ]]; then
    echo "A legacy root-owned app must stop with a one-time migration command" >&2
    exit 1
fi

if [[ "$BUILD_SCRIPT" == *'pkill -9'* ]]; then
    echo "The deploy script must not force-kill a KeeWeb session" >&2
    exit 1
fi

if [[ "$BUILD_SCRIPT" == *'--force'* || "$BUILD_SCRIPT" == *'--kill'* ]]; then
    echo "The deploy script must not add a kill override" >&2
    exit 1
fi

python3 - "$SCRIPT_DIR/build-macos-touchid-agent.sh" <<'PY'
import sys
script = open(sys.argv[1], encoding='utf-8').read()
deploy = script.split('if [[ "$DO_DEPLOY" -eq 1 ]]; then', 1)
if len(deploy) != 2:
    raise SystemExit('deploy section is missing')
body = deploy[1]
steps = [
    'check-installed-app-compatibility.js inspect',
    'check-private-update-deploy.js',
    'check-installed-app-compatibility.js verify-candidate',
    'check-installed-app-compatibility.js compatibility',
    'check-installed-app-compatibility.js session',
    'check-installed-app-compatibility.js recheck',
    'stop_running_app',
    'rm -rf "$DEPLOY_PATH"',
    'ditto "$APP_BUILD_PATH" "$DEPLOY_PATH"',
    'open -n "$DEPLOY_PATH"',
]
positions = []
for step in steps:
    index = body.find(step)
    if index < 0:
        raise SystemExit(f'missing deploy step: {step}')
    positions.append(index)
if positions != sorted(positions):
    raise SystemExit('deploy guard order is wrong: inspect/verify/compat/session/recheck must precede stop/delete/copy/open')
if 'pkill' in body.split('stop_running_app', 1)[0]:
    raise SystemExit('session detection must not pkill KeeWeb')
PY

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/keeweb-deploy-guard.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/build/KeeWeb.app/Contents/Resources" "$WORK/KeeWeb.app/Contents"
printf 'sentinel\n' > "$WORK/KeeWeb.app/Contents/sentinel"
set +e
TRACE="$(
    KEEWEB_APP_BUILD_PATH="$WORK/build/KeeWeb.app" \
        bash -x "$SCRIPT_DIR/build-macos-touchid-agent.sh" \
            --skip-build --no-open --deploy-path "$WORK/KeeWeb.app" 2>&1
)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "an invalid candidate must be rejected"
[[ -f "$WORK/KeeWeb.app/Contents/sentinel" ]] || fail "rejection deleted the installed target"
printf '%s\n' "$TRACE" | grep -Fq 'check-installed-app-compatibility.js inspect' ||
    fail "rejection must inspect the installed target first"
executed_stop="$(printf '%s\n' "$TRACE" | grep -E '^\++ stop_running_app$' || true)"
executed_rm="$(printf '%s\n' "$TRACE" | grep -E '^\++ rm -rf ' || true)"
executed_ditto="$(printf '%s\n' "$TRACE" | grep -E '^\++ ditto ' || true)"
executed_open="$(printf '%s\n' "$TRACE" | grep -E '^\++ open ' || true)"
executed_osascript="$(printf '%s\n' "$TRACE" | grep -E '^\++ (/usr/bin/)?osascript ' || true)"
executed_pkill="$(printf '%s\n' "$TRACE" | grep -E '^\++ pkill ' || true)"
[[ -z "$executed_stop" ]] || fail "rejection called stop_running_app"
[[ -z "$executed_rm" ]] || fail "rejection deleted the target: $executed_rm"
[[ -z "$executed_ditto" ]] || fail "rejection copied the candidate: $executed_ditto"
[[ -z "$executed_open" ]] || fail "rejection launched KeeWeb: $executed_open"
[[ -z "$executed_osascript" ]] || fail "rejection sent Apple Events: $executed_osascript"
[[ -z "$executed_pkill" ]] || fail "rejection killed KeeWeb: $executed_pkill"

if [[ "$APP_SOURCE" == *"AppRightsChecker"* ]]; then
    echo "The private fork must not start KeeWeb's root ownership checker" >&2
    exit 1
fi

if [[ -e "$SCRIPT_DIR/../../app/scripts/comp/app/app-rights-checker.js" ]]; then
    echo "The private fork must not ship the root ownership checker" >&2
    exit 1
fi

echo "macOS deploy policy test passed"

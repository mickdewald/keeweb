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

if [[ "$APP_SOURCE" == *"AppRightsChecker"* ]]; then
    echo "The private fork must not start KeeWeb's root ownership checker" >&2
    exit 1
fi

if [[ -e "$SCRIPT_DIR/../../app/scripts/comp/app/app-rights-checker.js" ]]; then
    echo "The private fork must not ship the root ownership checker" >&2
    exit 1
fi

echo "macOS deploy policy test passed"

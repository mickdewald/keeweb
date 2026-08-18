#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TRACE="$(bash -x "$SCRIPT_DIR/build-macos-touchid-agent.sh" --help 2>&1)"
BACKUP_TRACE="$(bash -x "$SCRIPT_DIR/build-macos-touchid-agent.sh" --backup --help 2>&1 || true)"

if [[ "$TRACE" != *"DEPLOY_PATH=/Applications/KeeWeb-Codex.app"* ]]; then
    echo "Expected the default deploy target to be /Applications/KeeWeb-Codex.app" >&2
    exit 1
fi

if [[ "$TRACE" != *"default: /Applications/KeeWeb-Codex.app"* ]]; then
    echo "Expected --help to document the KeeWeb-Codex.app deploy target" >&2
    exit 1
fi

if [[ "$TRACE" != *"BACKUP_ON_DEPLOY=0"* ]]; then
    echo "Expected app backups to be disabled by default" >&2
    exit 1
fi

if [[ "$BACKUP_TRACE" != *"BACKUP_ON_DEPLOY=1"* ]]; then
    echo "Expected --backup to enable an explicit app backup" >&2
    exit 1
fi

if [[ "$BACKUP_TRACE" != *"--backup"* ]]; then
    echo "Expected --help to document the explicit backup opt-in" >&2
    exit 1
fi

echo "macOS deploy policy test passed"

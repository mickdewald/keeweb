#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TRACE="$(bash -x "$SCRIPT_DIR/build-macos-touchid-agent.sh" --help 2>&1)"

if [[ "$TRACE" != *"DEPLOY_PATH=/Applications/KeeWeb-Codex.app"* ]]; then
    echo "Expected the default deploy target to be /Applications/KeeWeb-Codex.app" >&2
    exit 1
fi

if [[ "$TRACE" != *"default: /Applications/KeeWeb-Codex.app"* ]]; then
    echo "Expected --help to document the KeeWeb-Codex.app deploy target" >&2
    exit 1
fi

echo "macOS deploy target test passed"

#!/usr/bin/env bash
set -euo pipefail

# Updates Electron to the given version (default: latest stable), installs it,
# and runs the test suite. Deploy afterwards with build-macos-touchid-agent.sh.
#
# Usage: scripts/dev/update-electron.sh [version]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT_DIR"

REQUIRED_NODE_VERSION="$(tr -d '[[:space:]]' < "$ROOT_DIR/.nvmrc")"
REQUIRED_NODE_MAJOR="${REQUIRED_NODE_VERSION#v}"
REQUIRED_NODE_MAJOR="${REQUIRED_NODE_MAJOR%%.*}"
if [[ ! "$REQUIRED_NODE_MAJOR" =~ ^[0-9]+$ ]]; then
    echo "Invalid Node version in $ROOT_DIR/.nvmrc: $REQUIRED_NODE_MAJOR" >&2
    exit 1
fi

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.nvm/nvm.sh"
    nvm use "$REQUIRED_NODE_VERSION" >/dev/null 2>&1 || true
fi

CURRENT_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ "$CURRENT_NODE_MAJOR" != "$REQUIRED_NODE_MAJOR" ]]; then
    echo "KeeWeb's Electron update flow requires Node $REQUIRED_NODE_MAJOR from .nvmrc. Current node: $(node --version 2>/dev/null || echo missing)" >&2
    echo "Install/use Node $REQUIRED_NODE_MAJOR before running this script." >&2
    exit 1
fi

VERSION="${1:-$(npm view electron dist-tags.latest)}"
CURRENT="$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo none)"

echo "Electron: $CURRENT -> $VERSION"
if [[ "$CURRENT" == "$VERSION" ]]; then
    echo "Already up to date."
    exit 0
fi

npm install --save-exact --no-audit --no-fund "electron@$VERSION"
npm approve-scripts electron >/dev/null 2>&1 || true
if [[ ! -d node_modules/electron/dist/Electron.app ]]; then
    (cd node_modules/electron && node install.js)
fi
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --version

export NODE_OPTIONS=--openssl-legacy-provider
export CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npx grunt build-test
npx grunt run-test

cat <<'EOF'

Next steps:
  1. Deploy: ./scripts/dev/build-macos-touchid-agent.sh
  2. Test in the app: Touch ID unlock, save, Cmd+K.
  3. macOS will re-ask keychain permissions once (new binary signature) - click "Always Allow".
  4. Commit package.json + package-lock.json.
EOF

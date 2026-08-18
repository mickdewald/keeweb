#!/usr/bin/env bash
set -euo pipefail

# Updates Electron to the given version (default: latest stable), installs it,
# and runs the test suite. Deploy afterwards with build-macos-touchid-agent.sh.
#
# Usage: scripts/dev/update-electron.sh [version]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT_DIR"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.nvm/nvm.sh"
    nvm use 20.5.1 >/dev/null 2>&1 || nvm use 20 >/dev/null 2>&1 || true
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
  1. Deploy: ./scripts/dev/build-macos-touchid-agent.sh --deploy-path /Applications/KeeWeb-Codex.app
     (keep the automatic backup on major version jumps)
  2. Test in the app: Touch ID unlock, save, Cmd+K.
  3. macOS will re-ask keychain permissions once (new binary signature) - click "Always Allow".
  4. Commit package.json + package-lock.json.
EOF

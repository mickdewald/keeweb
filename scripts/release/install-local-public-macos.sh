#!/usr/bin/env bash
# Install a verified local public build without Finder or forced termination.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR/../.."
source "$SCRIPT_DIR/public-macos-lib.sh"

[[ $# -eq 1 ]] || die "Usage: $0 /path/to/KeeWeb.app"
[[ "$(uname -s)" == Darwin ]] || die "macOS is required"
[[ -d "$1" && ! -L "$1" ]] || die "Source must be a real app bundle"
APP_SOURCE="$(cd "$1" && pwd -P)"
TARGET=/Applications/KeeWeb.app
[[ "$APP_SOURCE" != "$TARGET" ]] || die "Source is already installed"
[[ -d "$TARGET" && ! -L "$TARGET" ]] || die "Expected an existing KeeWeb installation"
ensure_node_runtime

verify_app() {
    node - "$1" <<'NODE'
const app = process.argv[2];
require('./scripts/release/verify-update-app').verifyUpdateApp(app, 'public');
require('./scripts/release/provisioning-profile').verifyEmbeddedProfile(app);
const metadata = JSON.parse(require('asar').extractFile(
    app + '/Contents/Resources/app.asar', 'private-update-build.json'
));
if (metadata.channel !== 'public' || metadata.smoke || !metadata.build) {
    throw new Error('Expected a non-smoke public build');
}
NODE
    /usr/sbin/spctl --assess --type execute "$1"
}

verify_app "$APP_SOURCE"
verify_app "$TARGET"
requirement() { /usr/bin/codesign -d -r- "$1" 2>&1 | sed -n 's/^designated => //p'; }
SOURCE_REQUIREMENT="$(requirement "$APP_SOURCE")"
[[ -n "$SOURCE_REQUIREMENT" && "$SOURCE_REQUIREMENT" == "$(requirement "$TARGET")" ]] ||
    die "Designated requirements differ; refusing to change the saved privacy identity"

STAGING="$(mktemp -d /Applications/.keeweb-install.XXXXXX)"
REPLACED=0
SUCCESS=0
cleanup() {
    local status=$?
    if [[ "$SUCCESS" -eq 0 && -d "$STAGING/previous.app" ]]; then
        if [[ "$REPLACED" -eq 1 ]]; then rm -rf "$TARGET"; fi
        mv "$STAGING/previous.app" "$TARGET" || {
            echo "Restore failed; previous app remains at $STAGING/previous.app" >&2
            exit 1
        }
    fi
    rm -rf "$STAGING"
    exit "$status"
}
trap cleanup EXIT
ditto "$APP_SOURCE" "$STAGING/KeeWeb.app"
verify_app "$STAGING/KeeWeb.app"

running() { pgrep -f '^/Applications/KeeWeb[.]app/Contents/MacOS/KeeWeb($| )' >/dev/null; }
if running; then
    osascript -e 'tell application "/Applications/KeeWeb.app" to quit'
    for ((attempt=0; attempt<30; attempt++)); do
        if ! running; then break; fi
        sleep 1
    done
    if running; then die "KeeWeb is still running; installation cancelled without forcing quit"; fi
fi
mv "$TARGET" "$STAGING/previous.app"
mv "$STAGING/KeeWeb.app" "$TARGET"
REPLACED=1
verify_app "$TARGET"
cmp "$APP_SOURCE/Contents/Resources/app.asar" "$TARGET/Contents/Resources/app.asar"
SUCCESS=1
open "$TARGET"
echo "Verified public build installed: $TARGET"

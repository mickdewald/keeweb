#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/dev/build-macos-touchid-agent.sh [options]

Builds a signed arm64 KeeWeb macOS dev app with Touch ID support and deploys it.

Options:
  --deploy-path <path>   Target app path (default: /Applications/KeeWeb.app)
  --skip-build           Skip build/sign, only deploy from existing tmp build app
  --skip-deploy          Build/sign only, do not copy to /Applications
  --updater-smoke        Build an isolated updater test fixture; never deploy
  --no-open              Do not open app after deploy
  -h, --help             Show this help
EOF
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

DEPLOY_PATH="${DEPLOY_PATH:-/Applications/KeeWeb.app}"
DO_BUILD=1
DO_DEPLOY=1
OPEN_AFTER_DEPLOY=1
UPDATER_SMOKE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --deploy-path)
            DEPLOY_PATH="${2:-}"
            shift 2
            ;;
        --updater-smoke)
            UPDATER_SMOKE=1
            DO_DEPLOY=0
            shift
            ;;
        --skip-build)
            DO_BUILD=0
            shift
            ;;
        --skip-deploy)
            DO_DEPLOY=0
            shift
            ;;
        --no-open)
            OPEN_AFTER_DEPLOY=0
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This script only supports macOS." >&2
    exit 1
fi

require_cmd npm
require_cmd npx
require_cmd security
require_cmd /usr/bin/codesign
require_cmd ditto
require_cmd xattr

ensure_node_runtime() {
    local major

    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    if [[ "$major" == "20" ]]; then
        return 0
    fi

    if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
        # shellcheck disable=SC1091
        source "$HOME/.nvm/nvm.sh"
        nvm use 20.5.1 >/dev/null 2>&1 || nvm use 20 >/dev/null 2>&1 || true
        major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    fi

    if [[ "$major" != "20" ]]; then
        echo "KeeWeb's macOS packaging flow requires Node 20. Current node: $(node --version 2>/dev/null || echo missing)" >&2
        echo "Install/use Node 20 before running this script." >&2
        exit 1
    fi
}

ensure_node_runtime

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT_DIR"

APP_BUILD_PATH="${KEEWEB_APP_BUILD_PATH:-tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app}"
CODESIGN_JSON="keys/codesign.json"
PROVISIONING_PROFILE="keys/keeweb.provisionprofile"
ENTITLEMENTS_FILE="package/osx/entitlements.plist"

if [[ ! -f "$ENTITLEMENTS_FILE" ]]; then
    echo "Missing entitlements file: $ENTITLEMENTS_FILE" >&2
    exit 1
fi

APP_ID_FULL="$(
    grep -A1 'com.apple.application-identifier' "$ENTITLEMENTS_FILE" \
    | tail -n1 \
    | sed -E 's/.*<string>([^<]+)<\/string>.*/\1/'
)"
if [[ -z "$APP_ID_FULL" || "$APP_ID_FULL" == "$ENTITLEMENTS_FILE" ]]; then
    echo "Could not read app identifier from $ENTITLEMENTS_FILE" >&2
    exit 1
fi

TEAM_ID="${APP_ID_FULL%%.*}"
APP_BUNDLE_ID="${APP_ID_FULL#*.}"
SMOKE_ARGS=(--no-updater-smoke)
if [[ "$UPDATER_SMOKE" -eq 1 ]]; then
    APP_BUNDLE_ID="${APP_BUNDLE_ID}.updater-smoke"
    SMOKE_ARGS=(--updater-smoke)
fi

stop_running_app() {
    if /usr/bin/pgrep -f "$DEPLOY_PATH/Contents/MacOS/KeeWeb" >/dev/null 2>&1; then
        echo "KeeWeb is still running at $DEPLOY_PATH. Close it normally (save or cancel) before replacing the app." >&2
        exit 1
    fi
}

if [[ ! -d node_modules ]]; then
    echo "node_modules missing, running npm ci..."
    npm ci
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
    mkdir -p keys

    if [[ ! -f "$CODESIGN_JSON" ]]; then
        IDENTITY_NAME="$(
            security find-identity -v -p codesigning \
            | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' \
            | head -n1
        )"
        if [[ -z "$IDENTITY_NAME" ]]; then
            echo "No Apple Development signing identity found in keychain." >&2
            exit 1
        fi

        cat > "$CODESIGN_JSON" <<EOF
{
  "identities": {
    "app": "$IDENTITY_NAME"
  },
  "teamId": "$TEAM_ID",
  "appleId": ""
}
EOF
        echo "Created $CODESIGN_JSON"
    fi

    if [[ ! -f "$PROVISIONING_PROFILE" ]]; then
        FALLBACK_PROVISIONING_PROFILE="$DEPLOY_PATH/Contents/embedded.provisionprofile"
        INSTALLED_CHANNEL=""
        if [[ -f "$FALLBACK_PROVISIONING_PROFILE" ]]; then
            INSTALLED_CHANNEL="$(
                node scripts/dev/check-installed-app-compatibility.js inspect "$DEPLOY_PATH" 2>/dev/null \
                    | sed -n 's/^Installed channel: //p'
            )" || true
        fi
        if [[ "$INSTALLED_CHANNEL" == "development" && -f "$FALLBACK_PROVISIONING_PROFILE" ]]; then
            cp "$FALLBACK_PROVISIONING_PROFILE" "$PROVISIONING_PROFILE"
            echo "Copied provisioning profile to $PROVISIONING_PROFILE"
        elif [[ -f "$FALLBACK_PROVISIONING_PROFILE" ]]; then
            echo "Missing $PROVISIONING_PROFILE; will not copy a non-development installed profile." >&2
            exit 1
        else
            echo "Missing $PROVISIONING_PROFILE and no fallback profile at $FALLBACK_PROVISIONING_PROFILE" >&2
            exit 1
        fi
    fi

    export NODE_OPTIONS=--openssl-legacy-provider
    npx grunt \
        default \
        build-desktop-app-content

    node scripts/dev/write-update-build.js tmp/desktop/app/private-update-build.json --channel development
    if [[ "$UPDATER_SMOKE" -eq 1 ]]; then
        cp scripts/dev/private-updater-smoke-entry.js tmp/desktop/app/main.js
        node -e 'const fs=require("fs");const p="tmp/desktop/app/private-update-build.json";const data=JSON.parse(fs.readFileSync(p));data.smoke=true;fs.writeFileSync(p,JSON.stringify(data));'
    fi
    rm -f tmp/desktop/app/scripts/update-installer.js

    npx grunt \
        electron:darwin-arm64 \
        copy:native-modules-darwin-arm64 \
        copy:native-messaging-host-darwin-arm64 \
        osx-sign:desktop-arm64 \
        "${SMOKE_ARGS[@]}" \
        --app-bundle-id="$APP_BUNDLE_ID" \
        --provisioning-profile="./$PROVISIONING_PROFILE"
fi

if [[ ! -d "$APP_BUILD_PATH" ]]; then
    echo "Build output missing: $APP_BUILD_PATH" >&2
    exit 1
fi

if [[ -e "$APP_BUILD_PATH/Contents/Installer" ]]; then
    echo "Private KeeWeb build unexpectedly contains the privileged installer" >&2
    exit 1
fi

if [[ "$DO_DEPLOY" -eq 1 ]]; then
    SNAPSHOT_FILE="$(mktemp -t keeweb-install-snapshot)"
    chmod 600 "$SNAPSHOT_FILE"
    cleanup_deploy_guard() {
        rm -f "$SNAPSHOT_FILE"
    }
    trap cleanup_deploy_guard EXIT

    node scripts/dev/check-installed-app-compatibility.js inspect "$DEPLOY_PATH" --write-snapshot "$SNAPSHOT_FILE"
    node scripts/dev/check-private-update-deploy.js "$APP_BUILD_PATH"
    node scripts/dev/check-installed-app-compatibility.js verify-candidate "$APP_BUILD_PATH"
    node scripts/dev/check-installed-app-compatibility.js compatibility "$DEPLOY_PATH" "$APP_BUILD_PATH"
    node scripts/dev/check-installed-app-compatibility.js session "$DEPLOY_PATH"
    node scripts/dev/check-installed-app-compatibility.js recheck "$DEPLOY_PATH" "$SNAPSHOT_FILE"

    stop_running_app

    if [[ -d "$DEPLOY_PATH" && ! -w "$DEPLOY_PATH" ]]; then
        echo "Existing app is not writable; refusing to leave a second KeeWeb copy in /Applications." >&2
        printf 'Run once: sudo chown -R %q:admin %q\n' "$(id -un)" "$DEPLOY_PATH" >&2
        exit 1
    fi

    rm -rf "$DEPLOY_PATH"

    ditto "$APP_BUILD_PATH" "$DEPLOY_PATH"
    xattr -cr "$DEPLOY_PATH"
    /usr/bin/codesign --verify --deep --strict --verbose=4 "$DEPLOY_PATH" >/dev/null
    echo "Deployed signed app to $DEPLOY_PATH"

    if [[ "$OPEN_AFTER_DEPLOY" -eq 1 ]]; then
        open -n "$DEPLOY_PATH"
    fi
else
    echo "Build finished at $APP_BUILD_PATH"
fi

echo "Bundle ID: $APP_BUNDLE_ID"
echo "Team ID: $TEAM_ID"

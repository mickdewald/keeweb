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
  --no-backup            Replace the target app without creating a backup
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
BACKUP_ON_DEPLOY="${BACKUP_ON_DEPLOY:-1}"
OPEN_AFTER_DEPLOY=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --deploy-path)
            DEPLOY_PATH="${2:-}"
            shift 2
            ;;
        --skip-build)
            DO_BUILD=0
            shift
            ;;
        --skip-deploy)
            DO_DEPLOY=0
            shift
            ;;
        --no-backup)
            BACKUP_ON_DEPLOY=0
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

APP_BUILD_PATH="tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app"
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

next_backup_deploy_path() {
    local app_path="$1"
    local timestamp app_dir app_name candidate counter

    timestamp="$(date +%Y-%m-%d-%H-%M)"
    app_dir="$(dirname "$app_path")"
    app_name="$(basename "$app_path" .app)"
    candidate="${app_dir}/${app_name}-backup-${timestamp}.app"
    counter=1

    while [[ -e "$candidate" ]]; do
        candidate="${app_dir}/${app_name}-backup-${timestamp}-$(printf '%02d' "$counter").app"
        counter=$((counter + 1))
    done

    printf '%s\n' "$candidate"
}

stop_running_app() {
    /usr/bin/osascript -e "tell application id \"${APP_BUNDLE_ID}\" to quit" >/dev/null 2>&1 || true
    pkill -f "$DEPLOY_PATH/Contents/MacOS/KeeWeb" >/dev/null 2>&1 || true

    local attempt
    for attempt in {1..20}; do
        if ! pgrep -f "$DEPLOY_PATH/Contents/MacOS/KeeWeb" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.1
    done

    pkill -9 -f "$DEPLOY_PATH/Contents/MacOS/KeeWeb" >/dev/null 2>&1 || true
}

if [[ ! -d node_modules ]]; then
    echo "node_modules missing, running npm ci..."
    npm ci
fi

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
    if [[ -f /Applications/KeeWeb.app/Contents/embedded.provisionprofile ]]; then
        cp /Applications/KeeWeb.app/Contents/embedded.provisionprofile "$PROVISIONING_PROFILE"
        echo "Copied provisioning profile to $PROVISIONING_PROFILE"
    else
        echo "Missing $PROVISIONING_PROFILE and no fallback profile at /Applications/KeeWeb.app/Contents/embedded.provisionprofile" >&2
        exit 1
    fi
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
    export NODE_OPTIONS=--openssl-legacy-provider
    npx grunt \
        default \
        build-desktop-app-content \
        electron:darwin-arm64 \
        electron-patch:darwin-arm64 \
        build-darwin-installer \
        copy:desktop-darwin-installer-helper-arm64 \
        copy:native-modules-darwin-arm64 \
        copy:native-messaging-host-darwin-arm64 \
        osx-sign:desktop-arm64 \
        --app-bundle-id="$APP_BUNDLE_ID" \
        --provisioning-profile="./$PROVISIONING_PROFILE"
fi

if [[ ! -d "$APP_BUILD_PATH" ]]; then
    echo "Build output missing: $APP_BUILD_PATH" >&2
    exit 1
fi

if [[ "$DO_DEPLOY" -eq 1 ]]; then
    stop_running_app

    if [[ "$BACKUP_ON_DEPLOY" -eq 1 && -d "$DEPLOY_PATH" ]]; then
        BACKUP_PATH="$(next_backup_deploy_path "$DEPLOY_PATH")"
        mv "$DEPLOY_PATH" "$BACKUP_PATH"
        echo "Backup created: $BACKUP_PATH"
    else
        rm -rf "$DEPLOY_PATH"
    fi

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

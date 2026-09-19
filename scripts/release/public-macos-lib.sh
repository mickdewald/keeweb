#!/usr/bin/env bash
# Shared, fail-closed building blocks of the public Developer ID lane. Sourced by
# build-public-macos.sh and test-public-updater.sh so that release builds and the
# updater acceptance fixtures go through exactly the same signing code.

PUBLIC_IDENTITY="Developer ID Application: Michael Dewald (GGYLL32K99)"
PUBLIC_TEAM_ID="GGYLL32K99"
PUBLIC_BUNDLE_ID="com.mickdewald.keeweb"
PUBLIC_APP_BUILD_PATH="tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app"

die() {
    echo "$1" >&2
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

ensure_node_runtime() {
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    if [[ "$major" != "20" && -s "$HOME/.nvm/nvm.sh" ]]; then
        # shellcheck disable=SC1091
        source "$HOME/.nvm/nvm.sh"
        nvm use 20.5.1 >/dev/null 2>&1 || nvm use 20 >/dev/null 2>&1 || true
        major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    fi
    [[ "$major" == "20" ]] || die "KeeWeb's macOS packaging flow requires Node 20."
}

# Exactly one valid keychain identity with the exact common name; no fallback.
require_public_identity() {
    local matches
    matches="$(security find-identity -v -p codesigning | grep -cF "\"$PUBLIC_IDENTITY\"" || true)"
    [[ "$matches" == "1" ]] ||
        die "Expected exactly one valid '$PUBLIC_IDENTITY' identity in the keychain, found $matches. Refusing to sign."
}

# Writes an isolated signing config and exports KEEWEB_CODESIGN_CONFIG. The
# maintainer's development signing config under keys/ is never read or modified.
use_public_signing_config() {
    local directory="$1"
    cat > "$directory/codesign.json" <<JSON
{
  "identities": { "app": "$PUBLIC_IDENTITY" },
  "teamId": "$PUBLIC_TEAM_ID",
  "appleId": ""
}
JSON
    export KEEWEB_CODESIGN_CONFIG="$directory/codesign.json"
}

# build_public_app <bundle-id> <smoke: 0|1> [absolute provisioning profile]
build_public_app() {
    local bundle_id="$1" smoke="$2" profile="${3:-}"
    local -a sign_args=(--no-updater-smoke "--provisioning-profile=$profile")
    [[ -n "${KEEWEB_CODESIGN_CONFIG:-}" ]] || die "Public signing config is not configured"
    export NODE_OPTIONS=--openssl-legacy-provider
    npx grunt default build-desktop-app-content
    node scripts/dev/write-update-build.js tmp/desktop/app/private-update-build.json --channel public
    if [[ "${PUBLIC_REQUIRE_CLEAN_METADATA:-0}" -eq 1 ]]; then
        # Stop before signing and two notarizations if the tree became dirty meanwhile.
        node -e 'if (require("./tmp/desktop/app/private-update-build.json").clean !== true) process.exit(1)' ||
            die "The tree became dirty during the build; refusing to continue a release build."
    fi
    if [[ "$smoke" -eq 1 ]]; then
        sign_args=(--updater-smoke)
        cp scripts/dev/private-updater-smoke-entry.js tmp/desktop/app/main.js
        node -e 'const fs=require("fs");const p="tmp/desktop/app/private-update-build.json";const data=JSON.parse(fs.readFileSync(p));data.smoke=true;fs.writeFileSync(p,JSON.stringify(data));'
    elif [[ -z "$profile" ]]; then
        die "Production public builds require the Developer ID provisioning profile"
    fi
    rm -f tmp/desktop/app/scripts/update-installer.js
    npx grunt \
        electron:darwin-arm64 \
        copy:native-modules-darwin-arm64 \
        copy:native-messaging-host-darwin-arm64 \
        osx-sign:desktop-arm64 \
        "${sign_args[@]}" \
        --app-bundle-id="$bundle_id"
    [[ -d "$PUBLIC_APP_BUILD_PATH" ]] || die "Build output missing: $PUBLIC_APP_BUILD_PATH"
    [[ ! -e "$PUBLIC_APP_BUILD_PATH/Contents/Installer" ]] ||
        die "Public KeeWeb build unexpectedly contains the privileged installer"
}

# notarize_and_staple <app-or-dmg> <keychain profile> <scratch directory>
notarize_and_staple() {
    local target="$1" keychain_profile="$2" scratch="$3" submission="$1" result status
    if [[ -d "$target" ]]; then
        submission="$scratch/$(basename "$target").notarize.zip"
        ditto -c -k --sequesterRsrc --keepParent "$target" "$submission"
    fi
    result="$(xcrun notarytool submit "$submission" --keychain-profile "$keychain_profile" --wait --output-format json)"
    status="$(node -p 'JSON.parse(process.argv[1]).status' "$result")"
    if [[ "$status" != "Accepted" ]]; then
        echo "$result" >&2
        die "Apple notarization was not accepted for $(basename "$target") (status: $status)"
    fi
    xcrun stapler staple "$target"
    xcrun stapler validate "$target"
}

# Gatekeeper must report a notarized Developer ID origin, not merely "accepted".
assess_gatekeeper() {
    local kind="$1" target="$2" output
    local -a args=(--assess --type execute)
    [[ "$kind" == "dmg" ]] && args=(--assess --type open --context context:primary-signature)
    output="$(spctl "${args[@]}" -vv "$target" 2>&1)" || {
        echo "$output" >&2
        die "Gatekeeper rejected $(basename "$target")"
    }
    [[ "$output" == *"source=Notarized Developer ID"* && "$output" == *"($PUBLIC_TEAM_ID)"* ]] || {
        echo "$output" >&2
        die "Gatekeeper did not confirm a notarized Developer ID origin for $(basename "$target")"
    }
}

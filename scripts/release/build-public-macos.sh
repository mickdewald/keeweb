#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: scripts/release/build-public-macos.sh [options]

Builds the public KeeWeb fork release for Apple silicon: Developer ID signing with
Hardened Runtime, Apple notarization and stapling of the app and the DMG,
Gatekeeper assessment, and a prepared release directory. Nothing is uploaded,
installed or launched.

Options:
  --output-root <path>  Prepared release root (default: .release-artifacts/public)
  --local-draft         Allow a dirty tree. Produces only a notarized DMG marked
                        LOCAL-DRAFT for acceptance and no release metadata. A
                        dirty-tree build is refused by release preparation.
  --preflight-only      Run the fail-closed preflight checks and exit
  -h, --help            Show this help

Environment:
  KEEWEB_PUBLIC_PROVISIONING_PROFILE  Developer ID provisioning profile for
      com.mickdewald.keeweb (default: keys/keeweb-developer-id.provisionprofile)
  KEEWEB_NOTARY_AUTH                  Notary credential source, no fallback between modes
      (default: openbao-machine):
        openbao-machine   ops-platform notary runner, machine identity
                          release-signing; KEEWEB_NOTARY_PROFILE must be unset
        keychain-profile  legacy: xcrun notarytool with KEEWEB_NOTARY_PROFILE
  KEEWEB_NOTARY_PROFILE               notarytool keychain profile for keychain-profile
                                      (default: mick-notary)
  OPS_PLATFORM_DIR                    Absolute path of a clean ops-platform checkout on
                                      origin/main for openbao-machine
                                      (default: $HOME/projects/ops-platform)
  KEEWEB_RELEASE_BUILD                Optional pinned UTC build ID (YYYYMMDDhhmmss)
USAGE
}

OUTPUT_ROOT=".release-artifacts/public"
LOCAL_DRAFT=0
PREFLIGHT_ONLY=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --output-root)
            OUTPUT_ROOT="${2:-}"
            [[ -n "$OUTPUT_ROOT" ]] || { usage >&2; exit 1; }
            shift 2
            ;;
        --local-draft) LOCAL_DRAFT=1; shift ;;
        --preflight-only) PREFLIGHT_ONLY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/release/public-macos-lib.sh
source "$SCRIPT_DIR/public-macos-lib.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
cd "$ROOT_DIR"
resolve_notary_auth

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || die "The public lane requires an Apple silicon Mac."
for cmd in git node npm npx security xcrun ditto hdiutil spctl /usr/bin/codesign; do
    require_cmd "$cmd"
done
ensure_node_runtime
require_notary_backend

PROFILE="${KEEWEB_PUBLIC_PROVISIONING_PROFILE:-keys/keeweb-developer-id.provisionprofile}"
[[ "$PROFILE" == /* ]] || PROFILE="$ROOT_DIR/$PROFILE"

# --- preflight: every gate fails closed before anything is packaged ---------
if [[ -n "$(git status --porcelain)" && "$LOCAL_DRAFT" -ne 1 ]]; then
    die "Public releases require a clean tree. Commit first, or pass --local-draft for an unpublishable acceptance artifact."
fi
require_public_identity
[[ -f "$PROFILE" ]] ||
    die "Missing Developer ID provisioning profile: $PROFILE (KeeWeb's Touch ID entitlements are restricted and need it)."
node scripts/release/provisioning-profile.js "$PROFILE" ||
    die "The provisioning profile is not a valid Developer ID profile for $PUBLIC_BUNDLE_ID."
notary_preflight
if [[ "$PREFLIGHT_ONLY" -eq 1 ]]; then
    echo "Public release preflight passed"
    exit 0
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/keeweb-public-build.XXXXXX")"
MOUNT=""
cleanup() {
    [[ -z "$MOUNT" ]] || hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT
use_public_signing_config "$WORK"

# --- build, sign, verify every nested signature ------------------------------
[[ "$LOCAL_DRAFT" -eq 1 ]] || export PUBLIC_REQUIRE_CLEAN_METADATA=1
build_public_app "$PUBLIC_BUNDLE_ID" 0 "$PROFILE"
APP="$ROOT_DIR/$PUBLIC_APP_BUILD_PATH"
verify_public_app() {
    node -e '
        const { verifyUpdateApp } = require("./scripts/release/verify-update-app");
        const { verifyEmbeddedProfile } = require("./scripts/release/provisioning-profile");
        verifyUpdateApp(process.argv[1], "public");
        verifyEmbeddedProfile(process.argv[1], process.argv[2] || undefined);
    ' "$1" "${2:-}"
}
verify_public_app "$APP" "$PROFILE"
MINIMUM_MACOS="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist")"
[[ "$MINIMUM_MACOS" == "12.0" ]] || die "Public builds must declare macOS 12.0 as minimum, found: $MINIMUM_MACOS"

# --- app: notarize, staple, Gatekeeper ---------------------------------------
notarize_and_staple "$APP" "$WORK"
verify_public_app "$APP" "$PROFILE"
assess_gatekeeper app "$APP"

# --- DMG: drag-install image, sign, notarize, staple, Gatekeeper --------------
# hdiutil keeps the lane free of the optional DMG layout plugin, which cannot be
# installed from the lockfile on the required Node 20 runtime.
mkdir -p "$WORK/dmg-root"
ditto "$APP" "$WORK/dmg-root/KeeWeb.app"
ln -s /Applications "$WORK/dmg-root/Applications"
DMG="$WORK/KeeWeb-macos-arm64.dmg"
hdiutil create -volname "KeeWeb Michael Dewald Fork" -srcfolder "$WORK/dmg-root" \
    -fs HFS+ -format UDZO -ov -quiet "$DMG"
/usr/bin/codesign --sign "$PUBLIC_IDENTITY" --timestamp --identifier "$PUBLIC_BUNDLE_ID.dmg" "$DMG"
notarize_and_staple "$DMG" "$WORK"
/usr/bin/codesign --verify --strict --verbose=2 "$DMG"
assess_gatekeeper dmg "$DMG"

# --- the app a user actually receives: copied out of the mounted DMG ----------
MOUNT="$WORK/mount"
mkdir -p "$MOUNT" "$WORK/copied"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" -quiet
[[ -d "$MOUNT/KeeWeb.app" && "$(readlink "$MOUNT/Applications")" == "/Applications" ]] ||
    die "Unexpected DMG contents"
UNEXPECTED="$(find "$MOUNT" -mindepth 1 -maxdepth 1 ! -name KeeWeb.app ! -name Applications ! -name '.fseventsd' ! -name '.Trashes' -print)"
[[ -z "$UNEXPECTED" ]] || die "Unexpected DMG contents: $UNEXPECTED"
ditto "$MOUNT/KeeWeb.app" "$WORK/copied/KeeWeb.app"
hdiutil detach "$MOUNT" -quiet
MOUNT=""
verify_public_app "$WORK/copied/KeeWeb.app" "$PROFILE"
xcrun stapler validate "$WORK/copied/KeeWeb.app"
assess_gatekeeper app "$WORK/copied/KeeWeb.app"

BUILD_ID="$(node -p 'require("asar").extractFile(process.argv[1] + "/Contents/Resources/app.asar", "private-update-build.json").toString()' "$APP" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).build')"
if [[ "$LOCAL_DRAFT" -eq 1 ]]; then
    DRAFT_DIR="$ROOT_DIR/.release-artifacts/public-draft/$BUILD_ID"
    mkdir -p "$DRAFT_DIR"
    cp "$DMG" "$DRAFT_DIR/KeeWeb-$BUILD_ID-macos-arm64-LOCAL-DRAFT.dmg"
    (cd "$DRAFT_DIR" && shasum -a 256 "KeeWeb-$BUILD_ID-macos-arm64-LOCAL-DRAFT.dmg" > "KeeWeb-$BUILD_ID-macos-arm64-LOCAL-DRAFT.dmg.sha256")
    echo "LOCAL DRAFT for acceptance only. No release metadata was prepared; do not publish this artifact." > "$DRAFT_DIR/LOCAL-DRAFT-DO-NOT-PUBLISH.txt"
    echo "Local draft (unpublishable): $DRAFT_DIR"
    exit 0
fi

node scripts/release/prepare-public-release.js "$WORK/copied/KeeWeb.app" "$DMG" "$OUTPUT_ROOT"
echo "Public release prepared. Publication is a separate, explicit gate."

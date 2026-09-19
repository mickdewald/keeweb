#!/usr/bin/env bash
# Isolated Developer ID updater acceptance: build N discovers, downloads, verifies
# and installs build N+1 of the public channel, and keeps build N when the update's
# signature is invalid. Uses the smoke fixture entrypoint (never KeeWeb itself), an
# isolated bundle ID, loopback-only traffic and private scratch directories.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/release/public-macos-lib.sh
source "$SCRIPT_DIR/public-macos-lib.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
cd "$ROOT_DIR"

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || die "The public lane requires an Apple silicon Mac."
for cmd in git node npx security ditto /usr/bin/codesign; do
    require_cmd "$cmd"
done
ensure_node_runtime
require_public_identity

SMOKE_BUNDLE_ID="${PUBLIC_BUNDLE_ID}.updater-smoke"
# Used only to prove that a validly signed update of another certificate is refused.
FOREIGN_IDENTITY="Apple Development: Michael Dewald (UUCWA5MCLV)"
OLD_BUILD="$(date -u +%Y%m%d%H%M%S)"
NEW_BUILD="$(date -u -v+1S +%Y%m%d%H%M%S)"
[[ "$NEW_BUILD" > "$OLD_BUILD" ]] || die "Fixture builds must strictly increase"

RUN_DIR="$ROOT_DIR/.updater-smoke/public/$OLD_BUILD"
rm -rf "$RUN_DIR"
mkdir -p "$RUN_DIR"
SIGNING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/keeweb-public-smoke.XXXXXX")"
APP_PID=""
cleanup() {
    [[ -z "$APP_PID" ]] || kill "$APP_PID" >/dev/null 2>&1 || true
    pkill -f "$RUN_DIR/" >/dev/null 2>&1 || true
    rm -rf "$SIGNING_DIR"
}
trap cleanup EXIT
use_public_signing_config "$SIGNING_DIR"

embedded_build() {
    node -p 'JSON.parse(require("asar").extractFile(process.argv[1] + "/Contents/Resources/app.asar", "private-update-build.json")).build' "$1"
}

require_developer_id_fixture() {
    local app="$1" info
    /usr/bin/codesign --verify --deep --strict \
        -R="identifier \"$SMOKE_BUNDLE_ID\" and anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$PUBLIC_TEAM_ID\"" \
        "$app"
    info="$(/usr/bin/codesign -d --verbose=4 "$app" 2>&1)"
    [[ "$info" == *"Authority=$PUBLIC_IDENTITY"* && "$info" == *"(runtime)"* ]] ||
        die "Fixture is not a hardened Developer ID build: $app"
}

build_fixture() {
    local build="$1" destination="$2"
    KEEWEB_RELEASE_BUILD="$build" build_public_app "$SMOKE_BUNDLE_ID" 1
    [[ "$(embedded_build "$PUBLIC_APP_BUILD_PATH")" == "$build" ]] || die "Fixture has the wrong build ID"
    require_developer_id_fixture "$PUBLIC_APP_BUILD_PATH"
    mkdir -p "$destination"
    ditto "$PUBLIC_APP_BUILD_PATH" "$destination/KeeWeb.app"
}

echo "== Building Developer ID fixtures $OLD_BUILD -> $NEW_BUILD"
KEEWEB_RELEASE_BUILD="$OLD_BUILD" build_fixture "$OLD_BUILD" "$RUN_DIR/old"
KEEWEB_RELEASE_BUILD="$NEW_BUILD" build_fixture "$NEW_BUILD" "$RUN_DIR/new"

echo "== Building a validly signed build N+1 of a foreign certificate"
[[ "$(security find-identity -v -p codesigning | grep -cF "\"$FOREIGN_IDENTITY\"" || true)" == "1" ]] ||
    die "The foreign-certificate fixture needs exactly one '$FOREIGN_IDENTITY' identity."
mkdir -p "$SIGNING_DIR/foreign" "$RUN_DIR/foreign-build"
printf '{"identities":{"app":"%s"},"teamId":"%s","appleId":""}\n' "$FOREIGN_IDENTITY" "$PUBLIC_TEAM_ID" > "$SIGNING_DIR/foreign/codesign.json"
(
    export KEEWEB_CODESIGN_CONFIG="$SIGNING_DIR/foreign/codesign.json"
    KEEWEB_RELEASE_BUILD="$NEW_BUILD" build_public_app "$SMOKE_BUNDLE_ID" 1
)
/usr/bin/codesign --verify --deep --strict "$PUBLIC_APP_BUILD_PATH"
[[ "$(/usr/bin/codesign -d --verbose=4 "$PUBLIC_APP_BUILD_PATH" 2>&1)" == *"Authority=$FOREIGN_IDENTITY"* ]] ||
    die "The foreign fixture is not signed by the foreign certificate"
ditto "$PUBLIC_APP_BUILD_PATH" "$RUN_DIR/foreign-build/KeeWeb.app"
ditto -c -k --sequesterRsrc --keepParent "$RUN_DIR/foreign-build/KeeWeb.app" "$RUN_DIR/foreign.zip"

# Valid archive, and an archive whose sealed resources were modified after signing.
ditto -c -k --sequesterRsrc --keepParent "$RUN_DIR/new/KeeWeb.app" "$RUN_DIR/valid.zip"
mkdir -p "$RUN_DIR/tampered"
ditto "$RUN_DIR/new/KeeWeb.app" "$RUN_DIR/tampered/KeeWeb.app"
printf 'tampered after signing' >> "$RUN_DIR/tampered/KeeWeb.app/Contents/Resources/app.asar"
if /usr/bin/codesign --verify --deep --strict "$RUN_DIR/tampered/KeeWeb.app" >/dev/null 2>&1; then
    die "The tampered fixture unexpectedly still has a valid signature"
fi
ditto -c -k --sequesterRsrc --keepParent "$RUN_DIR/tampered/KeeWeb.app" "$RUN_DIR/invalid.zip"

# A genuine public-channel feed document for build N+1 (production-shaped URLs).
write_feed() {
    node -e '
        const fs = require("fs");
        const crypto = require("crypto");
        const [archive, build, output] = process.argv.slice(1);
        const base = `https://downloads.michaeldewald.com/keeweb/public/arm64/${build}/`;
        fs.writeFileSync(output, JSON.stringify({
            schema: 1, bundleId: "com.mickdewald.keeweb", arch: "arm64", build, version: "smoke",
            url: `${base}KeeWeb.zip`, updateURL: `${base}update.json`,
            sha256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex")
        }));
    ' "$1" "$NEW_BUILD" "$2"
}

# run_case <name> <archive>: launches a private copy of build N and waits for it to exit.
run_case() {
    local name="$1" archive="$2" directory="$RUN_DIR/$1"
    mkdir -p "$directory/userData"
    ditto "$RUN_DIR/old/KeeWeb.app" "$directory/KeeWeb.app"
    write_feed "$archive" "$directory/feed.json"
    node -e '
        const [file, directory, archive, from, to] = process.argv.slice(1);
        require("fs").writeFileSync(file, JSON.stringify({
            userData: `${directory}/userData`, result: `${directory}/result.jsonl`,
            feed: `${directory}/feed.json`, archive, fromBuild: from, toBuild: to
        }));
    ' "$directory/smoke.json" "$directory" "$archive" "$OLD_BUILD" "$NEW_BUILD"
    : > "$directory/result.jsonl"
    "$directory/KeeWeb.app/Contents/MacOS/KeeWeb" "--user-data-dir=$directory/userData" >"$directory/app.log" 2>&1 &
    APP_PID=$!
    local waited=0
    while (( waited < 180 )); do
        if grep -q '"stage":"updated"' "$directory/result.jsonl" ||
            { ! kill -0 "$APP_PID" 2>/dev/null && grep -q '"error"' "$directory/result.jsonl"; }; then
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done
    sleep 3
    pkill -f "$directory/" >/dev/null 2>&1 || true
    APP_PID=""
}

has_stage() {
    grep -q "\"stage\":\"$2\"" "$RUN_DIR/$1/result.jsonl"
}

echo "== Negative case: invalid signature must be rejected and build N preserved"
run_case invalid "$RUN_DIR/invalid.zip"
require_rejection() {
    local name="$1"
    has_stage "$name" discovered || die "Case $name did not discover the update"
    has_stage "$name" sha256-verified || die "Case $name did not reach checksum verification"
    ! has_stage "$name" updated || die "Case $name installed a rejected update"
    # Only Squirrel's code signature validation counts, not an arbitrary updater error.
    grep -q '"error":"Private updater: Code signature at URL .* did not pass validation' "$RUN_DIR/$name/result.jsonl" ||
        die "Case $name was not rejected by code signature validation"
    /usr/bin/codesign --verify --deep --strict "$RUN_DIR/$name/KeeWeb.app"
    require_developer_id_fixture "$RUN_DIR/$name/KeeWeb.app"
    [[ "$(embedded_build "$RUN_DIR/$name/KeeWeb.app")" == "$OLD_BUILD" ]] || die "Case $name did not preserve build N"
}
require_rejection invalid

echo "== Negative case: a valid signature of another certificate must be rejected"
run_case foreign "$RUN_DIR/foreign.zip"
require_rejection foreign

echo "== Positive case: valid Developer ID update installs and launches build N+1"
run_case valid "$RUN_DIR/valid.zip"
has_stage valid discovered || die "Positive case did not discover the update"
has_stage valid sha256-verified || die "Positive case did not verify the checksum"
has_stage valid updated || die "The valid update was not installed and relaunched"
grep -q "\"stage\":\"launch\",\"build\":\"$NEW_BUILD\"" "$RUN_DIR/valid/result.jsonl" || die "Build N+1 did not launch"
require_developer_id_fixture "$RUN_DIR/valid/KeeWeb.app"
[[ "$(embedded_build "$RUN_DIR/valid/KeeWeb.app")" == "$NEW_BUILD" ]] || die "Installed bundle is not build N+1"

node -e '
    const [file, from, to, identity] = process.argv.slice(1);
    require("fs").writeFileSync(file, JSON.stringify({
        channel: "public", identity, fromBuild: from, toBuild: to,
        discovered: true, sha256Verified: true, invalidSignatureRejected: true,
        foreignSignatureRejected: true, oldBuildPreserved: true, validUpdateInstalled: true, newBuildLaunched: true
    }, null, 2) + "\n");
' "$RUN_DIR/evidence.json" "$OLD_BUILD" "$NEW_BUILD" "$PUBLIC_IDENTITY"
echo "Public updater acceptance passed: $RUN_DIR/evidence.json"

#!/usr/bin/env bash
# Policy test for the public Developer ID release lane. It exercises the
# preflight with stubbed tools and inspects the script for required gates; it
# never signs, notarizes, uploads, installs or launches anything.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BUILD="$SCRIPT_DIR/build-public-macos.sh"
LIB="$SCRIPT_DIR/public-macos-lib.sh"
NOTARY="$SCRIPT_DIR/notary-openbao.sh"
fail() {
    echo "FAIL: $1" >&2
    exit 1
}

[[ -f "$BUILD" && -f "$LIB" && -f "$NOTARY" ]] || fail "public build lane is missing"
SOURCE="$(cat "$BUILD" "$LIB" "$NOTARY")"

require_text() {
    [[ "$SOURCE" == *"$1"* ]] || fail "$2"
}
forbid_text() {
    [[ "$SOURCE" != *"$1"* ]] || fail "$2"
}

require_text 'Developer ID Application: Michael Dewald (GGYLL32K99)' "exact Developer ID common name is required"
require_text 'KEEWEB_CODESIGN_CONFIG' "signing config must be injected, not written to keys/codesign.json"
require_text 'write-update-build.js' "public build metadata must be embedded"
require_text '--channel public' "public builds must embed the public channel"
require_text 'git status --porcelain' "a clean tree is required"
require_text 'notarytool submit' "app and DMG must be notarized"
require_text 'stapler staple' "tickets must be stapled"
require_text 'stapler validate' "stapled tickets must validate"
require_text 'hdiutil create' "the DMG must be built without unlocked tooling"
require_text 'Unexpected DMG contents' "the DMG may contain only the app and the Applications link"
require_text 'LSMinimumSystemVersion' "the published minimum macOS version must be verified"
require_text 'PUBLIC_REQUIRE_CLEAN_METADATA' "a tree that becomes dirty mid-build must stop before notarization"
require_text 'spctl' "Gatekeeper must assess the results"
require_text 'verifyUpdateApp' "nested signatures must be verified"
require_text 'provisioning-profile.js' "the Developer ID provisioning profile must be validated"
require_text 'prepare-public-release.js' "release metadata must come from the reviewed generator"
require_text 'Contents/Installer' "the privileged installer must be rejected"
require_text "trap " "temporary signing configuration must be cleaned on exit"
[[ "$(grep -c 'notarytool submit' "$BUILD" "$LIB" "$NOTARY" | awk -F: '{s+=$2} END {print s}')" -ge 1 ]] || fail "notarization missing"
[[ "$(grep -c 'notarize_and_staple' "$BUILD")" -ge 2 ]] || fail "both the app and the DMG must be notarized and stapled"

forbid_text 'Apple Development' "no Apple Development fallback is allowed"
forbid_text 'keys/codesign.json' "the development signing config must not be touched"
forbid_text 'keys/keeweb.provisionprofile' "the development provisioning profile must not be used"
forbid_text '--sign -' "no ad-hoc signing is allowed"
forbid_text 'skip-sign' "unsigned public output is not allowed"
forbid_text '/Applications/' "preparation must not install the app"
forbid_text 'appdmg' "the DMG must not depend on the optional appdmg toolchain"
if grep -Eq '(^|[;&|[:space:]])open[[:space:]]+(-[[:alpha:]]|"|\$)' "$BUILD" "$LIB"; then
    fail "preparation must not launch the app"
fi
forbid_text 'R2_' "the build lane must not handle publication credentials"

# --- exercised preflight, with stubbed tools -------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/keeweb-public-policy.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
cat > "$WORK/bin/security" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "find-identity" ]]; then
    printf '%s' "${STUB_IDENTITIES:-}"
    exit 0
fi
exec /usr/bin/security "$@"
STUB
cat > "$WORK/bin/git" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == "status --porcelain" ]]; then
    printf '%s' "${STUB_GIT_STATUS:-}"
    exit 0
fi
exec /usr/bin/git "$@"
STUB
chmod +x "$WORK/bin/security" "$WORK/bin/git"

# Pinned to the Keychain backend so these gates do not depend on a host
# ops-platform checkout; test-notary-openbao.sh covers the OpenBao backend.
preflight() {
    PATH="$WORK/bin:$PATH" KEEWEB_NOTARY_AUTH=keychain-profile bash "$BUILD" --preflight-only 2>&1
}
DEVELOPER_ID='  1) 0000000000000000000000000000000000000000 "Developer ID Application: Michael Dewald (GGYLL32K99)"'
DEVELOPMENT='  1) 1111111111111111111111111111111111111111 "Apple Development: Michael Dewald (UUCWA5MCLV)"'
MISSING_PROFILE="$WORK/missing.provisionprofile"

if OUTPUT="$(STUB_GIT_STATUS=' M dirty.js' STUB_IDENTITIES="$DEVELOPER_ID" preflight)"; then
    fail "a dirty tree must stop the public build"
fi
[[ "$OUTPUT" == *"clean"* ]] || fail "dirty-tree refusal must explain itself: $OUTPUT"

if OUTPUT="$(STUB_IDENTITIES="$DEVELOPMENT" preflight)"; then
    fail "a missing Developer ID identity must stop before packaging"
fi
[[ "$OUTPUT" == *"Developer ID"* ]] || fail "identity refusal must explain itself: $OUTPUT"

if OUTPUT="$(STUB_IDENTITIES="$DEVELOPER_ID"$'\n'"${DEVELOPER_ID/0000/2222}" preflight)"; then
    fail "an ambiguous Developer ID identity must stop before packaging"
fi

if OUTPUT="$(STUB_IDENTITIES="$DEVELOPER_ID" KEEWEB_PUBLIC_PROVISIONING_PROFILE="$MISSING_PROFILE" preflight)"; then
    fail "a missing Developer ID provisioning profile must stop before packaging"
fi
[[ "$OUTPUT" == *"provisioning profile"* ]] || fail "profile refusal must explain itself: $OUTPUT"

if bash "$BUILD" --unknown-option >/dev/null 2>&1; then
    fail "unknown options must be rejected"
fi

echo "public macOS release policy test passed"

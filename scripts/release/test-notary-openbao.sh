#!/usr/bin/env bash
# Snippets are single-quoted on purpose: they expand inside the library shell.
# shellcheck disable=SC2016
# Policy test for the notarization credential backends (KEEWEB_NOTARY_AUTH). It
# uses a fake python3, a fake xcrun and a throwaway ops-platform checkout; it
# never contacts Apple or OpenBao and never builds, signs or notarizes anything.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BUILD="$SCRIPT_DIR/build-public-macos.sh"
LIB="$SCRIPT_DIR/public-macos-lib.sh"
fail() {
    echo "FAIL: $1" >&2
    exit 1
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/keeweb-notary-policy.XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/tmp"
LOG="$WORK/calls.log"

cat > "$WORK/bin/python3" <<'STUB'
#!/usr/bin/env bash
{
    echo "python3 cwd=$PWD"
    printf 'python3 arg=%s\n' "$@"
    [[ "$3" == pycache_prefix=* && -d "${3#pycache_prefix=}" ]] && echo "python3 pycache-ready"
} >> "$STUB_LOG"
echo "notary: stub runner" >&2
[[ "${STUB_RUNNER_RC:-0}" -eq 0 ]] || exit "$STUB_RUNNER_RC"
for arg in "$@"; do
    if [[ "$arg" == "submit" ]]; then
        printf '{"id":"stub","status":"%s"}\n' "${STUB_STATUS:-Accepted}"
        exit 0
    fi
done
echo "history output"
STUB
cat > "$WORK/bin/xcrun" <<'STUB'
#!/usr/bin/env bash
echo "xcrun $*" >> "$STUB_LOG"
if [[ "$1 $2" == "notarytool submit" ]]; then
    printf '{"id":"stub","status":"%s"}\n' "${STUB_STATUS:-Accepted}"
fi
exit "${STUB_XCRUN_RC:-0}"
STUB
cat > "$WORK/bin/security" <<'STUB'
#!/usr/bin/env bash
echo "security $*" >> "$STUB_LOG"
[[ "$1" == "find-identity" ]] && exit 0
exec /usr/bin/security "$@"
STUB
chmod +x "$WORK/bin/python3" "$WORK/bin/xcrun" "$WORK/bin/security"

# A reviewed-looking ops-platform checkout: clean, HEAD on origin/main.
OPS="$WORK/ops-platform"
mkdir -p "$OPS/scripts/spark_release"
echo "# stub" > "$OPS/scripts/spark_release/notary_exec.py"
G=(git -C "$OPS" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false)
"${G[@]}" init -q
"${G[@]}" remote add origin git@github.com:mickdewald/ops-platform.git
"${G[@]}" add -A
"${G[@]}" commit -q -m init
"${G[@]}" update-ref refs/remotes/origin/main HEAD

DMG="$WORK/KeeWeb-test.dmg"
echo "dmg" > "$DMG"

# lib <bash snippet>: runs the snippet with the release library sourced and stubs on PATH.
lib() {
    : > "$LOG"
    PATH="$WORK/bin:$PATH" STUB_LOG="$LOG" TMPDIR="$WORK/tmp" bash -c \
        'set -euo pipefail; source "$1"; eval "$2"' _ "$LIB" "$1" 2>&1
}
preflight() {
    : > "$LOG"
    PATH="$WORK/bin:$PATH" STUB_LOG="$LOG" bash "$BUILD" --preflight-only 2>&1
}
logged() {
    grep -qxF -- "$1" "$LOG" || fail "$2 (missing: $1)$(printf '\n%s' "$(cat "$LOG")")"
}

# --- default stays keychain-profile / mick-notary ---------------------------
OUTPUT="$(unset KEEWEB_NOTARY_AUTH KEEWEB_NOTARY_PROFILE
    lib 'resolve_notary_auth; echo "mode=$NOTARY_AUTH profile=$NOTARY_PROFILE"; notary_preflight; notarize_and_staple "'"$DMG"'" "'"$WORK"'"')" ||
    fail "default keychain-profile notarization must succeed: $OUTPUT"
[[ "$OUTPUT" == *"mode=keychain-profile profile=mick-notary"* ]] || fail "default mode changed: $OUTPUT"
logged "xcrun notarytool history --keychain-profile mick-notary" "default preflight must use the mick-notary profile"
logged "xcrun notarytool submit $DMG --keychain-profile mick-notary --wait --output-format json" "default submission changed"
logged "xcrun stapler staple $DMG" "default mode must staple"
! grep -q '^python3' "$LOG" || fail "keychain-profile mode must not start the OpenBao runner"

OUTPUT="$(KEEWEB_NOTARY_AUTH=keychain-profile KEEWEB_NOTARY_PROFILE=other lib 'resolve_notary_auth; notary_submit_json "'"$DMG"'"')" ||
    fail "a custom keychain profile must still work: $OUTPUT"
logged "xcrun notarytool submit $DMG --keychain-profile other --wait --output-format json" "KEEWEB_NOTARY_PROFILE must be honoured"

# --- invalid mode selections fail closed before any work ---------------------
if OUTPUT="$(KEEWEB_NOTARY_AUTH=vault preflight)"; then
    fail "an unknown KEEWEB_NOTARY_AUTH must stop the build"
fi
[[ "$OUTPUT" == *"Unknown KEEWEB_NOTARY_AUTH 'vault'"* ]] || fail "unknown mode refusal must explain itself: $OUTPUT"
[[ ! -s "$LOG" ]] || fail "an unknown mode must stop before any work: $(cat "$LOG")"

if OUTPUT="$(KEEWEB_NOTARY_AUTH=openbao-machine KEEWEB_NOTARY_PROFILE=mick-notary OPS_PLATFORM_DIR="$OPS" preflight)"; then
    fail "KEEWEB_NOTARY_PROFILE with openbao-machine must stop the build"
fi
[[ "$OUTPUT" == *"must not be set with KEEWEB_NOTARY_AUTH=openbao-machine"* ]] || fail "mixed mode refusal must explain itself: $OUTPUT"
[[ ! -s "$LOG" ]] || fail "mixed modes must stop before any work: $(cat "$LOG")"

# --- ops-platform checkout gate ----------------------------------------------
checkout_rejected() {
    local expected="$1" dir="$2" out
    if out="$(KEEWEB_NOTARY_AUTH=openbao-machine OPS_PLATFORM_DIR="$dir" lib 'resolve_notary_auth; require_notary_backend')"; then
        fail "ops-platform checkout must be rejected: $expected"
    fi
    [[ "$out" == *"$expected"* ]] || fail "checkout refusal must mention '$expected': $out"
}
checkout_rejected "must be an absolute path" "projects/ops-platform"
checkout_rejected "checkout not found" "$WORK/missing"
mv "$OPS/scripts/spark_release/notary_exec.py" "$WORK/notary_exec.py"
checkout_rejected "has no scripts/spark_release/notary_exec.py" "$OPS"
mv "$WORK/notary_exec.py" "$OPS/scripts/spark_release/notary_exec.py"
git -C "$OPS" remote set-url origin https://github.com/someone/ops-platform.git
checkout_rejected "unexpected origin" "$OPS"
git -C "$OPS" remote set-url origin https://github.com/mickdewald/ops-platform
echo dirty > "$OPS/dirty.txt"
checkout_rejected "is dirty" "$OPS"
if OUTPUT="$(KEEWEB_NOTARY_AUTH=openbao-machine OPS_PLATFORM_DIR="$OPS" preflight)"; then
    fail "a dirty ops-platform checkout must stop the build"
fi
[[ "$OUTPUT" == *"is dirty"* ]] || fail "the build must check the ops-platform checkout: $OUTPUT"
! grep -q '^security' "$LOG" || fail "the ops-platform gate must run before the signing preflight"
rm "$OPS/dirty.txt"
"${G[@]}" commit -q --allow-empty -m unreviewed
checkout_rejected "not contained in origin/main" "$OPS"
"${G[@]}" reset -q --hard HEAD~1

# --- runner invocation --------------------------------------------------------
openbao() {
    KEEWEB_NOTARY_AUTH=openbao-machine OPS_PLATFORM_DIR="$OPS" lib "resolve_notary_auth; require_notary_backend; $1"
}
OUTPUT="$(openbao 'notary_preflight; notarize_and_staple "'"$DMG"'" "'"$WORK"'"')" ||
    fail "openbao-machine notarization must succeed with an accepting runner: $OUTPUT"
logged "python3 cwd=$OPS" "the runner must run from the ops-platform checkout"
logged "python3 arg=-I" "the runner must use an isolated interpreter"
logged "python3 pycache-ready" "the runner must get a temporary pycache prefix"
RUNNER_ARGS="$(grep '^python3 arg=' "$LOG" | sed 's/^python3 arg=//' | grep -v '^pycache_prefix=' | grep -v '^import sys' | tr '\n' ' ')"
[[ "$RUNNER_ARGS" == "-I -X -c $OPS --machine-identity release-signing history -I -X -c $OPS --machine-identity release-signing submit $DMG --json " ]] ||
    fail "unexpected runner arguments: $RUNNER_ARGS"
grep -qF "from scripts.spark_release.notary_exec import main" "$LOG" || fail "the runner entry point changed"
logged "xcrun stapler staple $DMG" "openbao-machine mode must staple"
logged "xcrun stapler validate $DMG" "openbao-machine mode must validate the ticket"
! grep -q 'notarytool' "$LOG" || fail "openbao-machine mode must not fall back to the keychain profile"
[[ -z "$(ls -A "$WORK/tmp")" ]] || fail "the temporary pycache must be removed"

if OUTPUT="$(openbao 'notary_submit_json KeeWeb.dmg')"; then
    fail "relative submissions must be rejected"
fi
! grep -q '^python3' "$LOG" || fail "a relative submission must not reach the runner"

# --- runner failures fail closed ----------------------------------------------
if OUTPUT="$(STUB_RUNNER_RC=10 openbao 'notary_preflight')"; then
    fail "a failing runner preflight must stop the build"
fi
[[ "$OUTPUT" == *"login required"* ]] || fail "preflight failure must explain itself: $OUTPUT"

if OUTPUT="$(STUB_RUNNER_RC=11 openbao 'notarize_and_staple "'"$DMG"'" "'"$WORK"'"')"; then
    fail "a failing runner submission must stop the build"
fi
[[ "$OUTPUT" == *"denied"* ]] || fail "submission failure must explain itself: $OUTPUT"
! grep -q 'stapler' "$LOG" || fail "a failed submission must not be stapled"
! grep -q 'notarytool' "$LOG" || fail "a failed runner must not fall back to the keychain profile"
[[ -z "$(ls -A "$WORK/tmp")" ]] || fail "the temporary pycache must be removed after a failure"

if OUTPUT="$(STUB_STATUS=Invalid openbao 'notarize_and_staple "'"$DMG"'" "'"$WORK"'"')"; then
    fail "a rejected notarization must stop the build"
fi
[[ "$OUTPUT" == *"status: Invalid"* ]] || fail "rejected notarization must explain itself: $OUTPUT"
! grep -q 'stapler' "$LOG" || fail "a rejected submission must not be stapled"

echo "notary credential backend policy test passed"

#!/usr/bin/env bash
# Notarization credential backends of the public Developer ID lane. Sourced by
# public-macos-lib.sh. KEEWEB_NOTARY_AUTH selects exactly one backend and there
# is no fallback between them:
#   keychain-profile  xcrun notarytool with a Keychain profile (KEEWEB_NOTARY_PROFILE,
#                     default mick-notary)
#   openbao-machine   the ops-platform notary runner, which fetches the App Store
#                     Connect API key through the release-signing machine identity
# Relies on die/require_cmd from public-macos-lib.sh.

OPS_PLATFORM_ORIGIN_PATTERN='^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)mickdewald/ops-platform(\.git)?$'
NOTARY_RUNNER_IDENTITY="release-signing"

# Resolves and validates NOTARY_AUTH (and NOTARY_PROFILE for the Keychain mode).
# Pure environment checks, so it can run before any other work.
resolve_notary_auth() {
    NOTARY_AUTH="${KEEWEB_NOTARY_AUTH:-openbao-machine}"
    case "$NOTARY_AUTH" in
        keychain-profile)
            NOTARY_PROFILE="${KEEWEB_NOTARY_PROFILE:-mick-notary}"
            ;;
        openbao-machine)
            [[ -z "${KEEWEB_NOTARY_PROFILE:-}" ]] ||
                die "KEEWEB_NOTARY_PROFILE must not be set with KEEWEB_NOTARY_AUTH=openbao-machine; the modes do not mix."
            NOTARY_PROFILE=""
            ;;
        *)
            die "Unknown KEEWEB_NOTARY_AUTH '$NOTARY_AUTH' (expected keychain-profile or openbao-machine)."
            ;;
    esac
}

# Validates the ops-platform checkout the runner is loaded from and sets OPS_PLATFORM.
require_ops_platform_checkout() {
    local ops="${OPS_PLATFORM_DIR:-$HOME/projects/ops-platform}" origin
    [[ "$ops" == /* ]] || die "OPS_PLATFORM_DIR must be an absolute path: $ops"
    [[ -d "$ops" ]] || die "ops-platform checkout not found: $ops (set OPS_PLATFORM_DIR)."
    [[ -f "$ops/scripts/spark_release/notary_exec.py" ]] ||
        die "ops-platform checkout $ops has no scripts/spark_release/notary_exec.py; update it to origin/main."
    origin="$(git -C "$ops" remote get-url origin 2>/dev/null || true)"
    [[ "$origin" =~ $OPS_PLATFORM_ORIGIN_PATTERN ]] ||
        die "ops-platform checkout $ops has an unexpected origin '$origin' (expected github.com/mickdewald/ops-platform)."
    local status
    status="$(git -C "$ops" status --porcelain 2>/dev/null)" ||
        die "ops-platform checkout $ops is not a readable git checkout."
    [[ -z "$status" ]] || die "ops-platform checkout $ops is dirty; the notary runner must come from a clean checkout."
    git -C "$ops" merge-base --is-ancestor HEAD refs/remotes/origin/main 2>/dev/null ||
        die "ops-platform checkout $ops HEAD is not contained in origin/main; the notary runner must be reviewed code."
    OPS_PLATFORM="$ops"
}

# Checks everything the selected backend needs locally, before any work.
require_notary_backend() {
    if [[ "$NOTARY_AUTH" == "openbao-machine" ]]; then
        require_cmd python3
        require_ops_platform_checkout
    fi
}

notary_runner_failure() {
    local code="$1" reason
    case "$code" in
        10) reason="OpenBao login required" ;;
        11) reason="OpenBao denied access for the $NOTARY_RUNNER_IDENTITY identity" ;;
        12) reason="notary secret is missing or malformed" ;;
        13) reason="OpenBao is offline or unreachable" ;;
        20) reason="notarytool could not be started" ;;
        21) reason="temporary notary key cleanup was not confirmed" ;;
        1) reason="notary runner failed" ;;
        *) reason="notarytool exited with $code" ;;
    esac
    echo "notary runner exit $code: $reason"
}

# run_notary_runner <subcommand> [args...]: isolated interpreter, throwaway pycache.
run_notary_runner() {
    local pycache rc=0
    [[ -n "${OPS_PLATFORM:-}" ]] || die "ops-platform checkout was not validated"
    pycache="$(mktemp -d "${TMPDIR:-/tmp}/keeweb-notary-pycache.XXXXXX")"
    (
        cd "$OPS_PLATFORM" &&
            python3 -I -X "pycache_prefix=$pycache" -c 'import sys; sys.path.append(sys.argv[1]); from scripts.spark_release.notary_exec import main; raise SystemExit(main(sys.argv[2:]))' \
                "$OPS_PLATFORM" --machine-identity "$NOTARY_RUNNER_IDENTITY" "$@"
    ) || rc=$?
    rm -rf "$pycache"
    return "$rc"
}

# Confirms that Apple accepts the selected notary credentials.
notary_preflight() {
    local rc=0
    case "$NOTARY_AUTH" in
        keychain-profile)
            xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 ||
                die "notarytool keychain profile '$NOTARY_PROFILE' is missing or unusable."
            ;;
        openbao-machine)
            run_notary_runner history >/dev/null || rc=$?
            [[ "$rc" -eq 0 ]] ||
                die "OpenBao notary credentials are unusable ($(notary_runner_failure "$rc"))."
            ;;
        *) die "Notary auth mode is not resolved" ;;
    esac
}

# notary_submit_json <absolute .zip|.dmg|.pkg>: waits and prints notarytool's JSON.
notary_submit_json() {
    local submission="$1" rc=0
    [[ "$submission" == /* ]] || die "Notary submissions must use an absolute path: $submission"
    case "$NOTARY_AUTH" in
        keychain-profile)
            xcrun notarytool submit "$submission" --keychain-profile "$NOTARY_PROFILE" --wait --output-format json
            ;;
        openbao-machine)
            run_notary_runner submit "$submission" --json || rc=$?
            [[ "$rc" -eq 0 ]] ||
                die "Notarization of $(basename "$submission") failed ($(notary_runner_failure "$rc"))."
            ;;
        *) die "Notary auth mode is not resolved" ;;
    esac
}

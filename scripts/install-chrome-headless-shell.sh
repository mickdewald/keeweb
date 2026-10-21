#!/usr/bin/env bash
set -euo pipefail

readonly CHROME_VERSION='153.0.8010.12'
readonly CHROME_URL="https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/mac-arm64/chrome-headless-shell-mac-arm64.zip"
readonly CHROME_SHA256='89d80a6d26ccd0ccfd51e22d9e1297283862af2b0cd91dce07459b35ca0059f2'
readonly TEMP_PARENT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

fail() { echo "Chrome bootstrap: $*" >&2; exit 1; }

stage="$(mktemp -d "${TEMP_PARENT%/}/keeweb-chrome.XXXXXX")"
[[ ! -L "$stage" ]] || fail 'temporary directory is a symlink'
archive="$stage/chrome-headless-shell-mac-arm64.zip"
extract="$stage/extract"

curl --fail --location --retry 1 --retry-all-errors --connect-timeout 30 --max-time 600 \
    --output "$archive" "$CHROME_URL"
[[ -f "$archive" && ! -L "$archive" ]] || fail 'download did not create a regular archive'
actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
[[ "$actual_sha256" == "$CHROME_SHA256" ]] || fail 'archive checksum mismatch'
unzip -t "$archive" >/dev/null
if unzip -Z -1 "$archive" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
    fail 'archive contains an unsafe entry path'
fi
if zipinfo -l "$archive" | awk 'NR > 2 && $1 ~ /^l/ { found=1 } END { exit !found }'; then
    fail 'archive contains a symbolic-link entry'
fi
mkdir "$extract"
ditto -x -k "$archive" "$extract"
if find "$extract" -type l -print -quit | grep -q .; then
    fail 'extraction created a symbolic link'
fi
chrome_count="$(find "$extract" -type f -path '*/chrome-headless-shell' -perm -111 -print | wc -l | tr -d '[:space:]')"
[[ "$chrome_count" == 1 ]] || fail 'expected exactly one executable Chrome headless shell'
chrome_bin="$extract/chrome-headless-shell-mac-arm64/chrome-headless-shell"
[[ -f "$chrome_bin" && ! -L "$chrome_bin" && -x "$chrome_bin" ]] || fail 'expected Chrome executable is missing'
chrome_version="$($chrome_bin --version)"
[[ "$chrome_version" == "Google Chrome for Testing ${CHROME_VERSION}" ]] || fail "unexpected Chrome version: ${chrome_version}"
printf 'CHROME_BIN=%s\n' "$chrome_bin" >> "$GITHUB_ENV"

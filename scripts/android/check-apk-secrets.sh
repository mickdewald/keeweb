#!/usr/bin/env bash
# scripts/android/check-apk-secrets.sh <apk>: fails if the APK or the Capacitor config holds credential-shaped values.
set -euo pipefail
APK="${1:?usage: check-apk-secrets.sh <apk>}"
cd "$(dirname "$0")/../.."
[ -f "$APK" ] || { echo "APK not found: $APK" >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -qo "$APK" 'assets/*' -d "$WORK" </dev/null  # res/ has case-colliding names on macOS and is not scanned
[ -d "$WORK/assets" ] || { echo "APK has no assets directory" >&2; exit 1; }
# The match runs on to the closing quote (or whitespace) so allow-listed values are compared whole, never as prefixes.
PATTERN='(password|passwd|secret|token|api[_-]?key|client[_-]?secret)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9+/_-]{12,}[^"'"'"' ]*["'"'"']?'
# Known non-secret constants that match the pattern. The web bundle is inlined into a single index.html, so a
# per-file exclusion is impossible; instead exactly these matched strings are allowed (docs/android.md):
#   - upstream OAuth client "secrets" from app/scripts/const/cloud-storage-apps.js (public by design, see its header)
#   - identifiers: kdbx XML name ProtectPassword, locale key dropboxAppSecret, handler changeShortLivedStorageToken
ALLOWED=(
    'secret:"07s5r4ck1uvlj6a"'
    'secret:"ez04o1iwf6yprq3"'
    'secret:"yAtyfc9TIQ9GyQgQmo3i0HAP"'
    'secret:"42HeSBybXDZjvweotq4o4CkJ"'
    'secret:"nTSCiqXtUNmURIIdASaC1TJK"'
    'secret:"aOMJaktJEAs_Tmh]fx4iQ[Zd3mp3KK7-"'
    'Password:"ProtectPassword"'
    'Secret":"Dropbox-App-Secret"'
    'token":"changeShortLivedStorageToken"'
)
MATCHES="$WORK/matches.txt"
ALLOWFILE="$WORK/allowed.txt"
UNEXPECTED="$WORK/unexpected.txt"
printf '%s\n' "${ALLOWED[@]}" >"$ALLOWFILE"
rc=0
grep -rEiIoh "$PATTERN" "$WORK/assets" capacitor.config.json >"$MATCHES" || rc=$?
if [ "$rc" -gt 1 ]; then
    echo "secret scan failed (grep exit $rc)" >&2
    exit 1
fi
rc=0
grep -vxFf "$ALLOWFILE" "$MATCHES" >"$UNEXPECTED" || rc=$?
if [ "$rc" -gt 1 ]; then
    echo "allow-list filter failed (grep exit $rc)" >&2
    exit 1
fi
if [ -s "$UNEXPECTED" ]; then
    sed 's/^\(.\{0,6\}\).*/unexpected match starting: \1.../' "$UNEXPECTED" >&2
    echo "credential-shaped value found" >&2
    exit 1
fi
names="$(unzip -Z1 "$APK" </dev/null)" || { echo "cannot list APK entries" >&2; exit 1; }
if printf '%s\n' "$names" | grep -qi '\.kdbx$'; then
    echo "a KeePass database is inside the APK" >&2
    exit 1
fi
echo "no credentials found"

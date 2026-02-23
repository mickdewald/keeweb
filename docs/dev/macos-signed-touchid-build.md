# macOS Signed Dev Build (Touch ID)

This guide documents the reproducible local build flow for a macOS KeeWeb app where Touch ID must work.

## Agent default

Agents should use this script as the default path:

```bash
scripts/dev/build-macos-touchid-agent.sh
```

This avoids manual signing drift and enforces the same build/sign/deploy order every time.

## Why the previous attempt failed

The delay came from multiple signing pitfalls happening in sequence:

1. Unsigned dev build (`--skip-sign`) was used first. In this state, Touch ID is unavailable by design.
2. Manual re-sign attempts created inconsistent nested signatures (frameworks and dylibs), causing launch failures.
3. App bundle ID and entitlements had to match (`com.mickdewald.keeweb` + `GGYLL32K99` values from entitlements/profile).
4. `embedded.provisionprofile` was missing in the failing app bundle.
5. Copying into an existing app bundle without deleting it first can invalidate sealed resources.

Use the flow below to avoid all of this.

## Preconditions

- Run from repo root.
- Dependencies installed:

```bash
npm ci
```

- Required local signing files:
  - `keys/codesign.json`
  - `keys/keeweb.provisionprofile`

If `keys/keeweb.provisionprofile` is missing on this machine, copy it from the working local app:

```bash
mkdir -p keys
cp /Applications/KeeWeb.app/Contents/embedded.provisionprofile keys/keeweb.provisionprofile
```

Minimal `keys/codesign.json` example:

```json
{
  "identities": {
    "app": "Apple Development: Michael Dewald (UUCWA5MCLV)"
  },
  "teamId": "GGYLL32K99",
  "appleId": ""
}
```

## Build (official signing task, arm64)

```bash
NODE_OPTIONS=--openssl-legacy-provider \
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
  --app-bundle-id=com.mickdewald.keeweb \
  --provisioning-profile=./keys/keeweb.provisionprofile
```

Output app:

```text
tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app
```

## Deploy for testing

Always replace the target app atomically (no merge copy):

```bash
rm -rf /Applications/KeeWeb-Codex.app
ditto tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app /Applications/KeeWeb-Codex.app
xattr -cr /Applications/KeeWeb-Codex.app
open -n /Applications/KeeWeb-Codex.app
```

## Verification checklist

```bash
/usr/bin/codesign --verify --deep --strict --verbose=4 /Applications/KeeWeb-Codex.app
/usr/bin/codesign -dvvv /Applications/KeeWeb-Codex.app | rg 'Identifier=|TeamIdentifier=|Authority='
/usr/bin/codesign -d --entitlements :- /Applications/KeeWeb-Codex.app | rg 'application-identifier|team-identifier|keychain-access-groups'
```

Expected:

- `Identifier=com.mickdewald.keeweb`
- `TeamIdentifier=GGYLL32K99`
- Entitlements include:
  - `com.apple.application-identifier`
  - `com.apple.developer.team-identifier`
  - `keychain-access-groups`

## Fast error mapping

- `Touch ID is unavailable ... app is not signed`: build was unsigned (`--skip-sign`) or sign step failed.
- `Code Signature Invalid`: broken/merged app bundle or invalid nested signature.
- `Library not loaded ... libffmpeg ... different Team IDs`: framework/dylib signatures are inconsistent; rebuild and sign via `osx-sign:desktop-arm64` only.

# Private KeeWeb fork automatic updates

## Implementation

macOS arm64 builds produced by `scripts/dev/build-macos-touchid-agent.sh` include
an independent Electron/Squirrel updater. The upstream renderer updater remains
disabled. The private channel is
`https://downloads.michaeldewald.com/keeweb/arm64/latest.json`.

The KeeWeb menu offers a manual check and a persisted automatic-check checkbox.
Automatic checks run ten seconds after launch and every 24 hours. They fetch
metadata only. A user must approve downloading; Squirrel installs a downloaded
update at the next app exit, even if the user postpones the immediate restart.
The confirmation explains this behavior. After approval a dedicated macOS-style
window shows actual downloaded bytes, a percentage when the server provides the
size, and a distinct verification phase. Downloads can be cancelled before native
staging or hidden in the background; a manual check reopens ongoing progress.
The archive is streamed to a private temporary directory, checked against the
release SHA-256, then served through a random loopback URL to the native updater
for signature verification. Errors and cancellations clean up the temporary files.
A stalled download times out after 60 seconds without data.
Immediate restart goes through the
existing renderer save/cancel workflow. Failed saves and editor vetoes clear
restart intent. Explicit update restarts also bypass minimize-on-close. Background network failures remain quiet; manual failures show
a dialog. Unpackaged builds and other platforms do not enable this channel.

## Release preparation

Use the canonical macOS build script with Node 20. Build metadata embeds the
UTC build identifier, source commit, and clean-tree status before signing.
`KEEWEB_RELEASE_BUILD=YYYYMMDDhhmmss` may pin an explicitly selected build ID;
otherwise the build timestamp is generated automatically.

```
bash scripts/dev/build-macos-touchid-agent.sh --skip-deploy
node scripts/release/prepare-private-update.js \
  tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app .updater-artifacts/releases
```

Preparation checks bundle identity, arm64, signature integrity and the existing
Apple Development channel identity. It creates `KeeWeb.zip`, immutable
`update.json`, and the proposed `latest.json`. Dirty-built artifacts are marked
local-draft even when prepared later from a clean checkout. Smoke fixtures are
rejected. No passwords or user configuration are packaged.

This is the private Apple Development channel, not the general public macOS
release. The public Developer ID lane is separate (see "Public Developer ID
distribution" below). Squirrel checks the installed app's signing requirement,
so there is no automatic cross-certificate migration: a development-signed
installation moves to the public channel once, by installing the public DMG.

## Publication

Publish only a reviewed clean source revision after release approval. The
publication command requires the prepared artifact's source SHA to match the
current clean checkout. Supply `CLOUDFLARE_ACCOUNT_ID` and inject
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` through the existing Keychain handoff.
Credentials must never be stored in the repo or printed.

```
node scripts/release/publish-private-update.js \
  .updater-artifacts/releases/BUILD --publish
```

The publisher refuses non-increasing builds and mismatched immutable archive
paths. Existing byte-identical artifacts are reused on retry. It uploads and byte-verifies the ZIP, then the immutable Squirrel
metadata, and advances `latest.json` last. Conditional writes prevent overwriting immutable objects or replacing a feed
changed by another publisher; retry re-verifies existing bytes. The Swift updater feeds are unaffected.

The first updater-enabled app needs one installation using the canonical script.
Subsequent approved builds are installed by Electron. The old KeeWeb installer
is neither restored nor used.

## Verification

`npm test` includes browser tests and Node controller/feed/save-abort tests.
`npm run test:macos-deploy-target` checks build policy. A native old-to-new smoke
fixture is built only via `--updater-smoke`, with its own `.updater-smoke` bundle
ID and minimal entitlements; it never opens KeeWeb data or Keychain. Every deploy
also rejects a smoke artifact, including `--skip-build`.

Validation on 2026-09-17: 161 browser tests and 17 updater tests passed.
A signed native upgrade with an isolated app ID succeeded; an invalid-signature
archive was rejected and the old app preserved. Publication is a separate gate.

Progress validation on 2026-09-18: 161 browser tests and 26 desktop tests passed.
The signed isolated fixture displayed real byte/percentage progress during a
throttled 117 MB download and successfully installed and launched the next build.

## Public Developer ID distribution

Every packaged build embeds `{ build, sourceSha, clean, channel }`. The channel
(`development` or `public`) selects the only feed the build will ever use:

- `development`: `https://downloads.michaeldewald.com/keeweb/arm64/latest.json`
- `public`: `https://downloads.michaeldewald.com/keeweb/public/arm64/updates.json`

Feed validation binds release URLs to the embedded channel. Missing or unknown
channel metadata disables updates; nothing falls back to another feed.

### Build

```
npm run build:public-macos            # clean tree only
npm run build:public-macos -- --local-draft   # dirty tree, acceptance only
```

`scripts/release/build-public-macos.sh` fails closed unless all of these hold:
clean tree, exactly one `Developer ID Application: Michael Dewald (GGYLL32K99)`
keychain identity, a valid Developer ID provisioning profile, and the
`mick-notary` notarytool keychain profile. It signs through an injected
`KEEWEB_CODESIGN_CONFIG` (the development `keys/codesign.json` is never touched),
verifies every nested Mach-O signature, Hardened Runtime and the exact
entitlements, notarizes and staples the app, builds a drag-install DMG with
`hdiutil`, signs, notarizes and staples it, and lets Gatekeeper assess the DMG
and the app copied out of the mounted DMG. It never uploads, installs or launches.

KeeWeb's Touch ID entitlements (`com.apple.application-identifier`,
`com.apple.developer.team-identifier`, `keychain-access-groups`) are restricted.
macOS only honours them with an embedded provisioning profile issued for the
signing certificate, so the public lane requires a **Developer ID** profile for
`com.mickdewald.keeweb` at `keys/keeweb-developer-id.provisionprofile` (or
`KEEWEB_PUBLIC_PROVISIONING_PROFILE`). The device-bound development profile is
rejected.

Notarization credentials come from exactly one source, chosen with
`KEEWEB_NOTARY_AUTH`; there is no fallback between the modes, and an unknown
value stops the build before any work:

- `keychain-profile` (legacy, explicit only): `xcrun notarytool --keychain-profile`, profile
  from `KEEWEB_NOTARY_PROFILE` (default `mick-notary`).
- `openbao-machine` (default since 2026-09-24): the ops-platform notary runner
  (`scripts/spark_release/notary_exec.py`, machine identity `release-signing`)
  fetches the App Store Connect key from OpenBao for `history` (preflight) and
  `submit <absolute path> --json`. `KEEWEB_NOTARY_PROFILE` must be unset. The
  runner is loaded with `python3 -I` from `OPS_PLATFORM_DIR` (absolute, default
  `$HOME/projects/ops-platform`), which must be a clean checkout whose origin is
  `github.com/mickdewald/ops-platform` and whose HEAD is contained in
  `origin/main`. Runner exit codes 10-13 (login required, denied, missing or
  malformed secret, offline), 20/21 (notarytool not startable, temporary key
  cleanup unconfirmed) and 1 abort the build with an explanation.

```
KEEWEB_NOTARY_AUTH=openbao-machine npm run build:public-macos -- --preflight-only
```

`scripts/release/test-notary-openbao.sh` (part of
`npm run test:macos-deploy-target`) covers both modes with a fake runner.

A clean build ends with `.release-artifacts/public/<build>/` containing the DMG,
checksum, `KeeWeb.zip` (stapled app), `update.json`, `release.json`,
`updates.json` and the website `latest.json`. A `--local-draft` build yields only
a DMG marked `LOCAL-DRAFT` without any release metadata; it cannot be published.

### Publish

```
npm run publish:public-macos -- .release-artifacts/public/BUILD --publish
```

The publisher regenerates every document from the artifact bytes, requires the
clean checkout of exactly the embedded source SHA, and reads current pointers
through the authenticated S3 API. Order: immutable DMG, checksum, ZIP,
`update.json`, `release.json` (`If-None-Match: *`; an existing object is reused
only when its public bytes are identical) -> stable DMG alias -> stable checksum
alias -> `updates.json` -> website `latest.json` last. Mutable objects use
strong-ETag compare-and-swap, and every write is byte-verified publicly before
the next pointer advances. The archive's embedded build metadata must match the
release. The website manifest references immutable build-specific DMG/checksum objects,
so cached manifests remain consistent even if a later run stops after advancing
a stable convenience alias. Retry an interrupted publication with the same artifacts.
Credentials come from the Keychain-backed R2 handoff
and are never printed.

### Updater acceptance

`npm run test:public-updater` builds two Developer ID smoke fixtures (N, N+1)
with the isolated `.updater-smoke` bundle ID through the same signing code and
proves over loopback: discovery through public-channel validation, SHA-256
verification, rejection by Squirrel's code signature validation of both a
tampered archive and a validly signed build of another certificate (build N
preserved each time), and installation plus launch of build N+1. Evidence is written to
`.updater-smoke/public/<build>/evidence.json`. The fixture never loads KeeWeb,
databases, the Keychain, or `/Applications`.


### Public distribution acceptance — 2026-09-19

- The Developer ID profile `KeeWebForkDeveloperID2026` was created for
  `com.mickdewald.keeweb` with the existing Developer ID Application certificate.
  Its decoded expiry is 2044-09-14; the portal's 2027-02-01 date is the download
  availability boundary. It is stored only in ignored `keys/` directories.
- Local draft build `20260919115223` passed app and DMG notarization, stapling,
  nested-signature checks, exact profile/certificate matching and Gatekeeper.
- The notarized app launched with a fresh isolated portable profile, leaving the
  existing production process and database untouched. This does not yet prove a
  real biometric unlock or installation of the final clean release.
- Independent reviews accepted immutable website download URLs, exact profile
  certificate binding and actual archive/DMG app signature checks before release
  metadata is trusted. Desktop regression suite: 82 passing tests.
- Final clean-commit build, publication, installed release smoke, website deploy
  and live download validation are still required.

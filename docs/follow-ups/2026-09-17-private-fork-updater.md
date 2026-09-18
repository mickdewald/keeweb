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

This is the existing private Apple Development distribution, not a general
Developer ID/notarized public macOS release. Switching certificates later needs
an explicit migration; Squirrel checks the installed app's signing requirement.

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

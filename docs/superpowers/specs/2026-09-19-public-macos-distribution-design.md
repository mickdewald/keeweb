# KeeWeb Public macOS Distribution Design


> Acceptance correction (2026-09-19): Website manifests must reference immutable
> `keeweb/public/arm64/<build>/KeeWeb-<build>-macos-arm64.dmg` and its `.sha256`,
> with `<build>` matching the manifest. This supersedes all stable-alias website
> URL examples below. Stable aliases may still be published for convenience,
> but are not used by the website. Otherwise cached manifests advertise stale
> checksums when a subsequent release replaces the alias, even on success.
> Failure-injection tests cover interruption after each mutable write and verify
> both the cached and current manifest still identify matching immutable bytes.

**Status:** Approved in conversation on 2026-09-19

## Goal

Publish the independently maintained `mickdewald/keeweb` fork as a trustworthy
Apple-silicon macOS download on `michaeldewald.com`, with the same externally
verifiable guarantees used for the Turbo Swift applications:

- Developer ID Application signing
- Hardened Runtime
- Apple notarization and stapling
- Gatekeeper acceptance
- a DMG, SHA-256 checksum, and strict public release manifest
- immutable release objects plus stable latest aliases
- a signed in-app update path for installations originating from the public DMG

The public product name is **KeeWeb - Michael Dewald Fork**. It must never be
presented as an official KeeWeb release.

## Existing State

The fork currently has a working arm64 Electron build and a private-fork update
channel at `keeweb/arm64/latest.json`. Those artifacts are signed with an Apple
Development identity. They are suitable for the maintainer's installed build,
but they are not a public macOS distribution: Gatekeeper rejects them and the
release preparation documentation explicitly excludes general distribution.

The new public lane must not repurpose or overwrite that development channel.
Existing development-signed installations remain on the existing channel until
the maintainer deliberately replaces them with the public DMG.

## Design Principles

1. Keep the Electron implementation in the KeeWeb repository. Turbo Swift is
   the behavioral reference, not a build-time dependency.
2. Treat signing, notarization, artifact publication, website activation, and
   in-app updates as separate gates.
3. Never publish an artifact from a dirty tree or an artifact whose embedded
   source revision differs from the clean checkout being published.
4. Never expose a public download pointer before every referenced immutable
   object has been uploaded and byte-verified.
5. Keep the development and public updater channels cryptographically and
   operationally separate.
6. Do not publish or package passwords, KeePass databases, local settings,
   Keychain data, or provisioning secrets.

## Public Build Lane

Add a canonical public release entrypoint under `scripts/release/`. It builds
the same arm64 Electron product as the development lane but uses an explicit
public distribution configuration:

- bundle identifier: `com.mickdewald.keeweb`
- architecture: `arm64`
- minimum macOS: `12.0`
- signing identity: `Developer ID Application: Michael Dewald (GGYLL32K99)`
- Hardened Runtime: enabled
- updater channel embedded in build metadata: `public`
- public update feed: `https://downloads.michaeldewald.com/keeweb/public/arm64/updates.json`

The script must select the Developer ID identity explicitly and fail closed if
it is absent. It must not silently fall back to Apple Development, ad hoc, or
unsigned output. Public signing configuration is supplied through a documented
environment/config boundary rather than overwriting the maintainer's gitignored
development `keys/codesign.json`.

The public lane uses `xcrun notarytool` with the existing `mick-notary`
Keychain profile. The release artifact is a drag-install DMG (the app plus an
`/Applications` link) built with `hdiutil`. The decorated upstream layout is not
used: its `grunt-appdmg` optional dependency cannot be installed from the
lockfile on the required Node 20 runtime, and a release lane must not depend on
unlocked tooling. The DMG may contain nothing but the app and the link.

KeeWeb's Touch ID entitlements (`com.apple.application-identifier`,
`com.apple.developer.team-identifier`, `keychain-access-groups`) are restricted.
macOS only honours them when the app embeds a provisioning profile issued for
its signing certificate, so the public lane requires a Developer ID provisioning
profile for `com.mickdewald.keeweb` and rejects the device-bound development
profile. The workflow verifies:

- every nested executable and framework has a valid signature
- the outer app is signed by the expected Developer ID team
- the app has Hardened Runtime and the expected entitlements
- the embedded provisioning profile is the validated Developer ID profile
- the declared minimum macOS version is 12.0
- the notarization request is accepted
- the notarization ticket is stapled and validates
- Gatekeeper accepts both the DMG and the app copied from it

The development build/install script remains unchanged in purpose and continues
to use Apple Development for local iterative work.

## Public Update Channel

Public builds select their update feed from immutable embedded build metadata.
Development builds continue to select `keeweb/arm64/latest.json`; public builds
select `keeweb/public/arm64/updates.json`. Feed validation must bind each build
to its configured channel and reject cross-channel URLs.

Squirrel must receive a Developer-ID-signed update archive when the installed
app is Developer-ID-signed. Before the first public release is advertised, an
isolated old-to-new acceptance fixture must prove a Developer ID build can:

1. discover a newer public-channel build,
2. download and verify its SHA-256,
3. pass Squirrel signature validation,
4. preserve the old app when validation fails,
5. install the valid update, and
6. launch the new build.

The maintainer's current development-signed app is migrated once by installing
the public DMG manually. No automatic cross-certificate migration is attempted.

## R2 Object Contract

All public objects live below `keeweb/public/arm64/` in the existing
`michaeldewald-com-downloads` bucket.

Immutable build objects:

```text
keeweb/public/arm64/<build>/KeeWeb-<build>-macos-arm64.dmg
keeweb/public/arm64/<build>/KeeWeb-<build>-macos-arm64.dmg.sha256
keeweb/public/arm64/<build>/KeeWeb.zip
keeweb/public/arm64/<build>/update.json
keeweb/public/arm64/<build>/release.json
```

Stable public download objects:

```text
keeweb/public/arm64/latest/keeweb-latest-macos-arm64.dmg
keeweb/public/arm64/latest/keeweb-latest-macos-arm64.dmg.sha256
keeweb/public/arm64/latest.json
keeweb/public/arm64/updates.json
```

`latest.json` follows the existing michaeldewald.com schema-v1 download
manifest. It identifies app slug `keeweb`, the clean-tree build, publication
time, exact latest DMG/checksum keys and URLs, checksum value, size, bundle ID,
and hosting metadata. `updates.json` remains the Electron/Squirrel feed and
references the immutable ZIP and immutable per-build update metadata.

The publisher must:

1. require an explicit `--publish` acknowledgement,
2. require a clean checkout whose HEAD matches the embedded source SHA,
3. create immutable objects with `If-None-Match: *`,
4. accept an existing immutable object only after byte verification,
5. update mutable objects with strong-ETag compare-and-swap,
6. upload and publicly byte-verify every immutable object first,
7. advance the stable DMG and checksum aliases,
8. advance `updates.json`, and
9. advance website-facing `latest.json` last.

If publication fails after a stable alias advanced, the website manifest still
describes the previous build until the run is repeated. The publisher is
idempotent; an interrupted publication must be repeated immediately.

Publishing `latest.json` last ensures the website cannot advertise a release
whose download or update metadata is incomplete. Secret values must be supplied
through the existing Keychain-backed R2 handoff and must never be printed.

## Website Contract

The website consumes
`https://downloads.michaeldewald.com/keeweb/public/arm64/latest.json`. It does
not consume the Electron update feed and never links the development archive.

The website's release loader must retain the current strict rules:

- HTTPS origin must be exactly `downloads.michaeldewald.com`
- manifest schema must be exactly version 1
- app slug, bundle ID, classification, build ID, paths, filenames, checksum,
  size, and publication timestamp must validate
- redirects, oversized manifests, host spoofing, and cross-app artifact paths
  must fail closed

KeeWeb may use a catalog-owned release base path while existing Turbo Swift
entries retain their current `swift/<slug>` default. A missing or invalid
KeeWeb manifest makes only the KeeWeb card temporarily unavailable.

## Branding and Attribution

The website entry uses these unambiguous concepts in both German and English:

- product title: `KeeWeb - Michael Dewald Fork`
- label: independent fork of the open-source KeeWeb project
- disclosure: maintained independently and not an official KeeWeb release
- primary action: download the Michael Dewald fork for macOS
- links: this fork's source, the original KeeWeb project, and the MIT license

The fork disclosure appears in the card body before the download action; it is
not hidden in a footer or tooltip. The product image is a sanitized asset from
the fork with no password database or personal data visible.

KeeWeb appears in the complete `/apps` catalog and as a featured application on
the homepage. Both surfaces use the same release-aware card and manifest data.

## Failure Behavior

- Wrong or missing Developer ID identity: stop before packaging.
- Dirty source or source-SHA mismatch: create no publishable release.
- Notarization, stapling, signature, or Gatekeeper failure: do not publish.
- Existing immutable object with different bytes: stop; never overwrite it.
- Weak/missing ETag on mutable metadata: stop rather than race another release.
- Website manifest failure: render KeeWeb as temporarily unavailable without
  affecting other application cards.
- Update signature failure: preserve the installed app and show the existing
  bounded update error path.

## Verification and Acceptance

Automated verification covers public-channel URL binding, release metadata,
identity/classification refusal, immutable-path validation, publisher ordering,
conditional retries, website manifest parsing, fork attribution, homepage
selection, and download/checksum rendering.

Release acceptance additionally requires fresh evidence from a clean source
revision:

1. full existing KeeWeb browser and desktop tests pass,
2. public app and DMG signatures validate,
3. Apple notarization is accepted and tickets validate,
4. Gatekeeper accepts the DMG and mounted/copied app,
5. the installed public app launches without opening real user data,
6. Touch ID/Keychain behavior receives a bounded installed-app smoke check,
7. the isolated public Developer ID old-to-new update succeeds,
8. public R2 bytes match the local DMG and checksum,
9. the website resolves the strict manifest and renders the fork disclosure,
10. a fresh browser download yields the verified DMG.

No release is complete merely because tests pass, a DMG exists locally, or the
website code has been merged.

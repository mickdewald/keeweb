# KeeWeb Public macOS Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, publish, and install a Developer-ID-signed, notarized KeeWeb fork DMG with a separate public Squirrel update channel and a strict website release manifest.

**Architecture:** The existing Apple-Development lane stays intact. Build metadata chooses either the development or public update channel, while a new public release entrypoint signs with Developer ID, notarizes and staples the app and DMG, prepares immutable R2 objects plus two mutable manifests, and publishes the website manifest last.

**Tech Stack:** Electron 43, Node.js 20.5.1, Grunt, Bash, Node test runner, macOS `codesign`/`notarytool`/`stapler`/`spctl`, Cloudflare R2 S3 API

**Spec:** `docs/superpowers/specs/2026-09-19-public-macos-distribution-design.md`

## Global Constraints

- Public bundle ID is `com.mickdewald.keeweb`; public architecture is `arm64`; minimum macOS is `12.0`.
- Public artifacts must use `Developer ID Application: Michael Dewald (GGYLL32K99)` with Hardened Runtime.
- Development builds keep `https://downloads.michaeldewald.com/keeweb/arm64/latest.json`.
- Public builds use `https://downloads.michaeldewald.com/keeweb/public/arm64/updates.json`.
- Public release objects live only below `keeweb/public/arm64/`.
- Dirty, wrong-source, wrong-identity, non-notarized, unstapled, or Gatekeeper-rejected output must never publish.
- R2 secrets remain Keychain-injected and must never appear in files or output.
- Real KeePass databases and local settings must not be opened, copied, or packaged during acceptance.

## Review Focus

- An invalid or missing `channel` in embedded build metadata must disable updates instead of falling back to a feed.
- Development metadata must never accept public URLs, and public metadata must never accept development URLs.
- A Developer ID app containing one incorrectly signed nested helper must fail before DMG creation or upload.
- An R2 retry encountering different bytes at an immutable key must stop rather than treat HTTP 412 as success.
- The website-facing manifest must remain unpublished if any DMG, checksum, ZIP, update metadata, notarization, or public-byte verification step fails.

---

### Task 1: Bind packaged builds to explicit update channels

**Files:**
- Create: `desktop/scripts/update-channels.js`
- Modify: `desktop/scripts/private-update-feed.js`
- Modify: `desktop/scripts/private-updater.js`
- Rename: `scripts/dev/write-private-update-build.js` to `scripts/dev/write-update-build.js`
- Modify: `scripts/dev/build-macos-touchid-agent.sh`
- Modify: `test/desktop/private-update-feed.test.js`
- Create: `test/desktop/update-build-metadata.test.js`

**Interfaces:**
- Produces: `getUpdateChannel(name)` returning `{ name, feedURL, releaseRoot }` for `development` or `public`.
- Produces: `validateRelease(value, currentBuild, channel)` and `fetchRelease(net, currentBuild, channel)`.
- Produces: embedded `private-update-build.json` containing `{ build, sourceSha, clean, channel }`.

- [ ] **Step 1: Write failing channel-isolation tests**

Add cases equivalent to:

```js
assert.equal(validateRelease(publicRelease, oldBuild, 'public'), publicRelease);
assert.throws(() => validateRelease(publicRelease, oldBuild, 'development'));
assert.throws(() => validateRelease(developmentRelease, oldBuild, 'public'));
assert.throws(() => getUpdateChannel('missing'));
```

Add metadata tests that invoke `write-update-build.js --channel public` in a temporary git fixture and assert the channel is embedded; an omitted/unknown channel must exit nonzero.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 20.5.1
node --test test/desktop/private-update-feed.test.js test/desktop/update-build-metadata.test.js
```

Expected: failure because channel-aware interfaces and the renamed writer do not exist.

- [ ] **Step 3: Implement channel selection without fallback**

Define only these channel values:

```js
const UPDATE_CHANNELS = Object.freeze({
    development: {
        name: 'development',
        feedURL: 'https://downloads.michaeldewald.com/keeweb/arm64/latest.json',
        releaseRoot: 'https://downloads.michaeldewald.com/keeweb/arm64/'
    },
    public: {
        name: 'public',
        feedURL: 'https://downloads.michaeldewald.com/keeweb/public/arm64/updates.json',
        releaseRoot: 'https://downloads.michaeldewald.com/keeweb/public/arm64/'
    }
});
```

Make the updater pass `buildInfo.channel` to `fetchRelease`. Update the development build script to call the renamed writer with `--channel development`. Do not retain a compatibility wrapper for the old filename.

- [ ] **Step 4: Run focused tests and the existing updater suite**

Run:

```bash
node --test test/desktop/private-update-feed.test.js test/desktop/update-build-metadata.test.js
npm run test:private-updater
```

Expected: all tests pass.

- [ ] **Step 5: Commit the channel boundary**

```bash
git add desktop/scripts scripts/dev test/desktop
git commit -m "feat: separate public and development update channels"
```

### Task 2: Model and verify public release artifacts

**Files:**
- Modify: `scripts/release/verify-update-app.js`
- Create: `scripts/release/public-release-manifest.js`
- Create: `scripts/release/prepare-public-release.js`
- Create: `test/desktop/public-release-manifest.test.js`
- Create: `test/desktop/update-app-signing-policy.test.js`

**Interfaces:**
- Produces: `signingPolicy(channel)` with the expected authority, team, bundle ID, and designated requirement.
- Produces: `verifyUpdateApp(appPath, channel)`.
- Produces: `createPublicRelease({ buildInfo, version, dmgBytes, zipBytes, publishedAt })` returning `{ release, updateFeed, websiteManifest, checksumText }`.
- Consumes: a signed/stapled `.app` and notarized/stapled `.dmg`; writes a prepared build directory only.

- [ ] **Step 1: Write failing pure-policy and manifest tests**

Cover the exact Developer ID authority, bundle ID, team ID, arm64 requirement, clean-tree classification, immutable build URLs, stable latest DMG/checksum URLs, website schema v1, and public updater feed. Include rejection tests for dirty metadata, smoke metadata, wrong channel, wrong SHA length, invalid build ID, and a cross-channel URL.

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
node --test test/desktop/public-release-manifest.test.js test/desktop/update-app-signing-policy.test.js
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement strict public preparation**

`prepare-public-release.js` must:

```text
verify app bundle identity/signature/channel -> verify DMG exists -> create stapled-app KeeWeb.zip -> hash ZIP and DMG -> generate immutable update.json and release.json -> generate updates.json and website latest.json -> write checksum text
```

Use `verifyUpdateApp(appPath, 'public')`. Require `buildInfo.clean === true`, `buildInfo.channel === 'public'`, and a UTC 14-digit build ID. The website manifest must name `keeweb-latest-macos-arm64.dmg` and exact keys below `keeweb/public/arm64/latest/`.

- [ ] **Step 4: Run focused tests and private updater regression tests**

```bash
node --test test/desktop/public-release-manifest.test.js test/desktop/update-app-signing-policy.test.js
npm run test:private-updater
```

- [ ] **Step 5: Commit public artifact preparation**

```bash
git add scripts/release test/desktop
git commit -m "feat: prepare verified public KeeWeb releases"
```

### Task 3: Add the canonical Developer ID build and notarization entrypoint

**Files:**
- Modify: `Gruntfile.js`
- Modify: `grunt/config-sign.js`
- Create: `scripts/release/build-public-macos.sh`
- Create: `scripts/release/test-build-public-macos.sh`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `docs/follow-ups/2026-09-17-private-fork-updater.md`

**Interfaces:**
- Produces: `npm run build:public-macos -- [--output-root PATH]`.
- Produces: `.release-artifacts/public/<build>/` containing the app, DMG, ZIP, checksum, immutable metadata, `updates.json`, and website `latest.json`.
- Consumes: Keychain Developer ID identity and notary profile `mick-notary`; no plaintext credentials.

- [ ] **Step 1: Write a failing shell-policy test**

`test-build-public-macos.sh` must inspect and exercise preflight behavior. Assert the script requires a clean tree, exact Developer ID common name, `KEEWEB_CODESIGN_CONFIG` isolation, public build metadata, app notarization, app stapling, DMG notarization, DMG stapling, signature verification, and Gatekeeper assessment. Assert it contains no ad-hoc or Apple-Development fallback.

- [ ] **Step 2: Run the policy test and confirm RED**

```bash
bash scripts/release/test-build-public-macos.sh
```

Expected: failure because `build-public-macos.sh` does not exist.

- [ ] **Step 3: Make signing configuration injectable and provisioning optional**

Change the signing config load boundary to:

```js
const codeSignConfigPath = process.env.KEEWEB_CODESIGN_CONFIG || './keys/codesign.json';
const getCodeSignConfig = () => (skipSign ? { identities: {} } : require(codeSignConfigPath));
```

Only set the `provisioning-profile` option when a non-null path was explicitly supplied. Preserve the development script's current default behavior.

- [ ] **Step 4: Implement the public build sequence**

Use a temporary JSON signing config containing only the exact Developer ID identity and team ID. Run the established web/Electron/native-module build tasks with `write-update-build.js --channel public`, then sign. Submit a ZIP of the signed app to `notarytool`, staple and validate the app, generate the DMG via `appdmg:arm64`, submit/staple/validate the DMG, and assess both with `spctl`. Finally call `prepare-public-release.js`.

The script must clean its temporary signing config on exit and must not install or launch the app during preparation.

- [ ] **Step 5: Run shell policy, deploy-policy, and updater tests**

```bash
bash scripts/release/test-build-public-macos.sh
npm run test:macos-deploy-target
npm run test:private-updater
```

- [ ] **Step 6: Produce and inspect a local public draft**

After committing the implementation so the tree is clean, run:

```bash
npm run build:public-macos
```

Verify the resulting app and DMG authority, runtime, entitlements, notarization tickets, Gatekeeper results, architecture, manifest paths, and local SHA-256. Do not publish yet.

- [ ] **Step 7: Commit the public build lane**

```bash
git add Gruntfile.js grunt/config-sign.js scripts/release package.json .gitignore docs/follow-ups
git commit -m "feat: build notarized public macOS releases"
```

### Task 4: Publish public artifacts transactionally

**Files:**
- Create: `scripts/release/r2-client.js`
- Modify: `scripts/release/publish-private-update.js`
- Create: `scripts/release/publish-public-release.js`
- Modify: `test/desktop/private-update-publisher.test.js`
- Create: `test/desktop/public-release-publisher.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: reusable `createR2Client({ account, access, secret, fetch, https })` with `putConditional`, `verifyBytes`, and `readMutable`.
- Produces: `npm run publish:public-macos -- <prepared-directory> --publish`.
- Preserves: current private publisher behavior and paths.

- [ ] **Step 1: Write failing publisher-order and collision tests**

Record every mocked PUT/GET. Assert this order:

```text
immutable DMG/checksum/ZIP/update/release -> stable DMG -> stable checksum -> updates.json -> latest.json
```

Test strong ETag compare-and-swap, weak/missing ETag refusal, HTTP 412 with identical bytes accepted, HTTP 412 with different bytes rejected, non-increasing build refusal, source-SHA mismatch, and failure before `latest.json` when any earlier verification fails.

- [ ] **Step 2: Run publisher tests and confirm RED**

```bash
node --test test/desktop/private-update-publisher.test.js test/desktop/public-release-publisher.test.js
```

- [ ] **Step 3: Extract the R2 client and implement the public publisher**

Keep request signing and secret handling in `r2-client.js`. Export functions instead of slicing source text with `vm`; update private publisher tests to import real units. The public publisher must validate every local byte against `release.json`, verify clean current HEAD, and write website `latest.json` last.

- [ ] **Step 4: Run all publisher and updater tests**

```bash
node --test test/desktop/private-update-publisher.test.js test/desktop/public-release-publisher.test.js
npm run test:private-updater
```

- [ ] **Step 5: Commit transactional publication**

```bash
git add scripts/release test/desktop package.json
git commit -m "feat: publish public KeeWeb releases transactionally"
```

### Task 5: Prove Developer ID old-to-new updates safely

**Files:**
- Modify: `scripts/dev/private-updater-smoke-entry.js`
- Create: `scripts/release/test-public-updater.sh`
- Create: `test/desktop/public-updater-acceptance-policy.test.js`
- Modify: `docs/follow-ups/2026-09-17-private-fork-updater.md`

**Interfaces:**
- Produces: isolated `.updater-smoke` Developer ID fixtures for builds N and N+1.
- Produces: a non-production local HTTP feed exercising the public channel without touching the production feed, KeeWeb data, or `/Applications/KeeWeb.app`.

- [ ] **Step 1: Write a failing acceptance-policy test**

Require the smoke script to use the isolated bundle ID, exact Developer ID identity, two increasing build IDs, local feed override limited to smoke metadata, SHA-256 verification, valid-update install/launch proof, invalid-signature preservation proof, and no access to real app data or production install paths.

- [ ] **Step 2: Run the policy test and confirm RED**

```bash
node --test test/desktop/public-updater-acceptance-policy.test.js
```

- [ ] **Step 3: Implement and execute the isolated acceptance flow**

Build two fixtures through the same public signing code, serve N+1 over a loopback server, and record machine-readable evidence for discovery, download, signature rejection, preserved old build, valid installation, and new-build launch.

- [ ] **Step 4: Run the acceptance test and the complete KeeWeb suite**

```bash
bash scripts/release/test-public-updater.sh
npm test
npm run test:macos-deploy-target
```

- [ ] **Step 5: Commit updater acceptance coverage**

```bash
git add scripts/dev scripts/release test/desktop docs/follow-ups
git commit -m "test: prove public KeeWeb update trust chain"
```

### Task 6: Review, merge, and publish the first public release

**Files:**
- Modify only if review finds a confirmed defect in files already owned by Tasks 1-5.

**Interfaces:**
- Produces: merged `origin/master`, published R2 artifacts, installed public KeeWeb app, and live strict manifests.
- Produces for the website: `https://downloads.michaeldewald.com/keeweb/public/arm64/latest.json`.

- [ ] **Step 1: Run final local verification from the clean feature branch**

Run the complete KeeWeb test suite, deploy-policy tests, public updater acceptance, formatting/lint checks, diff checks, and a notarized local public build. Record only fresh results.

- [ ] **Step 2: Review the complete branch diff**

Check identity selection, entitlements, nested signing, publisher ordering, secret redaction, exact object paths, failure cleanup, and absence of development-channel regression.

- [ ] **Step 3: Commit any confirmed review fixes and rerun affected checks**

Use focused commits; do not mix unrelated KeeWeb cleanup into this release.

- [ ] **Step 4: Push, open the KeeWeb PR, wait for green CI, and merge**

Do not publish from the feature branch. Confirm the PR's real `mergedAt` timestamp before cleanup.

- [ ] **Step 5: Sync clean canonical `master` and build the release there**

Run the canonical public build entrypoint from the exact merged revision. Verify Developer ID authority, Hardened Runtime, nested signatures, notarization, stapling, Gatekeeper, DMG contents, size, and SHA-256.

- [ ] **Step 6: Publish with Keychain-injected R2 credentials**

Run the public publisher with explicit `--publish`. Read back and byte-verify every immutable object, stable DMG/checksum, `updates.json`, and website `latest.json` over the public origin.

- [ ] **Step 7: Install and smoke the public DMG**

Preserve user data; replace only the application bundle. Launch the public app without opening a real database, verify the displayed build and manual update check, then perform the bounded Touch ID/Keychain smoke agreed by the repo workflow.

- [ ] **Step 8: Complete merged-branch cleanup and absence proof**

Remove the KeeWeb feature worktree/branch only after merge verification and confirm canonical `master` equals `origin/master` with no local/remote task refs.


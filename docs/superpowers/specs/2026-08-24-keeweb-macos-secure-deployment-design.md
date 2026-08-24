# KeeWeb macOS Secure Deployment Design

Date: 2026-08-24

## Status

Approved direction, pending review of this written specification before implementation.

## Context

This private KeeWeb fork is built locally, signed with the user's Apple Development identity, and installed as `/Applications/KeeWeb.app` with bundle identifier `com.mickdewald.keeweb` and team identifier `GGYLL32K99`.

The app previously ran as `/Applications/KeeWeb-Codex.app`. Renaming it to the canonical path activated KeeWeb's legacy `AppRightsChecker`, which matches `/Applications/KeeWeb.app`, launches an embedded privileged installer, and changes the bundle owner to root. The current development deployment script initially installs a user-owned app, so the first launch triggers that installer; later deployments then fail when they attempt to replace the root-owned bundle without a privileged installation step.

An independent security review also identified broader packaging defects:

- the custom macOS build skips the repository's Electron patch task;
- the installed Electron 43 bundle has unsafe default fuses;
- the legacy Electron patcher is incompatible with Electron 43;
- the embedded installer builds privileged shell commands from insufficiently escaped paths;
- the disabled upstream updater still has reachable installation entry points;
- the deployment is not atomic and verifies signature consistency without enforcing signer identity.

The goal is one coherent security and deployment model, not another path- or ownership-specific workaround.

## Goals

1. Prevent Electron debug and run-as-Node features from executing code under KeeWeb's identity.
2. Validate `app.asar` at runtime and prevent fallback to unpacked application code.
3. Remove the embedded privileged installer and all automatic startup-time privilege prompts from this fork.
4. Keep the upstream application updater disabled and make its install path unreachable in both renderer and main processes.
5. Preserve system-level write protection for the installed password-manager bundle.
6. Make local deployment transactional, recoverable, identity-verified, and initiated by one explicit macOS authorization prompt.
7. Keep Touch ID, keychain identity, native messaging, and existing KeeWeb behavior intact.
8. Make future packaging regressions fail automated tests before an app is installed.

## Non-goals

- Re-enable upstream KeeWeb auto-updates.
- Add a permanently privileged helper, daemon, LaunchAgent, or passwordless sudo rule.
- Modernize all inherited Electron IPC in the same change.
- Change KDBX storage, encryption, Touch ID recovery, or application UX.
- Remove existing backup apps automatically.
- Claim notarized distribution; the local build remains an Apple Development-signed build unless a separate release task adds notarization.

The unrestricted `spawnProcess` IPC bridge is a separate security concern. This work must document and open a follow-up for an allowlist-based design, but it must not be silently mixed into the installer remediation without mapping every current caller and testing those workflows.

## Threat model

### In scope

- An unprivileged local process attempts to run Node or debugger capabilities through the signed KeeWeb executable.
- A renderer compromise attempts to reach a disabled update or privileged installer path.
- A malformed or substituted staging bundle is installed under KeeWeb's bundle identity.
- Deployment interruption leaves `/Applications/KeeWeb.app` missing or partially copied.
- Path manipulation or shell metacharacters alter a privileged deployment command.
- A future build accidentally re-enables unsafe Electron fuses or restores the embedded installer.

### Out of scope

- A fully compromised administrator/root account.
- Physical attacks outside the logged-in macOS session.
- General malware with every permission already granted to KeeWeb.
- Upstream KeeWeb release infrastructure, because this fork does not consume upstream app updates.

## Security model

The final design uses defense in depth:

1. **Electron fuses** remove unused execution and inspection features from the signed binary.
2. **ASAR integrity** verifies packaged JavaScript and prevents fallback loading.
3. **Codesigning requirements** bind accepted deployments to the expected bundle and Apple team identities.
4. **Root-owned installation** provides system-level write protection under the actual macOS `/Applications` behavior, including its `sunlnk` directory flag.
5. **No embedded privileged installer** removes a high-risk, app-triggerable escalation surface.
6. **Transactional deployment** stages and verifies before changing the visible application path and retains rollback material.

Root ownership and ASAR integrity are complementary. Root ownership does not replace cryptographic integrity, and ASAR integrity does not justify leaving an installed password-manager bundle casually writable.

## Architecture

### 1. Modern Electron hardening

Replace the obsolete `electron-evil-feature-patcher` packaging step for this macOS build with a maintained task based on `@electron/fuses`.

Before signing, set and assert:

- `RunAsNode = false`
- `EnableNodeOptionsEnvironmentVariable = false`
- `EnableNodeCliInspectArguments = false`
- `EnableEmbeddedAsarIntegrityValidation = true`
- `OnlyLoadAppFromAsar = true`

The packaged app already contains an `ElectronAsarIntegrity` entry. The implementation must verify that the hash exists and matches the generated `app.asar`; it must not assume the packager generated it correctly.

Chromium debugging switches such as `--remote-debugging-port` are not fully covered by the listed fuses. Before implementation is accepted, the team must select and prove an Electron-43-compatible control. Acceptable options are:

- a maintained, version-compatible binary hardening mechanism; or
- an earliest-possible startup rejection that demonstrably prevents a listener before secrets are loaded.

The obsolete patcher cannot be retained merely because a Grunt task already exists: it fails against the current Electron 43 binary with duplicate string matches.

The hardening task must run after packaging and before signing. Any binary or `Info.plist` mutation after signing is prohibited.

### 2. Remove privileged runtime installer paths

For this fork's macOS artifact:

- do not build or embed `KeeWeb Installer.app`;
- remove `AppRightsChecker` initialization and its fork-unused settings and locale copy;
- prevent renderer `installAndRestart()` from acting when `Updater.enabled` is false;
- reject restart-and-update requests in the main process when updates are disabled or no verified pending update exists;
- do not copy an installer to a predictable temporary directory;
- do not run privileged shell strings from application-controlled arguments.

The upstream source can retain generic installer code if other targets still require it, but the private macOS build and runtime must have no reachable embedded installer. The implementation should prefer explicit build/runtime capabilities over filename checks.

### 3. Transactional local deployment

The build script remains the only supported way to replace the installed fork.

#### Unprivileged phase

1. Resolve canonical absolute source and target paths.
2. Build application content.
3. Package Electron.
4. Apply and verify hardening.
5. Copy native modules and native messaging host.
6. Sign the complete bundle.
7. Verify the staged bundle with a designated requirement that includes:
   - identifier `com.mickdewald.keeweb`;
   - certificate leaf organizational unit `GGYLL32K99`.
8. Ask KeeWeb to quit normally and wait long enough for clean database handling.
9. If it remains open, stop and report the condition by default. A force-close requires an explicit command option and a clear warning.

#### Privileged phase

The privileged operation is user-initiated from the deployment command and receives no arbitrary shell fragments. It uses fixed, already-canonicalized paths and argument-safe process invocation or a small audited script with no dynamic shell evaluation.

1. Create a unique staging directory on the `/Applications` volume.
2. Copy the already verified bundle into that directory.
3. Clear only the intended quarantine/provenance attributes required by the local deployment policy.
4. Set the intended installation owner and group explicitly.
5. Verify the staged copy again with the full signing requirement.
6. Move the current app to a unique backup name.
7. Rename the staged app to `/Applications/KeeWeb.app` on the same volume.
8. Verify the visible installed bundle again.
9. If any step after moving the old app fails, restore the old app before returning failure.

Backups are mandatory for replacement. Retention cleanup is a separate explicit operation; the deployment never silently deletes historical backups.

#### Return to unprivileged phase

1. Confirm the installed path, owner, group, bundle identifier, team identifier, and signature requirement.
2. Start KeeWeb as the logged-in user, never from the privileged script.
3. Confirm the running executable path.
4. Confirm no `KeeWeb Installer` process exists.

### 4. Entitlements

`com.apple.security.cs.allow-dyld-environment-variables` must be removed unless a concrete current dependency proves it is required. The build must test launch, Touch ID, native modules, and keychain behavior without it.

`allow-jit` and `allow-unsigned-executable-memory` may remain only if required by Electron. Their presence increases the importance of disabling run-as-Node/debug capabilities and validating app content.

No `disable-library-validation` entitlement may be introduced.

### 5. Updater policy

The fork has one update authority: the local deployment script.

- `Launcher.updaterEnabled()` remains false.
- Update settings remain hidden/inert.
- Renderer and main-process update installation calls fail closed.
- No upstream DMG or update JSON can trigger application replacement.
- Plugin updating is a separate mechanism and is not changed by this policy.

## Failure handling

- Build/hardening/signing failure: installed app is untouched.
- Graceful quit failure: deployment stops before privileged changes.
- Authorization cancellation: installed app is untouched.
- Staging or identity verification failure: installed app is untouched.
- Swap failure after backup move: rollback restores the previous visible app.
- Post-swap verification failure: rollback restores the previous app and reports both verification and rollback status.
- Start failure after successful verified swap: keep the verified new app, report failure, and provide the exact backup path for explicit rollback.

## Automated verification

### Packaging tests

- Read the packaged Electron fuse wire and assert every required value.
- Assert the old patcher sentinel is not used as a substitute for modern fuse checks.
- Assert `ElectronAsarIntegrity` exists and matches `app.asar`.
- Assert no `Contents/Installer/KeeWeb Installer.app` exists.
- Assert forbidden entitlements are absent.
- Assert full signing requirement, identifier, and team identifier.
- Assert packaging/hardening occurs before signing.

### Runtime/update tests

- `Updater.installAndRestart()` is inert when updates are disabled.
- Main-process restart-and-update rejects disabled or unverified requests.
- No startup code invokes `AppRightsChecker` or an installer in the fork.

### Deployment tests

Use a temporary target, fake process controls, and failure injection to prove:

- the original remains visible until a verified stage exists;
- backup is mandatory;
- interrupted copy does not damage the original;
- failure during either rename rolls back;
- ad-hoc, wrong-identifier, and wrong-team bundles are rejected;
- paths containing spaces and shell metacharacters remain literal;
- normal quit is attempted and force kill is opt-in only;
- application start occurs unprivileged after the privileged phase.

## Real macOS acceptance

On the installed artifact:

1. `ELECTRON_RUN_AS_NODE=1` cannot run JavaScript.
2. `NODE_OPTIONS` cannot inject options.
3. `--inspect`, `--inspect-brk`, and `--remote-debugging-port` expose no debugger listener.
4. A disposable copy with a modified `app.asar` refuses to start.
5. Codesign verification with the expected requirement passes.
6. Touch ID unlock succeeds.
7. Native messaging and required native modules still load.
8. Two consecutive deployments complete with one intentional authorization prompt each and no manual `chown`.
9. Normal starts show no installer or rights dialog.
10. The installed bundle remains root-owned after restart.
11. Trash, Health, Settings, search restoration, and the press-state UI still work.

Tests that execute the app as Node or modify an ASAR must use only the Demo database or a disposable bundle copy. They must never open, copy, or inspect a personal KDBX file.

## Rollout

1. Add failing packaging assertions for current unsafe fuse and installer state.
2. Introduce modern fuse and ASAR hardening.
3. Close renderer and main-process update installation entry points.
4. Remove the embedded installer and startup rights checker from the fork artifact.
5. Replace the deployment flow with staged identity verification, privileged swap, and rollback.
6. Run automated tests and independent security review.
7. Build and verify a disposable artifact without installing it.
8. Perform one controlled migration from the current installed app.
9. Run the complete real macOS acceptance matrix.

## Rejected alternatives

### Keep the current behavior

Rejected because it causes an unexpected privilege prompt at normal startup and creates a broken deploy loop.

### Return to `KeeWeb-Codex.app`

Rejected because it bypasses a hard-coded path check accidentally and abandons the canonical product name without fixing the security model.

### Make the installed app permanently user-owned and only remove the checker

Rejected as the default because it discards a real macOS write-protection layer. Modern Electron integrity controls are required either way and should be combined with system-level protection for a password manager.

### Keep the embedded installer but repair its escaping

Rejected because the fork does not consume upstream application updates, and retaining an app-triggerable privileged installer creates unnecessary attack surface even after escaping fixes.

### Install a privileged helper or passwordless sudo rule

Rejected because the convenience does not justify a persistent escalation primitive for an occasional local deployment.

## External review gate

Before installation, an independent reviewer must verify:

- modern fuse configuration and build ordering;
- ASAR hash generation and runtime enforcement;
- complete removal or unreachability of installer/update escalation paths;
- privilege boundary and shell-safety of deployment;
- atomicity and rollback behavior;
- signer identity enforcement;
- preservation of Touch ID and keychain access assumptions.

Critical or Important findings block installation.

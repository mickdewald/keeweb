# Android app: follow-ups after the first implementation

Collected from the task reviews and the final whole-branch review of
`docs/superpowers/plans/2026-09-30-android-app.md`. This records the earlier review, plus the pre-device hardening below. Earlier
acceptance does not imply handset or real Drive verification. Items marked **device** must be checked during device acceptance
(plan Task 10).

## Check on the device

Physical Debug evidence now exists in `docs/android-device-acceptance.md`: five fixture flows, actual Drive
open, verified new-copy export to the Mac, biometric cancellation and subsequent successful unlock, and
cold-process recovery/merge with the competing Android edit retained in history. The latest explicit product
requirement, bidirectional sync of the same Drive file, is a **P1 acceptance blocker**. The intended integration uses Android's system document picker with Google Drive. No user-supplied Google Cloud project ID is required for that path;
our existing read-only implementation must gain reviewed same-file writing and conflict/recovery behavior. The reconnected phone also passed actual clipboard expiry/restart cleanup, attachment and key round trips,
offline cache opening, German grant-loss/reselection, and generated-factor export. This is Debug evidence;
full device and release acceptance remain separate. The final pause-only lifecycle gap was corrected and reproduced as locked on a fresh Debug APK; picker/biometric cancellation and screen-off passed.

- **device** Android/Drive provider: readonly opens, verified new-copy exports, original preservation, offline errors and reselect. In-place SAF writes are being restored with revision checks and durable recovery; same-file Drive sync needs a fresh provider acceptance run.
- **device** Confirm Drive deletion/revocation offers "Choose file again" when metadata positively identifies a missing file. Provider/query failures remain retryable rather than guessed as deletion.
- **device** Verify rapid biometric cancellation/replacement and password fallback with the physical OS prompt; the production handoff coordinator is covered in instrumentation.
- **device** Safe-area insets on displays with cutouts (the E2E layout step only asserts `top >= 0`).
- **device** German unreachable-file/reselection notice was observed and recovered successfully; remaining prompt translations need separate acceptance.

## Current limitations

- While Android has killed the process, its clipboard timer cannot execute. The next foreground return restores expiry from a persisted HMAC/due time; the interval until that return remains uncovered.
- When the clipboard cannot be read (app in the background), it is cleared unconditionally. A value another app copied inside the window is removed.
- Cache/encryption failure keeps uncommitted data in memory behind the locked, hidden, input-blocked screen. Retry persistence before terminating the process.
- Database closure waits for running sync and pending imports. A provider that never settles can delay closure, while the workspace remains hidden and input-blocked.
- The APK secret check now decodes compiled manifest/resources and rejects credential aliases. It remains a heuristic guard, not a proof about arbitrary binary secrets.
- An `IllegalBlockSizeException` from a transient Keystore fault also clears the saved biometric passwords. The user then re-enters the master password once.

## Completed in pre-device hardening (local, not shipped)

- Background locking with auto-save off uses an encrypted local cache without external writes; snapshot waits for active sync completion.
- Relink waits for old sync completion to fully unwind; duplicate URI targets are rejected and replacement completion callbacks are chained.
- Document reselect is guarded while unlock/native flows are busy. Unsupported document-storage "Save to" options are hidden.
- Reentrant alerts no longer block locking; biometric feedback has its own accessible dismiss button; nested links preserve navigation.
- Added back-action, read-only-copy, non-Android single-instance and Android updater-gate regressions.
- Serialized biometric prompt replacement keeps the old AndroidX callback installed through cancellation; bounded cancellation failure falls back to the password.
- The unchanged AndroidX Biometric version is declared alongside the other Android dependency versions.
- Clipboard expiry persists only a Keystore-HMAC/due time and restores the timer on foreground return after process restart.
- APK resource scan fails closed, including aliases and metadata references; malicious compiled test APKs cover the guard.
- CDP target/connection readiness and paths with spaces are checked; fixture reset rejects physical devices and the stable app.
- Emulator logs use unique temporary paths. The supervised verification command owns startup, test execution and cleanup, including failed startup.

## Astra remediation

The full Astra review superseded the earlier limited acceptance. Recovery records now commit bytes and metadata
atomically; global lock generations reject late authentication and immediately block the UI, including app-owned
pickers. Factor changes, picker lifetime and verified native exports have regressions. The second review also
identified shared-browser FileReader and normal-sync/close/reset races; their corrections were included in the final bundled countercheck.
The final GPT-6 Astra countercheck closed these regressions and all seven original findings, with no evidenced
P0/P1/P2 finding from this review left open. See `docs/android-astra-final-review.md` for the verdict and evidence.
No physical or release acceptance is implied.

## Remaining code and test polish

- E2E screen-layout coverage cannot establish safe areas on every cutout device. The German unreachable-file notice and native biometric cancellation/unlock have handset evidence; complete prompt/enrollment behavior remains a separate check.
- StrongBox is not used because of the MGF1-SHA-1 compatibility requirement; hardware backing and physical-device behavior need acceptance.
- Recheck the AndroidTest Kotlin stdlib exclusion on Android Gradle Plugin upgrades.
- Existing `test/src` lint debt and the old Android `.mjs` parser limitation remain; production Grunt lint and focused changed JS tests are checked separately.

See `docs/android-predevice-status.md` for the fresh verification and device checklist.

The subsequent ordinary-picker read/write implementation is tracked separately in
[2026-10-01-android-saf-sync.md](2026-10-01-android-saf-sync.md). Local implementation does not supersede
the earlier installed APK evidence until the new native and physical provider gates pass.

Those subsequent gates now passed: the latest Debug APK supports actual same-file Google Drive
Mac → Android → Mac synchronization of the disposable database, including cold-process recovery and
persistent write capability. Independent Astra decryption confirmed the matching final Mac/Android hash.
The final device record supersedes the historical copy-only blocker. Drive can refresh slowly;
concurrent atomic writes, release and real-database use remain separate acceptance boundaries.

# Android app: follow-ups after the first implementation

Collected from the task reviews and the final whole-branch review of
`docs/superpowers/plans/2026-09-30-android-app.md`. None of these blocked the
merge review. Items marked **device** must be checked during device acceptance
(plan Task 10).

## Check on the device

- **device** Google Drive as document provider: truncating write mode (`"wt"`), offline errors, sync delay in both directions. Verify-after-write is the safety net.
- **device** A Drive file deleted outside the app while the access grant is still held shows "not available right now" indefinitely and never offers "Choose file again".
- **device** A late `ERROR_CANCELED` from a biometric prompt cancelled on stop could, in theory, cancel the next prompt.
- **device** Safe-area insets on displays with cutouts (the E2E layout step only asserts `top >= 0`).
- **device** German texts (biometrics, unreachable-file notice) have not been seen on screen.

## Known limitations (accepted)

- The clipboard clear timer is lost if Android kills the process inside the clear window. A WorkManager or AlarmManager fallback would close this.
- When the clipboard cannot be read (app in the background), it is cleared unconditionally. A value another app copied inside the window is removed.
- Pressing Home while the document picker is open does not lock. Only the idle timer applies.
- With auto-save off and unsaved changes, going to the background leaves the database unlocked (existing KeeWeb behaviour). `docs/android.md` says "always locks", which overstates this.
- The APK secret check cannot see binary `AndroidManifest.xml` meta-data or `resources.arsc`.
- An `IllegalBlockSizeException` from a transient Keystore fault also clears the saved biometric passwords. The user then re-enters the master password once.

## Code and test polish

- Relink race: a sync already running when the user relinks can write the old URI back. The banner reappears; no data is lost.
- The same URI can end up in two FileInfos.
- "Save to" the Android document storage from another storage fails with `REV_REQUIRED` (that path never worked).
- The unreachable-file banner has no busy check against an unlock in progress.
- Lockout text shares `.open__message` with the pending-unlock message; dismissing it rejects a pending unlock request.
- `Alerts.closeAll()` does not catch an alert opened synchronously by another alert's close handler.
- `e.target.tagName` in the touch copy logic misses nodes nested inside `<a>`.
- Missing tests:
  - non-Android `SingleInstanceChecker` still arms;
  - updater service-worker gate;
  - `performBackAction` close and clear-search actions;
  - tapping a read-only field that has a value.
- E2E harness:
  - fixed start-up sleep before connecting;
  - `reconnect` and `{ connection }` do the same job;
  - unlock asserts only that some list items render.
- `cdp.mjs`:
  - page lookup is unguarded;
  - the entry-point check breaks on paths with spaces.
- `emulator.sh` logs to a fixed `/tmp` path.
- `androidx.biometric` is pinned inline in `app/build.gradle` instead of `variables.gradle`.
- StrongBox is not used, because of the MGF1-SHA-1 compatibility requirement.
- The `AndroidTest` configuration-name match for the Kotlin stdlib exclusion needs a recheck on Android Gradle Plugin upgrades.
- Lint:
  - `npx eslint test/src` shows old errors in test files from `master`;
  - `scripts/android/*.mjs` cannot be linted without a parser change (top-level `await`).

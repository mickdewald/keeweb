# Android pre-device status — 2026-10-01

Worktree: `keeweb-android-spec`, branch `codex/android-predevice-hardening`, based on
`2c00bfc2ed978613f63cfbe10ea7dfa811d2d54d`. Changes are local and uncommitted.
Nothing has been pushed or released. The reviewed Debug APK has subsequently been installed on the
physical handset; see [the device acceptance record](android-device-acceptance.md). Same-file bidirectional
Drive synchronization is still an unmet requirement.

## Astra remediation

The first full Astra review found five P1 and two P2 issues. Preparation now includes:

- Immediate hidden, inert, input-blocked workspace from native pause (including pause-only returns), including app-owned
  pickers and pending unlocks with no open database. Password buffers clear; old authentication results are rejected.
- Recovery bytes and factor metadata stored atomically; IndexedDB success waits for transaction completion.
  Startup merges recovery metadata even when the settings mirror is absent or stale.
- Version-bound normal sync and all-file revalidation before lock closure. Later edits and credential changes
  remain pending; obsolete callbacks cannot overwrite a reopened file's recovery or reactivate a closed file.
- Native readonly attachment/key-file imports register pending work before leaving the app. Results retain
  their originating context; cancel/error releases pending work. Generated factors apply only after verified export.
- SAF in-place writes disabled. **Save new copy** creates a uniquely named document and verifies exact readback,
  protecting known originals and URI aliases. A copy does not update the original or clear its local pending changes.
- Biometric cancellation/handoff, clipboard expiry, APK scanning and supervised fixture-emulator validation.

The second Astra pass found additional shared Browser/Desktop FileReader, close/sync/reset and lock-coordination
regressions. Their corrections pass the integrated checks below. The final independent **GPT-6 Astra**
countercheck closed all seven original findings and all second-pass regressions: no evidenced P0/P1/P2 finding
from this review remains open. See [the final review](android-astra-final-review.md).

The verdict permits fixture-first physical-device testing. It does not certify real password databases,
the signed release lane, publication or a comprehensive audit of historic dependencies. Later physical checks
confirmed and corrected a pause-only lifecycle gap; same-file Drive sync remains the separate P1 requirement.

## Verification

Earlier build/test results were superseded by the full review. Fresh integrated verification on 2026-10-01:

- `npm test`: 341 browser tests and 101 desktop/updater tests passed.
- `npm run lint`, `python3 scripts/check-file-sizes.py` and `git diff --check`: passed.
- `npm run test:android-tools`: originally 7 Node tests and 16 Python tests passed; the subsequent physical
  runner and its guards increase the passing Node count to 12, with the same 16 Python tests.
- `npm run android:verify`: debug build, all 34 native instrumentation tests, five fixture E2E flows and
  APK credential scan passed. E2E covers unlock, back from details, layout, tap-to-copy and background/return;
  return requires a visible empty password input with no lock overlay.
- The supervised wrapper stopped its emulator and Gradle daemon; the final ADB device inventory was empty.

The integrated build evidence uses the **Debug lane**, dedicated Android 14 `KeeWebSpike` emulator and
disposable fixture bytes. Subsequent physical Debug checks are recorded separately; signed-release acceptance
is not claimed. Debug APK SHA-256:
`b7459bbec37f9668adf26dbc5caa834c0b4dd8b9788769e8e7d2cb87f7be8730`.

Transient root logs: `/tmp/keeweb-remediation-browser-closure.log`,
`/tmp/keeweb-remediation-lint-closure.log`, `/tmp/keeweb-remediation-android-closure2.log`.
Native XML: `android/app/build/outputs/androidTest-results/connected/debug/TEST-KeeWebSpike(AVD) - 14-_app-.xml`.

The final lifecycle correction passed 344 browser tests and focused production lint. Its fresh Debug build,
credential scan and in-place handset install passed. Pause-only return, native picker cancellation,
biometric cancellation/password fallback and screen-off were checked on that APK. Broader attachment,
factor, offline, clipboard and grant-loss results are in the device report with the earlier APK identity.

## Physical acceptance

The connected Android 15 handset has passed the five fixture E2E flows, initial Mac-to-Drive-to-Android read,
verified new-copy export back to the Mac, biometric cancellation/password fallback and local recovery after
the export. These results do not prove same-file bidirectional sync. See
[android-device-acceptance.md](android-device-acceptance.md) for the exact scope and remaining checks.

1. Establish permanent release signing and a reviewed clean revision; build/scan the signed standalone APK.
   Keep the signing key stable for in-place updates. The default signing material was absent; no value was read.
2. Install beside existing password apps and start with a disposable database. Verify master-password unlock,
   biometric enable/unlock/cancel/replacement and enrollment changes on the physical OS.
3. Check Home/app-switch/screen-off, edited-entry/attachment/factor recovery, clipboard expiry and process restart.
4. With disposable provider files, verify readonly opens, new-copy exports, original preservation, offline
   recovery, revoked access, missing files, reselect and concurrent external edits. Emulator evidence cannot
   prove Google Drive behavior. Same-file automatic Drive synchronization is disabled in the safe SAF workflow.
5. Check German messages, keyboard/back behavior, display cutouts, touch targets and responsiveness.

## Remaining limits

- Persistence failure or a hung operation keeps the workspace hidden and blocked while data remains in memory.
  Terminating the process before successful recovery persistence can lose uncommitted changes; retry saving.
- A killed process cannot execute clipboard expiry until it returns. Android may prevent background ownership
  reads, so the existing unconditional clear can remove a value copied by another app.
- StrongBox is unused because of the existing MGF1 compatibility requirement. Hardware/OS biometric behavior
  remains a handset check.

See [android.md](android.md) and [the follow-up record](follow-ups/2026-10-01-android-app.md).

## Final source-only size correction

A full working-tree size check (including untracked files) later found two oversized hardening files;
the earlier stock guard had inspected committed differences only. Cache-lock code and its three tests
were split without changing behavior. All 67 changed/untracked JS files pass the actual working-tree
ratchet; the final source passes 344 browser and 101 desktop tests, focused lint and diff checks. Astra
checked semantic preservation. The source-only split was not rebuilt/installed; the device report
identifies exactly which APK was physically accepted.

## Subsequent same-file SAF implementation

The restored SAF write/recovery implementation and credential-merge corrections passed 360 browser
and 101 desktop tests, full lint, 12 Node and 16 Python Android tool tests, and the full working-tree
ratchet for all 72 changed/untracked JS files. Independent GPT-6 Astra counterchecks closed the source
findings, including stale-provider credential rollback and an early clipboard timer callback.

The final canonical Android wrapper passed the Debug build, all 47 native tests, five emulator E2E flows,
and the APK credential scan. APK SHA-256:
`c4103a49f4032ba374cf79c77167dbc3213e6b47dd8a211e30259b23607438d0`.
Its emulator was stopped. These are local/fixture results; the new APK has no physical same-file Drive
acceptance yet. See [the SAF record](follow-ups/2026-10-01-android-saf-sync.md) for that remaining gate.

Additional handset-free coverage subsequently passed provider conflict between stat/save, encrypted
IndexedDB recovery after provider failure and successful retry, incomplete native recovery replacement
with a fresh IO instance, and recovery quota refusal before provider write. No production code changed.
The updated suites pass 362 browser/101 desktop tests, 49 native tests, five emulator E2E flows, full lint,
APK credential scan, diff check and all 73 changed/untracked JS size checks. Latest Debug APK SHA-256:
`d0a06f0561c99b04df4c5fa7e57fee72e3ab592d01b4f71a165bf48abc6df7bd`.
The wrapper stopped the emulator. These results still do not certify actual Google Drive bidirectional
sync or a physical process kill; see the SAF record for the explicit simulated boundaries.

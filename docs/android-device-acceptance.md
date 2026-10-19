# Physical Android acceptance — 2026-10-01

## Current result

**Basic same-file bidirectional Google Drive synchronization is accepted for the disposable test database
in the Debug build.** The final physical round trip and independent Astra countercheck below supersede
the earlier read-only/copy-only blocker. This does not certify atomic concurrent writers or release use.

All handset evidence below uses the **Debug lane**, package `com.mickdewald.keeweb.dev`, on Xiaomi
`22081212UG`, Android 15. Earlier evidence used APK SHA-256
`ec2ac46e1e50344b5b597c570dc9b273aafc5949646e0f02ba7a5c7d751c80eb`
for the final pause-lock correction. Earlier checks used
`b7459bbec37f9668adf26dbc5caa834c0b4dd8b9788769e8e7d2cb87f7be8730`; those results
are not automatically attributed to the final APK.
Display: 1220 × 2712, active 120.00001 Hz. This is not release performance acceptance.

The final same-file round trip uses APK SHA-256
`d0a06f0561c99b04df4c5fa7e57fee72e3ab592d01b4f71a165bf48abc6df7bd`, verified against the installed
`base.apk` on the phone. It was installed in place without clearing data. Historical open statements
below describe earlier rounds; the final dated acceptance section governs the current basic sync result.

## Passed on the physical device

- The additive Debug installation succeeded beside the existing password application. No uninstall,
  application-data reset, release replacement or signing-key creation was performed.
- `KEEWEB_SERIAL=<physical-serial> npm run android:device:qa` passed all five fixture flows: master-password
  unlock, Back from entry details, layout assertions, tap-to-copy feedback, and Back/background/return.
  Returning required a visible empty password field without the Android lock overlay or old visible entries.
  Tap-to-copy asserts the Copied tooltip and absence of the mobile action bar; it does not prove the OS
  clipboard contents or their expiration.
- The phone opened the separate Drive-root file `KeeWeb-Sync-Test-2026-10-01-125055.kdbx` through the actual
  Google Drive DocumentsProvider. It decrypted and displayed the entry `Sync-Test MacBook` with Notes
  `MAC_REV_1_2026-10-01`, previously written on the Mac. This proves the initial Mac → Drive → Android read.
- The Android UI added `ANDROID_REV_1_2026-10-01` to that entry. **Save new copy** exported a distinct KDBX
  to the isolated folder `KeeWeb-Android-Export-Test-2026-10-01`. The Drive root itself was rejected as a
  tree destination by Android; granting access to the isolated folder worked.
- The exported copy arrived on the Mac and was decrypted there: its Notes contained both the Mac and
  Android markers. The original test file still contained only the Mac marker. Thus copy export succeeded
  and preserved the source, while same-file Android → Mac sync did not occur.
- Canceling the native biometric prompt restored master-password fallback. Reopening the original test
  database from local recovery retained the Android marker after the export's background lock.
- After Home and process termination (PID absent), the app cold-launched with the password field disabled
  behind its native biometric prompt. The prompt subsequently completed and the test database opened
  without any further password injection by the agent. Native strong-biometric unlock after process restart
  is therefore observed.
- The reopened entry's current Notes contained Mac revisions 1 and 2. Its production history UI retained
  the Android edit as version 2 (`MAC_REV_1_2026-10-01` plus `ANDROID_REV_1_2026-10-01`, saved 13:08:11);
  current state was the later Mac edit, saved 13:18:41. This demonstrates recovery and incoming KDBX merge
  with the competing same-field edit preserved in history. It is not same-file reverse synchronization.
- After tapping the fake entry's Password field, Android's actual `KEYCODE_PASTE` pasted the exact fake
  password into its Notes editor. This independently verifies the OS clipboard contents, beyond the runner's
  Copied tooltip. The edit was not applied. The first USB interruption prevented that initial expiry check; the
  subsequent successful expiry checks are recorded below.
- After reconnection, a fresh production Password tap and actual OS paste succeeded before expiry.
  Repeating the paste after 33 seconds produced an empty editor. The test edit was canceled without applying
  it. Physical foreground clipboard expiry is now verified.
- Imported `KeeWeb-QA-20261001.txt` with the actual native picker. Background locking completed; reopening
  recovered the attachment. Native attachment export to the isolated local Documents test folder produced
  the exact original 57 bytes.
- Imported the disposable `KeeWeb-QA-20261001.key` through the native settings picker. Password alone was
  rejected on recovery, as expected with key remembering disabled. Selecting the key with an actual trusted
  phone tap and the Android picker allowed password+key unlock. A new KDBX copy was exported to the local
  test folder: desktop decryption rejects password alone and succeeds with the matching key, with all 57
  attachment bytes preserved.
- Starting generated-key export and fully canceling the native tree picker restored the lock prompt.
  Reopening with the existing test key succeeded; settings still named that key. Cancel did not apply the
  unexported generated factor. Later automation supplied the already-validated fake key via the production
  file input; those later injections are not additional native-picker evidence.

These checks use only a copy of the committed fake fixture and its fake password. The user's real
database was located by metadata only; its contents were never read or modified.

- After copying another disposable marker, Home and process termination were followed by more than
  30 seconds without the process, then a cold launch. Actual OS paste into the empty test unlock field
  produced no contents. This proves cleanup after restart, not timer execution while the process was dead.
- Removed the imported factor, waited for completed background cache locking, confirmed process termination,
  and cold-launched. Password alone reopened the test database and its attachment. An earlier termination
  while the Securing overlay was still present retained the prior committed factor; it is not a completed-save result.
- With locale `de-DE`, released only the fake database's persisted URI grant. Its transient activity grant
  initially still allowed reading. After activity termination and relaunch, native stat returned
  `PERMISSION_LOST`; encrypted-cache unlock succeeded and the German unreachable-file/reselect notice
  appeared. Selecting the same fake file through the native picker restored access and cleared the notice.
- Disabled Wi-Fi and mobile data temporarily, confirmed both settings were zero and Android reported
  `Active default network: none`. Password unlock from encrypted recovery and the attachment succeeded.
  Both original radio settings were restored to one in a `finally` block.
- Successfully exported a newly generated 201-byte key through the native picker to the isolated Drive
  folder. The generated factor then reopened encrypted recovery with the fake password. Its matching
  4053-byte KDBX copy arrived on the Mac: password alone was rejected, password plus the exported key
  decrypted it, and the 57 attachment bytes matched exactly. Current Notes retained both Mac revisions,
  with three history records. The original Drive test file retained its earlier 3829 bytes and exact hash.
- Restored the original `en-US` locale and removed the generated test factor with a completed encrypted
  cache commit; password-only recovery succeeded again. Exported disposable key/database pairs remain
  available separately.

## Open acceptance boundaries

- A second Mac edit, `MAC_REV_2_2026-10-01`, was written to the original test file. After Home, the Debug
  process was killed without clearing data; PID disappearance was confirmed, and a cold launch succeeded.
  Cold-process recovery, native biometric completion and the incoming merge are now observed as described above.
- After Drive metadata confirmed Mac revision 2 at the same file ID (3829 bytes, modified
  `2026-10-01T11:18:41.499Z`), a direct production `DocumentFile.read` call on the physical phone's existing
  authorized URI still returned 3813 bytes containing only Mac revision 1. The returned SHA-256/revision was
  `9489663e4fb6da2dfde5bf96a317ab992a5e9ab2c17be47ad0726afb683554e8`; the Mac's new file hash was
  `8bcc480627e89548af8d4569c2aa15df837456394e14184f3812d922e1119dde`.
  This shows stale provider bytes at that observation. The subsequent unlock did load revision 2 and merge
  recovery as described above; immediate refresh latency and sustained background polling are not accepted.
- The USB interruption was resolved by reconnection. The stale editor was no longer alive; the fresh
  clipboard test's editor was explicitly canceled.
- Cached offline opening, actual grant loss/reselection, German notice, generated-factor export and
  clipboard cleanup after restart now have handset evidence. Missing-file deletion, unavailable providers
  without a usable cache, biometric-enrollment changes, and multiple-device concurrent writes were not tested.
- The final Astra review identified that `appStateChange(false)` begins at Android `onStop`, leaving
  pause-only transitions uncovered. A focused physical Home/350-ms/return trace recorded `pause` at Unix millisecond 1790856758594, then
  `appStateChange(true)` at 1790856759027 and `resume` at 1790856759028, with no inactive event;
  the workspace remained unlocked. This is a
  confirmed lifecycle gap that was then corrected in `android-lifecycle.js`: native pause begins the
  generation/input gate and the subsequent inactive state is deduplicated. A fresh physical 350-ms return
  recorded `pause` at 1790857086222 **with the overlay already present**, then active/resume at
  1790857086636 with the password prompt. No inactive event occurred. Final state: empty password, zero
  visible entries, no lingering overlay. This closes the reproduced pause-only defect.
- On the final APK, biometric cancellation restored password fallback and password-only recovery.
  A native key picker opened with the overlay present at pause; the following stop did not release it.
  Fully canceling DocumentsUI restored the locked prompt; biometric cancellation and password recovery
  succeeded, preserving the attachment and existing factor state.
- On the final APK, screen-off recorded pause with the overlay present followed by inactive state.
  The completed state had an empty password prompt, zero visible entries and no lingering overlay.
  The screen was woken to the OS lock screen afterward; device work is finished.
- Permanent release signing, a reviewed clean source revision, standalone build/scan, and release-device
  acceptance remain separate gates.

## Sync implementation and corrected authorization requirement

The user confirmed the intended path: select Google Drive using Android's document picker, as with the
existing password app. **A Google Cloud project ID is not required for this SAF path.** The earlier request
for that ID incorrectly treated an optional direct Drive-API implementation as mandatory.

Android's Storage Access Framework supports modifying selected documents when the provider offers writing
and the app obtains/persists the returned write grant. The previously tested implementation requested only
read access and rejected `DocumentIo.write` with `REV_UNSUPPORTED`. The current local implementation
requests actual read/write grants, compares the loaded revision and verifies writes. This change has
not yet received new handset/Drive acceptance.

The original Android design already proposed SAF read/write, content-hash comparison, and KDBX merge on
conflict. Completing that path needs capability/grant handling, source-change checks, durable encrypted
recovery, verified same-file saves and real provider round-trip testing. SAF does not establish an atomic
compare-and-write against another client; stale provider bytes and simultaneous Mac/Android writes remain
specific acceptance gaps, rather than a reason to demand a Cloud project ID from the user.

A direct Drive-API integration remains an alternative. That route needs registered OAuth clients and runtime
authorization; the existing browser/Electron popup or localhost callbacks cannot simply run on Android.
Neither an OAuth client nor a plain media PATCH proves an atomic conditional write. Such a route would
still require verified conditional-upload and concurrency behavior before any stronger guarantee.

Reference: [Android document selection, persisted permissions and in-place edits](https://developer.android.com/training/data-storage/shared/documents-files).

The subsequent independent **GPT-6 Astra** acceptance review confirms this as a **P1 product acceptance
blocker** and independently decrypted only the two named fake files: the original contains Mac revisions
1 and 2; the export contains Mac revision 1 and Android revision 1. No additional evidenced P1 security
regression was found in the physical runner; Astra ran nine relevant Node tests and `git diff --check`.

For the optional direct-API route, Google's Android AuthorizationClient/Picker integration is a candidate:
[`PICKER_OAUTH_TRIGGER` and `picked_file_ids`](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker).
The conditional-upload probe remains required. The actual Mac writer via Drive Desktop must also participate
in a proven conflict strategy: Android-only conditional writes cannot prevent a later stale Mac upload.
Both real write paths must be included in end-to-end concurrency acceptance.

## Final independent countercheck

The final pause-only correction received a narrow independent GPT-6 Astra code/test review. Astra found
no concrete new regression; the transition dedupe and actual installed Capacitor callback ordering match.
The final device traces above were supplied as root evidence, not independently rerun by the reviewer.
Same-file Drive synchronization remains unaccepted until the new implementation passes actual provider testing. Clipboard cleanup while the process is
terminated and release/enrollment/concurrent-writer acceptance remain outside the proved scope.

## Tool verification and evidence

The new physical-device wrapper never resets data or installation. It requires the explicit physical serial
and exact Debug package, rejects emulator targets, refuses occupied host-global CDP ports, and aborts on
existing or unknown file state before fixture injection. After guard tightening, focused ESLint,
12 Node and 16 Python tool tests, the file-size guard, and `git diff --check` passed.

The physical baseline log is in the task's temporary `keeweb-device-qa.*` workspace, `device-baseline.log`.
Private provider-picker screenshots are not published. Prior browser/native/emulator verification remains
recorded in [android-predevice-status.md](android-predevice-status.md); it is not handset or release evidence.

The pause correction passed 344 browser tests (including three new lifecycle regressions), focused
production ESLint, `git diff --check`, the canonical `npm run android:debug` build and the APK credential
scan. The final Debug APK was installed in place without resetting app data. No emulator instrumentation
was rerun while the physical phone was attached. Focused physical evidence is saved temporarily as
`pause-fix-physical.json`; build output as `pause-fix-build.log`.

The final source-size check included all changed and untracked JS files, rather than only committed
changes. It exposed two oversized files in the earlier hardening package. The unchanged `cacheFileForLock`
method was extracted into `app-model-sync-lock-cache.js`; three existing cache-lock test cases moved to a
separate discovered test module. All 67 changed/untracked JS files now pass the working-tree size ratchet.
The final modularized source passed 344 browser and 101 desktop tests, focused ESLint and diff checking.
Astra found no semantic change in the extraction. This last source-only refactor was **not rebuilt or
installed**: the ec2ac… APK on the handset contains the same cache-lock logic before extraction, and the
physical checks above apply to that APK. All changes remain local and uncommitted; no release was made.

## Subsequent SAF write implementation

The user requested continuation through the ordinary Android Drive picker. No Cloud project identifier is
required. Local implementation and review progress are tracked in
[2026-10-01-android-saf-sync.md](follow-ups/2026-10-01-android-saf-sync.md). Earlier handset evidence above
continues to apply only to its named APKs; no subsequent same-file cloud success is implied.

## Final physical same-file acceptance — 2026-10-01, 17:01 CEST

- Installed the reviewed/tested Debug APK above with `adb install -r`. Opened only
  `KeeWeb-Sync-Test-2026-10-01-125055.kdbx` with its disposable fixture password. The real database
  remained untouched. Existing readonly permission produced the actionable banner; selecting the exact
  original fake file through Google Drive in actual Android DocumentsUI granted write access.
- Android's normal in-place sync wrote its merged recovery state into the original Drive-root file.
  The Mac decrypted its 4069-byte result; source revision was `cb1855f6…acd3e510`. No new-copy export
  was used in this round. Cloud metadata continued to identify file `1qGRA52A1t2WgAz4S7JlGhYsro9sCHitk`.
- The Mac appended `MAC_REV_3_2026-10-01` to that exact file at 14:53:13 UTC. Drive metadata for the same
  file ID showed 4117 bytes and that modification time. The first Android Sync still saw the earlier
  provider bytes. At 14:55:01 UTC native stat matched the Mac's new SHA-256
  `873459449a372eea9759ed62d3a8ffb58e6369c77dc91ad4a02356d37301cd03`; normal Sync then displayed
  Mac revisions 1, 2 and 3 in the Android entry's Notes. The matching provider revision was first
  observed about 108 seconds after the Mac write; actual arrival between probes is unknown. This is
  not a guaranteed refresh interval or proof of continuous background polling.
- Through KeeWeb's actual Notes editor on the phone, appended `ANDROID_REV_2_2026-10-01` and used the
  ordinary Sync button. At 14:57:34 UTC the Mac decrypted the same root file with all four markers;
  its 4165 bytes matched Android revision
  `c5b1bc473aa339c17e708cd8bb2cbca33118991dedc19be4e0c84b97be7c1806`. Cloud metadata retained the
  original file ID, 4165-byte size and 14:57:04.861 UTC modification time. This proves Android → Drive → Mac
  arrival, beyond local provider readback.
- Home, then completed background recovery, then force-stop of only the Debug package; `pidof` reported
  no process. The subsequent launch reported `COLD`. After biometric cancellation and fixture-password
  unlock, the actual Android UI retained all four markers. Native stat still reported write capability
  in the new process, demonstrating persisted permission rather than the previous transient grant.
- Final decrypted Mac bytes (4149) match both Android saved revision and native provider revision after
  cold launch: `b361f6b574ca60db329b2e8234bb65eb1c378b0d831535a388addd6837afb6d4`. All four markers,
  five history versions and `KeeWeb-QA-20261001.txt` remain. Final cloud metadata for the same original
  ID showed 4149 bytes and 14:59:14.362 UTC modification time.
- Independent GPT-6 Astra inspected and ran the readonly Mac fixture reader, independently decrypted
  the named fake file, and confirmed the markers/history/attachment plus exact SHA match with the
  saved physical JSON. Astra accepts this basic same-file and coldstart gate; device actions and installed
  APK identity are root evidence, not reviewer reruns.

Temporary evidence: `saf-physical-roundtrip.json`, `saf-mac-roundtrip.json` and `mac-fixture.cjs` in the
task's `keeweb-device-qa.*` workspace. Phone UI actions used WebView automation and actual native DocumentsUI;
no direct injection into FileModel or direct native write replaced the production Sync path.
The Debug workspace was locked with zero visible entries, the phone returned to Home, and the owned CDP
forward/UI-dump file were removed. Test files remain available.

Remaining boundaries: Drive can return stale bytes, SAF is not an atomic cross-client compare/write,
and simultaneous real writers have not been accepted. Release signing/build/device acceptance and
real-database use remain separate. Basic same-file synchronization is now demonstrated, rather than
inferred from an export copy.

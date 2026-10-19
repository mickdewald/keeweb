# Android SAF same-file sync — implementation record

The user requests the normal Android document picker with Google Drive, without a custom Google Cloud
project. Work is local in `codex/android-predevice-hardening`; no real database may be read or changed.

## Contract

- Request and persist actual database read/write grants; readonly providers remain usable for reading.
- Surface live write capability and offer reselection when the previous grant was read-only.
- Before every provider write, commit candidate bytes and matching credential metadata in IndexedDB,
  even when ordinary offline storage is disabled. Cache failure prevents the provider write.
- Compare the current provider SHA-256 with the expected loaded revision. A mismatch writes nothing and
  invokes the existing KDBX merge/retry path. Successful native write uses truncation and exact readback.
- Keep one complete app-private encrypted preimage/attempt journal per selected URI. Commit the entire
  pair atomically, fsync it and verify the committed record before touching the provider; retain it after
  local success because provider readback does not prove cloud arrival.
- Preserve Android data when a provider returns an older copy after a locally successful write. Merge
  incoming KDBX with local KDBX rather than replacing a clean Android model blindly.
- Remote password/key changes must complete or fail exactly once and must invalidate stale biometric
  metadata before the final file info is saved and recovery is cleared.
- Normal Save writes the chosen file; Save new copy remains a distinct verified export.

## Acceptance limits

SAF supplies no demonstrated cross-client atomic compare/write. Hash checking and recovery detect many
conflicts, but do not guarantee preservation of a foreign update between the final read and write.
Entry merges use KDBX semantics: different entries can retain both current edits; conflicting edits to
one entry retain competing versions in history. No field-by-field merge or immediate cloud arrival is promised.

## Local verification and remaining device acceptance

Native permissions/writes and web save/capability/reselection are implemented. Root watched failing
mandatory-recovery/capability tests and added their fixes. Astra identified journal commit coherence,
remote-key preparation/metadata and stale-provider clean-replacement errors; their targeted corrections
and real encrypted KDBX regressions precede the final canonical emulator run. The last narrow Astra check
also closed stale-provider rollback of a newer local password. Its independent encrypted KDBX checks
confirmed older remote credentials are rejected, newer remote credentials adopted and non-Android clean
replacement preserved. Source verification passed 360 browser tests, 101 desktop tests and full lint.

The first canonical emulator run exposed an invalid recovery-failure fixture path. After correcting the
fixture to the target app context, every document-I/O test passed; the second run exposed a separate
clipboard-restart expiry assertion. The timer now rearms callbacks that arrive before the persisted
deadline; focused tests also cover an old callback after a newer copy. Astra's narrow countercheck found
no new blocker in the timer correction.

The final canonical `npm run android:verify` passed all 47 native tests, all five emulator E2E flows,
the Debug build and APK credential scan. Android tool checks passed 12 Node and 16 Python tests.
The complete working-tree size ratchet passed all 72 changed/untracked JS files and diff checking passed.
Final Debug APK SHA-256: `c4103a49f4032ba374cf79c77167dbc3213e6b47dd8a211e30259b23607438d0`.
This APK has not yet been installed or accepted on the physical phone. The wrapper stopped its emulator;
the handset has been requested for the same-file cloud round trip.

The phone was disconnected after the repository fixture-only instrumentation guard was explained.
Use `npm run android:verify` only while the dedicated emulator is the sole connected device. After the
wrapper stops the emulator and final Astra review passes, request handset reconnection for the actual
same-file Mac → Android → Mac round trip. Keep that proof distinct from local provider readback.

## Additional checks while the handset is unavailable

At the user's request, four previously uncovered cases were added and passed without production changes:

- A provider revision changes between stat and save: actual encrypted KDBX models reload/merge/retry,
  preserving the independent Mac and Android entries. Only provider I/O is simulated.
- Provider save fails with ordinary offline storage disabled: actual IndexedDB recovery survives closing
  and reopening the cache connection, decrypts the Android edit, and is cleared after successful retry.
- An incomplete native `record.bin.new` is left behind: a fresh DocumentIo instance reads the previous
  complete pair and completes the next verified save. This models interrupted commit state, not process death.
- A sparse quota marker exceeds the native recovery budget: saving is refused before opening a provider
  write stream and the original provider bytes remain unchanged. This is quota accounting, not physical disk-full.

Full verification passed 362 browser tests, 101 desktop tests, full lint, 49 native tests and five emulator
E2E flows, Debug build/credential scan, diff check and all 73 changed/untracked JS size checks. The wrapper
stopped the emulator. Latest Debug APK SHA-256:
`d0a06f0561c99b04df4c5fa7e57fee72e3ab592d01b4f71a165bf48abc6df7bd`.
No Drive file or real database was touched in this round. The actual handset/provider round trip remains
open; wait for the user to make the phone available. No further repetitive local verification is needed.

## Physical same-file gate passed — 2026-10-01

The phone returned and the latest Debug APK was installed in place. Actual Drive DocumentsUI reselection
granted persistent write access to the original fake file. The Mac added revision 3; Android displayed it
after the provider refreshed. Android then added revision 2 through the real Notes editor/normal Sync;
the Mac decrypted it from the same Drive-root file and cloud metadata retained the original file ID.

After Home/recovery/force-stop and confirmed PID absence, cold launch retained all markers and native
write capability. Final Mac SHA exactly matches both Android revision and provider revision:
`b361f6b574ca60db329b2e8234bb65eb1c378b0d831535a388addd6837afb6d4`.
Independent GPT-6 Astra readonly decryption confirmed those bytes, markers, five history versions and
the test attachment. The basic same-file/coldstart P1 is closed for Debug fake-data scope.

The first matching incoming provider revision was observed about 108 seconds after the Mac write;
its exact arrival between probes is unknown. Concurrent atomic writers, real
database use and release are not certified. See [the final device record](../android-device-acceptance.md)
for the actual APK identity, cloud arrival evidence and cleanup. No production source changed in this turn.

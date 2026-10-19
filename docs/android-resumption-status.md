# Android continuation — 2026-10-20

## Source and scope

The existing Android implementation is continued, not replaced. The inherited
106 modified/untracked files were inventoried and preserved in commit `9e0d885f`.
Current `origin/main` (`9e40bdb6`) was merged in `ccdcae05`; its dependency updates
are retained alongside the Android Capacitor dependencies. No real password
database, key file, or release signing material is part of this change.

## Independent review

A fresh read-only GPT-6 Astra review reproduced two additional credential issues:

- Removing an existing key file did not advance the KDBX credential timestamp;
  another Android replica could retain and reintroduce the old key requirement.
- Failed sync reset credential-change flags while retaining the old biometric
  blob; a subsequent background recovery snapshot could restore stale metadata.

Both minimal corrections have passed the reviewer's independent encrypted
KDBX countercheck and the canonical browser regression suite:
key removal advances the credential timestamp, and failed sync retains the
credential-change flags and original undo baseline. The reviewer also verified
that undo restores the original password and key. The reviewer found no
additional concrete blocker in the native journal, IndexedDB transaction/token
checks, lifecycle generation gate, or same-file write sequence. This is a bounded
source review, not an audit of all historical dependencies.

## Current evidence

- Dependency installation from the integrated lockfile and full lint passed;
  existing `main` dependency versions are unchanged.
- The unmodified `npm test` runner passed 392 browser and 104 desktop tests,
  including five new encrypted concurrency/factor regressions. No test-runner
  allowlist or patched runner was needed for this acceptance run.
- Android tool checks passed 15 Node and 16 Python tests. Fixture generation now
  uses the pinned Node runtime's Argon2 API and the current strict XML parser;
  a regression decrypts the unchanged original fixture to check interoperability.
  Astra independently repeated all three generator tests successfully.
  The full working-tree
  source-size ratchet included untracked files and passed; diff checking passed.
- The connected Xiaomi `22081212UG` has Debug package `com.mickdewald.keeweb.dev`,
  version 1.0 (code 1), last updated on 2026-10-01. No release package was found.
- The existing local and independently pulled installed Debug APK both have SHA-256
  `d0a06f0561c99b04df4c5fa7e57fee72e3ab592d01b4f71a165bf48abc6df7bd`.
  This confirms the installed historical build, not the newly integrated source.
- The guarded `npm run android:verify` passed on 2026-10-20 local time:
  49 native tests, zero failures/errors/skips, all five emulator E2E flows,
  and the compiled-APK credential scan. The only-device guard was retained;
  the other task released its emulator before this run. KeeWebSpike was stopped
  by the wrapper after completion.
- Final Debug APK SHA-256:
  `3b449e805fcaf8ce23691b83cd0252e02593b75d84dd8fe8e35c3cb7f426ffca`.
  This fresh build is not installed on the physical phone and has no current
  physical acceptance.

## Release and provider boundaries

The 2026-10-01 disposable Google Drive same-file round trip remains historical
Debug evidence. It is not current release acceptance or an atomic two-client
write guarantee. Hash comparison cannot protect a foreign write between the last
provider read and truncation, and readback cannot prove upload to Google Drive.
The journal preserves the observed preimage and attempted write, not an unseen
concurrent foreign update. Do not advertise lossless simultaneous writers.
KDBX deletion tombstones win over an unsynchronized edit of that deleted entry.
The merge can discard that edit before the current save's recovery snapshot is
made; the native journal is not a pre-merge archive. Its retained encrypted
record is also not an automatic user-facing recovery/history browser. Concurrent
deletions therefore remain an explicit data-loss boundary, even if the provider
revision check works exactly as intended.

The default permanent release keystore is absent on this Mac. The available
OpenBao Android signing identity explicitly covers four `turbo-rn` apps, not
KeeWeb; the app-env add-key helper also has no KeeWeb scope. No other app's key,
replacement signing identity, or owner credentials were used. Signed release
build/scan, physical release acceptance, and an explicitly designated real-data
compatibility copy remain separate gates. The emulator wrapper requires the
fixture emulator to be the only connected ADB device; this guard is retained.

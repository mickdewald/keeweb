# Abschließender Astra-Review — 2026-10-01

Reviewer: interner Agent mit ausdrücklich gewähltem **GPT-6 Astra**, ausschließlich lesender Review.
Stand: `codex/android-predevice-hardening` im Worktree `keeweb-android-spec`, auf Basis von
`2c00bfc2ed978613f63cfbe10ea7dfa811d2d54d`, einschließlich der lokalen uncommitted und untracked Änderungen.

## Urteil

**Nachtrag zur Geräteabnahme:** Die folgende Freigabe betrifft das Hardening und die damalige Kopie-Strategie.
Der nun ausdrücklich geforderte bidirektionale Sync derselben Drive-Datei ist damit nicht abgenommen und
derzeit nicht implementiert. Tatsächliche Debug-Gerätetests und verbleibende Anforderungen stehen in
[android-device-acceptance.md](android-device-acceptance.md).

Der erneute Astra-Gegencheck der Geräte-Evidenz bestätigt einen **P1-Abnahmeblocker** für diesen fehlenden
Same-file-Sync. Der Reviewer entschlüsselte unabhängig nur Original und Export der Fake-Testdatenbank und
bestätigte den Kopie-Roundtrip sowie den fehlenden Rücksync. Im neuen physischen QA-Runner fand er keine
zusätzliche belegte P1-Sicherheitsregression; neun relevante Node-Tests und `git diff --check` bestanden bei ihm.
Die nachfolgend dokumentierte Schließung der ursprünglichen Hardening-Befunde hebt diesen Produktblocker
nicht auf.

**Keine belegten P0/P1/P2-Befunde aus diesem Review bleiben offen.** Alle sieben ursprünglichen Befunde und
die während der Gegenprüfung gefundenen Regressionen sind geschlossen. Freigegeben ist die nächste Prüfung
auf einem physischen Android-Gerät mit Wegwerfdaten. Echte Passwortdatenbanken und Veröffentlichung sind noch
nicht abgenommen.

Automatisches Zurückschreiben in dieselbe SAF-/Drive-Datei ist deaktiviert. **Neue Kopie speichern** erstellt
eine neue, geprüfte Datei und erhält das Original sowie dessen lokalen Änderungsstatus. Diese Begrenzung ist
Teil der sicheren Lösung, kein Nachweis vollständiger Drive-Synchronisierung.

## Geschlossene ursprüngliche Befunde

1. **P1: Veralteter Sync bestätigt neuere Änderungen.** Serialisierung und Abschluss prüfen die Änderungs-Version;
   spätere Änderungen behalten ihre Flags und ihren Edit-State.
2. **P1: Mehrdatei-Lock verliert spätere Änderungen.** Vor gemeinsamem Schließen wird der gesamte Dateibestand erneut
   geprüft, einschließlich zunächst sauberer Dateien, laufender Syncs und ausstehender Mutationen.
3. **P1: Fehlende Sperrgrenze bei Backgrounding/Unlock.** Jedes Android-Background-Ereignis erhöht die Generation,
   verbirgt die Oberfläche und blockiert Eingaben. Alte Öffnungsergebnisse werden verworfen; Passwortpuffer leeren sich.
4. **P1: Cache-Erfolg vor dauerhafter Wiederherstellbarkeit.** Verschlüsselte Daten und passende Metadaten committen
   atomar. Erfolg wartet auf den Transaktionsabschluss; Neustart findet Recovery unabhängig vom Settings-Spiegel.
5. **P1: SAF-Prüfung und Überschreiben sind nicht atomar.** In-place-Schreiben scheitert geschlossen mit
   `REV_UNSUPPORTED`. Neue Exporte schützen bekannte Original-URI-Aliasse und prüfen die geschriebenen Bytes.
6. **P2: Falsche Faktor-/Biometriemetadaten im Recovery-Cache.** Metadaten werden vor der Serialisierung erfasst;
   Änderungen erzwingen Wiederholung. Echte KDBX-/IndexedDB-Neustarttests prüfen geänderte und entfernte Faktoren.
7. **P2: Picker-Mutationen werden zu spät registriert.** Native Imports registrieren vor dem Picker, behalten ihren
   Ursprungskontext und lösen bei Abbruch/Fehler auf. Generierte Faktoren gelten erst nach bestätigtem Export.

## Geschlossene Befunde der Gegenprüfung

- Ein verspäteter Callback einer geschlossenen FileModel-Instanz überschreibt keinen neueren Recovery-Stand.
- Ein später Abschluss der Metadatenpersistenz reaktiviert keine geschlossene Datei.
- Ein gewöhnlicher Desktop-Speicherfehler aktiviert keine Android-Sperrgrenze.
- Save-and-lock wartet asynchron auf bereits laufenden Sync statt synchron zu rekursieren.
- Tatsächliche Passwort-/Schlüsseldatei-Resets erhöhen die Änderungs-Version; Serialisierung wird nötigenfalls wiederholt.
- FileReader erhält den ausgewählten Blob; synchrone Fehler geben die ausstehende Mutation frei.

Das verspätete Aufräumen eines alten Recovery-Eintrags ist kein weiterer Blocker: Compare-and-delete prüft atomar
den Token aus zufälliger FileModel-Lifetime und Edit-Version. Ein neuer Kontext oder neuerer Stand kann nicht passen.

## Geprüfte Evidenz

Astra las die finalen Produktionspfade und Regressionen, führte `git diff --check` selbst aus und prüfte die
von Root ausgeführten Testlogs/XML. Astra startete keinen eigenen Build oder Emulator.

- 341 Browser- und 101 Desktop-Tests bestanden.
- Lint, Dateigrößenprüfung, 7 Node- und 16 Python-Werkzeugtests bestanden.
- Frischer **Debug-Lane**-Lauf: 34 native Android-Tests, null Fehler/Fehlschläge/Skips; fünf E2E-Flows erfolgreich;
  APK-Credential-Scan ohne Treffer. Supervised Wrapper und Emulator wurden danach beendet.

Logpfade, APK-Hash und Gerätecheckliste stehen in [android-predevice-status.md](android-predevice-status.md).

## Offene Abnahme und Grenzen

- Physisches Android: Faktorwechsel/-export, Home im Picker, schnelle Rückkehr, Prozessneustart, Recovery,
  biometrische OS-Prompts und echten Drive-Provider mit Wegwerfdateien prüfen.
- Ein signierter Standalone-Build braucht dauerhaftes Signiermaterial und einen geprüften sauberen Quellstand;
  Build, Scan und Geräteabnahme bleiben eigene Schritte.
- Hängender Sync oder Import kann Klartextobjekte länger im Prozess halten, während die Oberfläche gesperrt bleibt.
  Prozessverlust vor erfolgreicher Persistenz kann ungesicherte Änderungen verlieren.
- Clipboard-Ablauf nach Prozessende und mögliches blindes Löschen eines fremden Clips bleiben Plattformgrenzen.

Der Review umfasst das Android-Originalfeature, die Hardening-Änderungen und betroffene gemeinsame Modellpfade.
Er ist kein vollständiges Audit sämtlicher historischer KeeWeb-Abhängigkeiten oder unabhängiger Desktop-Funktionen.
Keine Quell-/Git-Mutationen, Signiermaterial-Erstellung oder Telefon-/Echtdatenbank-Zugriffe durch den Reviewer.

## Final physical pause-only correction

The final handset countercheck confirmed a pause/resume transition without stop that remained unlocked.
The lifecycle now starts the generation/input gate on native `pause` and deduplicates the later inactive
state. Three new regressions brought the browser suite to 344 passing tests. A fresh Debug build/credential
scan and in-place install passed. The physical 350-ms pause-only trace now shows the overlay immediately
at pause, then an empty locked prompt with zero visible entries. Native picker cancellation, biometric
cancellation/password recovery and screen-off passed on the final APK. The narrow Astra code/test review
found no concrete new regression; device actions remain root evidence. See `android-device-acceptance.md`
for exact APK identity, traces, completed fixture checks and remaining same-file Drive P1 blocker.

The final working-tree size correction extracted the unchanged cache-lock method and moved three existing
tests. Astra's narrow review found the method, shared WeakMap, `this` binding, imports and integration intact.
The final source passed 344 browser and 101 desktop tests, focused ESLint, diff checking and the size ratchet
for all 67 changed/untracked JS files. This source-only extraction was not rebuilt/installed; handset evidence
remains attached to the explicitly identified APK in the device report. Same-file Drive P1 remains open.

## Authorization requirement correction

The user's intended Google Drive storage path is Android's system document picker. That path needs no
Google Cloud project ID from the user; the previous ID request applied only to an optional direct-API
alternative. The current read-only grant and unconditional `REV_UNSUPPORTED` are deliberate implementation
restrictions. SAF editing is technically supported when the provider permits writing. The known lack of
atomic cross-client compare/write and stale-provider behavior still need specific conflict/recovery
acceptance; this does not mean Drive selection itself requires custom OAuth. This was the state before
the subsequent SAF write correction below. See the updated device report for the distinction.

## Subsequent SAF write review

The independent GPT-6 Astra review identified and counterchecked corrections for coherent atomic native
recovery records, supported remote-key preparation and callback completion, permanent credential metadata,
and preservation of clean Android data when the provider replays an older KDBX. Its final narrow review
also closed a password rollback: Android merge adopts only newer remote credentials; forced credential
replacement remains limited to actual non-Android database replacement.

Astra independently exercised current production helpers and `mergeOrUpdate` with real encrypted fake
KDBX data for three cases: older Android remote password rejected, newer remote password adopted, and
non-Android clean replacement preserved. Correct-password decryption, rejection of the other password,
and exactly one callback passed in each case. No real database or device actions were used by the reviewer.
No source blocker remains from this review. Canonical native/E2E verification and actual same-file Drive
acceptance are separate gates; provider hash checking and readback do not establish atomic cross-client
writing or cloud arrival. Release and real-database use are not accepted by this source review.

The canonical rerun also exposed a clipboard-restart timing assertion. The narrow timer correction
rearms an early callback from the currently persisted expiry rather than dropping it. Astra's separate
static countercheck found no new blocker: due callbacks retain the existing HMAC ownership check and new
copies replace their deadline and cancel the previous handler. Native verification remains separate.

Root subsequently completed the canonical Android verification: 47 native tests, five emulator E2E
flows, Debug build and credential scan passed. Source checks passed 360 browser and 101 desktop tests,
full lint, tool tests, working-tree size and diff checks. This is root evidence supplied alongside the
independent source review, not additional reviewer-run tests. The physical same-file Drive gate remains open.

## Final same-file physical countercheck — 2026-10-01

The subsequent real-phone Debug round trip closes the basic same-file P1 for fake test data. Astra
independently inspected and ran the readonly reader of the exact disposable Mac file, confirming
Mac revisions 1/2/3, Android revision 2, five history versions and the test attachment. The final Mac
SHA-256 `b361f6b574ca60db329b2e8234bb65eb1c378b0d831535a388addd6837afb6d4` exactly matches both
Android's saved revision and the native provider revision after root's documented cold restart.

Root supplied actual DocumentsUI reselection, persisted write capability after process termination,
same Drive file-ID/cloud metadata, installed Debug APK identity and device UI actions. No new blocker
was found in the narrow acceptance check. Root's device actions were not independently rerun.
Observed Drive delay, non-atomic concurrent writes, release and real databases remain separate limits;
the prior still-open statements describe historical rounds. See the final device record for evidence.

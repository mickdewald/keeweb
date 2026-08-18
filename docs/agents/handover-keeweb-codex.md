# Übergabe KeeWeb-Codex

Stand: 2026-08-18. Fork von KeeWeb (Electron 43, kein Rewrite): `mickdewald/keeweb` (origin), Upstream `keeweb/keeweb` (nur lesen, Fetch nur `master`, keine Tags). Ziel: schrittweise UX-Politur.

## Wo gearbeitet wird

| Ort | Branch | Regel |
|---|---|---|
| `~/projects/external-repos/keeweb` | master | Nur lesen / `git pull --ff-only`. |
| `~/projects/wt/keeweb-colorful-list-icons` | `grok/keeweb-colorful-list-icons` | Einzige Arbeitskopie; trackt eigene Remote-Branch. |

`node_modules` ist eine EIGENE Installation im Worktree (kein Symlink mehr — Electron 22 vs. master mit 13!). `keys/` bleibt lokal. **Nicht anfassen: mick.kdbx.**

## Bauen / Testen / Deploy

```sh
source ~/.nvm/nvm.sh && nvm use 20.5.1
cd ~/projects/wt/keeweb-colorful-list-icons
NODE_OPTIONS=--openssl-legacy-provider \
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx grunt build-test && \
NODE_OPTIONS=--openssl-legacy-provider \
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx grunt run-test
```

Letzter Lauf: 112 passing.

Deploy (beendet die App hart, ungespeicherte kdbx-Änderungen sind weg):

```sh
./scripts/dev/build-macos-touchid-agent.sh
```

Nie nach `/Applications/KeeWeb.app`. Das Deploy-Skript ersetzt `/Applications/KeeWeb-Codex.app`
standardmäßig ohne App-Bundle-Backup, lintet (Prettier) und bricht bei Fehlern ab. Ein Backup ist
nur als bewusstes Opt-in mit `--backup` erlaubt.

Zum Klick-Testen ohne mick.kdbx: `npx grunt devsrv` (Port 8085) und die Demo-Datei im Browser öffnen.

## Branch-Stand

Arbeitsbranch: `grok/keeweb-colorful-list-icons` (nicht nach `origin/master` mergen, solange Mick das nicht will). Die echte App lebt auf dieser Branch.

Darauf: Settings-Suche, bunte Listen-Icons, Details/Attachments, Trash+Restore, macOS-Chrome + Vibrancy, Ein-Sidebar-Layout, Such-Highlight, Auto-Backups, Copy-Hover, Cmd+K-Palette, farbige Passwort-Zeichen, Generator-Redesign, Electron 13→43 + safeStorage, Review-Fixes.

Abschluss 2026-08-18:

- `06782863` Cmd+K: echtes Suchfeld, Palette bleibt bei 0 Treffern / leerem Passwort
- `9782ad63` Devices/YubiKey aus Settings und Settings-Suche entfernt

GitHub-Issues #1/#2 (UX-Backlog, Duplikat) sind geschlossen. Auf origin liegen nur `master` und diese Feature-Branch; Release-Tags von Vanilla-KeeWeb sind runter. Lokal bleibt der Tag `pre-single-sidebar`. `upstream` zeigt nur noch `keeweb/keeweb` `master`.

## Code-Pitfalls (mehrfach gebissen — zuerst lesen!)

- **View-Framework-Events:** Delegation am View-Root. In Handlern ist `e.currentTarget` der View-Root, NICHT das gematchte Element → immer `e.target.closest('.selector')`. (Workspace-Popover UND Copy-Button.)
- **SCSS `$medium-padding`** ist eine Zweier-Liste (`1em 1.2em`) — zerschießt `auto` in Margin-Shorthands. `$medium-padding-v`/`-h` verwenden.
- **`-webkit-app-region: drag`:** absolut positionierte Kinder, die über eine drag-Region ragen, brauchen eigenes `no-drag` (Drag-Handles).
- **Pre-commit-Hook** blockt absolute `/Users/…`-Pfade → `~/…` + `Launcher.expandHomePath`.
- **FontAwesome:** Icons in `app/styles/base/_icon-font.scss` registrieren (Subset-Build via Loader).
- Dev-Server-Loads mitten im Recompile loggen einen scheinbaren „Error starting app“ — Artefakt, kein Bug.

## Produktentscheidungen (nicht wieder aufrollen)

- Eine Datenbank ist der Normalfall; kein Multi-DB-Switcher-Look.
- Tags gehören zu All Items; Colors gestrichen (Sidebar UND Farblabel im Detail-Header).
- Fußleiste tot; Aktionen im Workspace-Menü unten links.
- Trash wie „Archived“, nicht dauerhaft sichtbar; Restore-Button im Papierkorb.
- Fenster-Drag: leerer Bereich der Details-Titelzeile; Inhalt nicht nach unten schieben.
- Deutsch in der UI; Settings-Suche findet deutsche Labels.
- Auto-Updater bleibt aus. Backups: `~/My Drive/Backup`, täglich, 30 rollierend (Settings `backupDefaultPath`/`backupMaxCount`).
- Mick gibt Feedback per Screenshot, erwartet Umsetzung ohne lange Planrunden. Interaktionen vor dem „fertig“-Satz selbst durchklicken (Dev-Server + Demo!).

## Layout (seit 75e249b7)

Ein-Sidebar-Layout (`compactLayout: true`): Die Eintragsliste ist die linke Spalte; Nav-Sidebar nur noch in den Settings. Tags über Dropdown in der Suchleiste, Workspace-Button unten in der Listen-Spalte, Drag-Streifen (38px) über der Suchleiste für die Traffic Lights, Liste ist die transluzente Vibrancy-Fläche. `compactLayout: false` stellt das klassische Drei-Spalten-Layout wieder her (auch nötig, falls sichtbare Untergruppen navigierbar sein müssen). Rollback-Tag: `pre-single-sidebar`.

## Review-Notizen (2026-08-17, nachgezogen 2026-08-18)

Bewusst offen: Backup-Namenskollision bei gleichnamigen kdbx in verschiedenen Ordnern (eine Datei ist der Normalfall); `compactLayout: false` nur per Settings-Blob umschaltbar.

Nachgezogen: Cmd+K hat ein echtes Suchfeld (Paste/IME), bleibt bei 0 Treffern oder leerem Passwort offen; Devices/YubiKey sind aus der Settings-Sidebar und der Settings-Suche. Zuvor schon gefixt: settings-key.bin-Guard+0600, Palette-Copy im Browser + lockOnCopy, erstes Backup direkt nach Open (pending), aria-hidden auf dem Edit-Overlay, fr-FR-Keys, `$medium-padding`-Shorthands in `_details`.

## Offen / Ideen (grob priorisiert)

1. **Vibrancy-Feinschliff** (Screenshot-Runden mit Mick)
2. ERLEDIGT: Passwort-Health-Übersicht (drei Spalten Weak/Reused/Old; Quick-Nav unter der Suche: Settings, Health, Trash)

Erledigt und nicht wieder aufrollen: Cmd+K-Palette, Generator-Popover, Ein-Sidebar-Layout, farbige Passwort-Zeichen, Electron 13→43 (`@electron/remote`; USB/YubiKey hart aus — `usb-detection` ist nicht N-API). Native Module (secure-enclave/Touch ID, keytar, argon2) sind N-API/ABI-stabil. Settings-Key über safeStorage (`settings-key.bin`, keytar nur Fallback). Bumps via `scripts/dev/update-electron.sh`. contextIsolation bewusst gestrichen (Entscheidung 2026-08-17). TOTP prominenter: von Mick als nicht relevant markiert.

Nach `node_modules`-Wechsel den Dev-Server neu starten, sonst mischt Webpack alte/neue Modulpfade (doppelte Handlebars-Instanz, Helper fehlen).

# Übergabe KeeWeb-Codex

Stand: 2026-08-17. Fork von KeeWeb (Electron 13, kein Rewrite): `mickdewald/keeweb` (origin), Upstream `keeweb/keeweb` (nur lesen). Ziel: schrittweise UX-Politur.

## Wo gearbeitet wird

| Ort | Branch | Regel |
|---|---|---|
| `~/projects/external-repos/keeweb` | master | Nur lesen / `git pull --ff-only`. |
| `~/projects/wt/keeweb-colorful-list-icons` | `grok/keeweb-colorful-list-icons` | Einzige Arbeitskopie; trackt eigene Remote-Branch. |

`node_modules` ist ein Symlink auf den Canonical-Checkout (lokal git-excluded). `keys/` ebenso. **Nicht anfassen: mick.kdbx.**

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
./scripts/dev/build-macos-touchid-agent.sh --deploy-path /Applications/KeeWeb-Codex.app --no-backup
```

Nie nach `/Applications/KeeWeb.app`. Das Deploy-Skript lintet (Prettier) und bricht bei Fehlern ab.

Zum Klick-Testen ohne mick.kdbx: `npx grunt devsrv` (Port 8085) und die Demo-Datei im Browser öffnen.

## Commits auf der Branch (alle gepusht, Worktree clean)

1. `5fe42d71` Settings-Suche, bunte Listen-Icons default
2. `38e080fb` Listen-Icons größer, vertikal zentriert
3. `42fa47de` Details vollbreit/dunkel, Attachments-Aktionen
4. `95d6e13d` Gelöschte Einträge nur im Trash
5. `b043f735` macOS-Chrome (hiddenInset + Vibrancy), Sidebar-Umbau (Tags unter All Items, Workspace-Menü unten links statt Fußleiste), Settings-Layout-Fixes
6. `556f2694` Wiederherstellen-Button im Papierkorb (nutzt `previousParentGroup`, Fallback Root)
7. `4b01e08c` Suchtreffer-Highlighting in Liste, Tabelle, Titel und allen Detail-Feldern
8. `b8721228` Suchleiste modernisiert (runde Ecken), Farblabels entfernt
9. `ab3289f3` Sidebar-Resize: no-drag auf Handle + rAF-Koaleszierung + gedrosselte Scrollbar-Recalcs
10. `58c23f20` Upstream-Auto-Updater deaktiviert (hätte Vanilla-KeeWeb drüberinstalliert)
11. `5105de05` Auto-Backups: täglich nach `~/My Drive/Backup`, `<name>.kdbx.<timestamp>.bak`, Retention 30
12. `8eba8ce2` Settings-Suche findet Datei-Settings (Backups, Master-Passwort)
13. `eaa9f3d0` Copy-Button beim Feld-Hover (Tooltip ankert am Button)

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

## Offen / Ideen (grob priorisiert)

1. **Cmd+K Schnellsuche** (Command-Palette: tippen → Enter → kopiert)
2. **TOTP prominenter** (Code groß, Countdown-Ring, One-Click-Copy)
3. **Generator-Popover** modernisieren (heißt im Workspace-Menü „Generate“)
4. Passwort-Health-Übersicht (schwach/wiederverwendet/alt)
5. Vibrancy-Feinschliff (gut, aber noch nicht ChatGPT-Niveau)
6. Sidebar-Dichte; Passwort-Anzeige mit eingefärbten Ziffern/Sonderzeichen
7. Mittelfristig: Electron-Upgrade (13 ist EOL; kein Rewrite, aber fällig)

# Done – vollständiger Projektstand

Export: 29. Oktober 2026
Quellstand: 1a46efd6dc1fb5cd2d2d1047e8b13121849a94fe
Live-Seite: https://familyflow-kalender.saschahoffmann-sh.chatgpt.site
Sites-Projekt: appgprj_6aa50aaead0c81919e9c61415e92d8e1

## Enthalten

Der vollständige Quellcode mit allen eingebundenen lokalen Grafiken und Icons,
PWA/Service Worker, Kalender, Aufträgen, Listen, Gruppen, Nachrichtenübersicht,
Terminchat mit Bildern und Sprachnachrichten, Freigabelinks, Import sowie den
Datenbankschemata, Migrationen, Tests und Build-Skripten.

Der Stand enthält auch die zuletzt lokal fertiggestellten Änderungen:
- Keine Mitteilung an den angemeldeten Nutzer bei eigenen Terminänderungen.
- Der Vollbildchat erscheint sofort mit dem Eintragskontext; seine Daten laden danach.
- Bereits gespeicherte, unveränderte Einträge werden beim Chatöffnen nicht erneut gespeichert.
- Elastisches Nachfedern an den Scrollgrenzen des Chats.

Diese letzten Änderungen sind im Quellstand enthalten. Bei diesem Export war
weiterhin Version 55 veröffentlicht; der Export ist neuer als diese Live-Version.

## E-Mail-Anmeldung und Supabase: noch nicht umgesetzt

Die vorhandene Anmeldung nutzt derzeit Profil-Zugangsschlüssel und bei den
bisherigen Familienprofilen einen Änderungscode. Eine E-Mail-/Passwort-Anmeldung,
E-Mail-Bestätigung und Passwort-Wiederherstellung sind noch nicht implementiert.
Ein Supabase-Projekt und ein Mailversanddienst sind noch nicht angebunden.
Es gibt keine abgeschlossene Supabase-Migration. Diese ZIP stellt daher keinen
bereits für den öffentlichen Betrieb mit E-Mail-Konten freigeschalteten Stand dar.

## Voraussetzungen

- Node.js ab 22.13.0 (für den SQLite-Integrationstest am besten Node 22.13+).
- pnpm in der im Feld `packageManager` von `package.json` angegebenen Version.
- Die bestehende Anwendung nutzt Vinext/React und den Cloudflare-Workers-Runtime.
- Für Online-Betrieb: D1-Datenbank (Binding `DB`) und R2-Dateispeicher (Binding `BUCKET`).

## Installation und Entwicklung

Im entpackten Ordner `Done`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Der Runtime-Aufbau ist im bestehenden `README.md` beschrieben. Die Build-Ausgabe
wird von Vinext/Vite erzeugt. Die integrierte Sites-Build-Erweiterung übernimmt
Deployment-Metadaten. `.openai/hosting.json` verweist auf die bestehende Site;
bei einem eigenständigen neuen Deployment muss eine eigene Site beziehungsweise
eine eigene Cloudflare-Konfiguration mit den tatsächlichen Bindings eingerichtet werden.

```sh
pnpm build
```

Die D1-SQL-Migrationen liegen in `drizzle/`. Sie müssen in ihrer Reihenfolge auf
die eigene D1-Datenbank angewendet werden. Vorhandene Migrationen nicht erneut
auf eine bereits migrierte Produktionsdatenbank anwenden. Die Migrationen
enthalten auch frühere Seed- und Importdaten des Familienkalenders.

## Prüfungen

```sh
node node_modules/typescript/bin/tsc --noEmit
node tests/discussions.integration.mjs
node tests/planner-api.test.mjs
```

Der Diskussionstest nutzt eine eigene SQLite-Datenbank im Arbeitsspeicher und
einen R2-Testadapter; er greift nicht auf die Live-Datenbank zu.

## Laufzeitkonfiguration

- `PROFILE_CHANGE_CODE`: bisheriger serverseitiger Änderungscode der Familienprofile.
- `VAPID_PRIVATE_KEY`: privater Web-Push-Schlüssel für Push-Mitteilungen.
- Der zugehörige öffentliche VAPID-Schlüssel ist im Quellcode referenziert.

Diese Werte müssen außerhalb des Quellcodes als geschützte Laufzeitwerte gesetzt
werden. Für eigene Push-Schlüssel muss auch der öffentliche Client-Schlüssel
entsprechend ersetzt werden. Ohne passenden privaten Schlüssel funktioniert die
bestehende Push-Anbindung im eigenen Deployment nicht.

## Umfang dieses Exports

Enthalten ist das komplette Quellprojekt. Nicht enthalten sind installierte
Abhängigkeiten (`node_modules`), reproduzierbare Build-Ausgaben, temporäre
Werkzeugzustände, Git-Verlauf, geheime Schlüssel sowie ein Export der aktuellen
Live-Datenbank und der im Chat hochgeladenen Bilder/Audio-Dateien aus R2.
Die Anwendung ist serverbasiert; das ZIP ist keine einzelne offline startbare HTML-Datei.

`EXPORT_DATEIEN_SHA256.json` enthält Prüfsummen sämtlicher ursprünglicher
Projektdateien. Die Exportanleitung und dieses Prüfsummenverzeichnis sind zusätzliche
Dateien und verändern den Quellcode der App nicht.

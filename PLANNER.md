# Gruppen und persönliche Kalender

Die Startseite verwendet `app/planner-app.tsx`. Beim Öffnen wird der eigene Kalender in der zuletzt ausgewählten Gruppe angezeigt. Jedes Mitglied kann über Bild bzw. Initialen und Namen ausgewählt werden. Die Monatsansicht enthält nur dessen zugeordnete Einträge und gemeinsame Gruppentermine. Erst die Tagesansicht ergänzt Termine anderer Gruppenmitglieder und ausschließlich eigene Termine aus weiteren Gruppen.

`/api/planner` verwaltet Profile, Gruppen, Einladungen und neue Termine in D1. Zugriff auf neue Gruppen erfordert einen Profilschlüssel und eine Mitgliedschaft. Einladungscodes sind auf eine Gruppe beschränkt. Neue Profile und Gruppen werden ausdrücklich durch Nutzeraktionen angelegt. Die ursprünglichen Profile können mit dem bestehenden `PROFILE_CHANGE_CODE` verbunden werden. Profilschlüssel werden nur an das jeweilige Gerät ausgegeben; niemals in Gruppen- oder Mitgliederlisten.

Die Gruppe `family` liest und schreibt weiterhin `calendar_items`, einschließlich Revisionen und Aufgaben. Bestehende Termine werden weder kopiert noch umgeschrieben. Die Gruppenstruktur wird beim erstmaligen Verbinden eines bestehenden Profils idempotent angelegt. Neue Gruppen verwenden `planner_events`. Alle Änderungen berücksichtigen Revisionskonflikte. Migration 0011 fügt ausschließlich neue Tabellen und Indizes hinzu.

Die bisherigen Familienlisten, Müllabholungen und Push-Einstellungen bleiben unter „Listen“ innerhalb derselben Planer-Oberfläche erreichbar. Die Hauptnavigation bleibt dabei erhalten; die eingebettete Listenansicht erzeugt keine zweite App-Hülle und keinen zweiten Toast-Bereich. Neue Gruppenkalender erhalten dadurch keine automatischen Push-Erinnerungen. Bestehende Profile behalten ihre bisherige Benachrichtigungslogik.

## Prüfung

```sh
node --experimental-strip-types --test tests/planner.test.ts tests/planner-api.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

Die API-Tests bündeln die echten Routen mit einem SQLite-D1-Adapter. Sie prüfen Gruppeneinladungen, gemeinsame Speicherung, Mitgliedschaft, fremde Gruppen, Datumsvalidierung, Revisionen, Löschen sowie die Kompatibilität mit den bisherigen Terminen. Die Kalenderprüfungen decken persönliche Monatsansichten, Gruppenabgrenzung, mehrtägige Termine und vollständige Kalenderwochen ab.

Die Kategoriefarben und Bezeichnungen liegen gemeinsam in `PLANNER_CATEGORIES` in `lib/planner.ts`. Monatsansicht, Tagesansicht, Übersicht, Legende und Editor verwenden dieselbe Zuordnung. Neue Gruppeneinträge speichern Aufträge als `event_type = task`; beim Lesen wird die Art zurückgeliefert. Bestehende Familienaufträge verwenden unverändert `calendar_items.kind`. Die API prüft die Kategorie und die Tests decken das Speichern aller sieben Kategorien ab.

## Import, Müll und Monatsgesten

Der Kalender unterstützt horizontales Wischen; vertikales Scrollen und kurze Berührungen wechseln keinen Monat. Die Übersicht stellt die nächsten sieben Tage ohne zusätzliche Kalender-Schaltfläche in den Vordergrund.

Bestehende Müllabholungen aus `lib/waste-calendar.ts` werden nur den Profilen Sascha und Katharina und nur in deren eigenen Kalendern zugeordnet. Arjen erhält diese Einträge und entsprechende Tageserinnerungen nicht. Bestätigungen werden weiterhin in `waste_pickup_status` gespeichert. Importierte Müllabholungen verwenden `planner_events.completed`; ihr Status gilt ebenfalls gemeinsam für beide Eltern.

Der Import öffnet sich über „Kalender importieren“ neben dem Plus. ICS und CSV werden zunächst im Browser gelesen und als Vorschau angezeigt. Zielgruppe, Zielkalender, Zeitraum und Müllart können geprüft werden. Eine Serverprüfung verhindert doppelte UID-/Vorkommens-Importe und inhaltliche Dubletten, einschließlich bereits vorhandener Standard-Mülltermine. ICS-Wiederholungen, Ausnahmen, exklusive Ganztags-Enddaten und Zeitzonen werden berücksichtigt. Grenzen: 2 MB Datei, 2.000 Einträge je Vorgang. Keine URL-Abonnements oder PDF-Erkennung.

Migration 0012 ergänzt ausschließlich drei Spalten und einen Index an `planner_events`. Importierte Familienereignisse bleiben in dieser Tabelle und werden dort auch bearbeitet und gelöscht; die ursprünglichen Termine in `calendar_items` bleiben erhalten.

## Logo

Das Logo (v3) ist ein schwarzes Quadrat mit weißem Kreis und abgerundetem Haken – für App-Kopf, Home-Bildschirm, Browser und Mitteilungen. Die Vorlage liegt unter `assets/branding/done-v3-master.svg`; die Produktionsgrößen (32, 128, 180, 192, 512 sowie maskable 192/512) liegen unter `public/branding/done-v3-*` und werden aus der SVG gerendert. Der Kreis liegt vollständig in der Maskable-Schutzzone. Versionierte Dateinamen, `manifest.webmanifest?v=done-v3` und ein neuer Service-Worker-Cache sorgen für die Aktualisierung.

## Einheitliche Kartenansicht (Variante 3)

Die freigegebene kompakte Gestaltung verwendet einen hellen Lavendelgrund, weiße Kacheln mit feinen Konturen, dunkle kräftige Schrift und violette Navigation. Kategorien bleiben über farbige Kanten und beschriftete Symbol-Badges erkennbar; die Farbzuordnung wird gemeinsam mit dem Kalender und Editor verwendet. Übersicht und Tagesdetails nutzen dieselbe Terminkachel mit eigener Zeitspalte, Person und optionaler Gruppe.

Die Übersicht gruppiert die eigenen offenen Einträge aller Gruppen innerhalb der nächsten sieben Tage nach Datum. „Alle“, „Termine“ und „Aufträge“ filtern dieselbe vorhandene Datenmenge; mehrtägige laufende Einträge werden unter dem heutigen Tag geführt. Kalender, Gruppen, Listen, Einkaufsliste und Dialoge teilen Konturen, Schrift, Abstände und Schaltflächen. Die bestehende Ansicht beim Öffnen bleibt der eigene Kalender.

Geprüft: TypeScript, alle 18 Kalender-/Import-/API-Tests und Browserkontrolle bei 390 Pixeln einschließlich Filter, Terminbearbeitung, Listen und Einkaufsliste mit durchgängiger Navigation. Der Screenshot unter `assets/design/compact-cards-preview.jpg` zeigt ausschließlich lokale Beispieldaten; Vorschauhilfen und lokale Datenbank werden nicht veröffentlicht.

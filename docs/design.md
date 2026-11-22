# Volleyball-Übersicht – Design

Stand: 22.11.2026

## Worum es geht
Eine persönliche Website, die mit einem Klick zeigt, wann und wo die eigenen Teams
von Döbling spielen, gegen wen, und wie die Tabelle aussieht. Die Daten kommen
automatisch vom Wiener Volleyball Verband (volleyball-wien.at), gepflegt wird
nichts von Hand. Gedacht für einen Spieler und seine Familie, vor allem am Handy.
Die Familie öffnet einen Link oder legt die Seite als App auf den Startbildschirm,
ohne Konto und ohne Anmeldung. Für sie zählt vor allem: wann, wo, wie komme ich hin.

## Teams (Saison 2026/27, bestätigt)
| Anzeige | Name in der Quelle | Bewerb heute | Seite |
|---|---|---|---|
| U18/1 | Döbling 1 | WVV - u18m Qualifikation Gruppe A | /tabellen/nachwuchs-burschen.html |
| U20/1 | Döbling 1 | WVV - u20m Qualifikation Gruppe A | /tabellen/nachwuchs-burschen.html |
| Herren/3 | Döbling 3 | WVV - Herren Landesliga Grunddurchgang | /tabellen/herren.html |

## Ziele
- Ganz oben groß: das nächste Spiel aller drei Teams mit Team, Datum, Uhrzeit,
  Gegner, Heim/Auswärts, Halle, Adresse und einem Knopf „Route“ (Google Maps).
- Umschalter: Alle / U18/1 / U20/1 / Herren/3.
- Pro Team: Bewerb und Saison, kommende Termine, Tabelle mit eigenem Team
  hervorgehoben, vergangene Spiele mit Ergebnis und Satzständen.
- „Zuletzt aktualisiert: Datum, Uhrzeit“ und „Jetzt aktualisieren“.
- Automatische Aktualisierung alle 3 Stunden. Neue Runden (z. B. Play-off,
  Meisterrunde) und die nächste Saison werden erkannt, soweit sie auf denselben
  Seiten erscheinen.
- Handy zuerst, Deutsch, Dark Mode, als App auf den Startbildschirm legbar,
  funktioniert offline mit dem letzten Stand.

## Nicht-Ziele
- Keine ÖMS-Spiele, keine anderen Döbling-Teams.
- Keine Spielernamen, keine Konten, keine Benachrichtigungen.

## Was es auf keinen Fall sein darf (Anti-Ziele)
- Erfundene oder geratene Daten. Fehlt etwas, steht „noch offen“.
- Eine leere oder kaputte Seite, weil die Quelle gerade spinnt.
- Tracking jeder Art: keine Analytics, Cookies, Werbung, Social-Media-Einbindungen,
  keine Schriften, Skripte oder Bilder von fremden Servern, keine eingebettete Karte.
- Gespeicherte Daten über Besucher oder persönliche Daten des Nutzers
  (sein Name erscheint nirgends auf der Seite oder im Code).

## Die Quelle
- Kein offizieller Feed, keine API. Daten stehen als HTML-Tabellen
  (`<TABLE CLASS="Tabelle">` und `<TABLE CLASS="Ergebnis">`) unter Überschriften
  der Form „WVV - <Bewerb> (2026/2027)“.
- Ergebnis-Zeile: Sp# | Datum | Zeit | Heim | - | Gast | Ergebnis oder Halle.
  Gespielt: „2:0 | 50:17 | 25:8,25:9“. Kommend: Hallen-Kurzname, z. B. „RH Simmering“.
- Adressen: /hallen/hallenliste.html, Einträge „Name (Kurzname) Straße, PLZ Wien“.
- robots.txt erlaubt diese Seiten. Abfrage: 3 Seiten alle 3 Stunden, 2 Sekunden
  Pause dazwischen.

## Wege, die zur Wahl standen
| Weg | Vorteil | Nachteil |
|---|---|---|
| **A: Nur GitHub (gewählt)** | Ein kostenloses Konto, keine geheimen Schlüssel, wenig Technik | „Sofort aktualisieren“ dauert 1–2 Minuten und braucht GitHub-Anmeldung |
| B: GitHub + Cloudflare | Knopf lädt in Sekunden direkt von der Quelle | Zweites Konto, mehr Teile, die kaputtgehen können |
| C: Läuft auf dem eigenen PC | Kein Konto | Aktualisiert nur, wenn der PC an ist; am Handy unterwegs nicht erreichbar |

A war meine Wahl, weil keine Antwort kam; der Nutzer kann auf B wechseln.

## Aufbau
```
volleyball-uebersicht/
  config.json            Teams, Seiten, Erkennungsregeln
  scraper/update.mjs     Holt, prüft und speichert die Daten (Node, ohne Zusatzpakete)
  site/                  Die Website (HTML, CSS, JS, Icons, manifest, service worker)
  site/data.json         Der aktuelle Datenstand
  tests/                 Prüfdaten und Browser-Tests
  .github/workflows/update.yml
```

### Daten holen (scraper)
1. Lädt die zwei Tabellenseiten und die Hallenliste.
2. Sucht alle Bewerbe, deren Titel zum Team-Muster passt (z. B. „u18m“) und deren
   Tabelle den Team-Namen enthält. Neueste Saison gewinnt; innerhalb der Saison
   werden alle Runden gezeigt, die neueste zuerst.
3. Ordnet jeder kommenden Halle die Adresse zu. Unbekannt → „Adresse noch offen“.
4. Vergleicht mit dem letzten Stand: Hat sich bei derselben Spielnummer Datum,
   Zeit oder Halle geändert, wird das Spiel als „verschoben“ bzw. „Halle geändert“
   markiert.
5. **Sicherheitsprüfung vor dem Speichern:** Jede Seite muss erreichbar sein,
   mindestens eine Tabelle haben und jedes Team muss gefunden werden. Sonst bleibt
   der alte Stand, und `data.json` bekommt nur einen Warnhinweis mit Zeitpunkt.
   Es wird nie ein leerer Stand gespeichert.
6. Speichert nur, wenn sich etwas geändert hat.

### Zeit
Datum und Uhrzeit aus der Quelle gelten als Wiener Ortszeit (Europe/Vienna). Die
Seite rechnet damit über die eingebaute Zeitzonen-Funktion des Browsers, damit die
Sommer-/Winterzeit-Umstellung stimmt. „Nächstes Spiel“ = erstes Spiel, dessen
Beginn noch nicht mehr als 2 Stunden vorbei ist.

### Automatik und Knopf
- GitHub Actions startet den scraper alle 3 Stunden und veröffentlicht die Seite
  über GitHub Pages neu.
- „Jetzt aktualisieren“ lädt sofort den neuesten veröffentlichten Stand.
- Darunter „Bei der Quelle neu abfragen“: öffnet die GitHub-Seite des Ablaufs mit
  dem Knopf „Run workflow“ (Anmeldung bei GitHub nötig). Kein Schlüssel im Browser.
  Das kann nur der Besitzer des GitHub-Kontos; für die Familie ist der Link
  klein und als „nur für Admin“ gekennzeichnet. Sie nutzt „Jetzt aktualisieren“.

### Zugang für die Familie
- Jeder mit dem Link kann die Seite sehen, ohne Konto. Ein Passwortschutz ist mit
  kostenlosem GitHub Pages nicht möglich.
- Die Seite soll nicht in Suchmaschinen auftauchen: `noindex` im Kopf der Seite und
  eine `robots.txt`, die alles sperrt. Das ist eine Bitte an Suchmaschinen, kein Schutz.
- Auf den Geräten der Familie wird nichts eingerichtet: Link öffnen genügt.
- Jeder Aufruf mit Internet holt zuerst den neuesten Datenstand (`data.json` immer
  zuerst aus dem Netz, nur ohne Netz aus dem Zwischenspeicher). Alle sehen also
  denselben Stand, höchstens etwa 3 Stunden alt. GitHub startet geplante Läufe
  manchmal mit Verspätung, daher steht „Zuletzt aktualisiert“ immer sichtbar da.
- Die Seite erklärt sich selbst: kurze Hinweise, wie man sie auf iPhone und Android
  auf den Startbildschirm legt.

### Aussehen
Klar und sportlich, Handy zuerst, Schrift und Icons werden mitgeliefert.
Details entscheidet die Gestaltung mit /frontend-design.

### Datenschutz
Keine Cookies, kein localStorage mit Personenbezug (höchstens der gewählte Team-Filter),
keine Drittanbieter-Anfragen. Google Maps nur als Link. GitHub als Host sieht technisch
bedingt IP-Adressen; der Repository-Name und GitHub-Benutzername sollten keinen echten
Namen enthalten.

## Kosten
0 €. GitHub Pages braucht bei kostenlosen Konten ein öffentliches Repository; die Daten
sind ohnehin öffentlich.

## Tests und Abnahme
- Browser-Tests (Playwright) bei 390 px und 1280 px Breite.
- Fälle: Quelle nicht erreichbar, Aufbau geändert, keine kommenden Spiele,
  Termin verschoben, unbekannte Halle.
- Abnahme: mindestens 5 Termine und alle drei Tabellen werden mit der Quelle
  verglichen und das Ergebnis gezeigt.

## Was der Nutzer tun muss
- Ein GitHub-Konto anlegen (macht er selbst) und mir den Benutzernamen sagen.
- Vor dem Veröffentlichen sein Okay geben.

## Nächste Saison
Nichts, solange die Teams gleich heißen. Ändert sich ein Team-Name oder Bewerb,
wird eine Zeile in `config.json` angepasst; die Seite warnt, wenn ein Team nicht
mehr gefunden wird.

## Dem Bauenden überlassen
Genaue Dateistruktur in `site/`, Parser-Details, Gestaltung, Icon-Motiv.

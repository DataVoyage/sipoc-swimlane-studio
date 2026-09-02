# Vorgangskatalog

Dieser Katalog listet — getrennt von der technischen Funktionsprüfung — jeden
fachlichen Vorgang, den eine Anwenderin oder ein Anwender in SIPOC Swimlane
Studio ausführen kann, mit dem jeweils erwarteten Ergebnis. Er ist nach den
Arbeitspaketen gegliedert, in denen die Anwendung entstanden ist, und bildet
die Gegenprobe zu deren Umsetzung: Ein Arbeitspaket gilt erst als vollständig,
wenn seine Vorgänge hier abgedeckt sind.

**Stand der Prüfung (02.09.2026):** 47 der 53 Vorgänge sind über
[`tests/smoke.mjs`](../tests/smoke.mjs) automatisiert abgedeckt und bestehen
(Playwright/Chromium, `npm test`) — überwiegend gegen die ausgelieferte
`index.html` per `file://`, die Vorgänge aus AP8 zusätzlich über einen
kurzlebigen lokalen HTTP-Server, weil sie das Nachladen von Dateien
voraussetzen wie im Hosting-Betrieb. Die übrigen 5 Vorgänge sind laut Quellcode umgesetzt, aber noch
nicht automatisiert geprüft (v. a. Interaktion mit der File System Access API
und dem tatsächlichen draw.io-Import, die sich in einer Kopfloser-Browser-
Umgebung nur eingeschränkt bzw. gar nicht automatisieren lassen). Sie sind
als offener Prüfvorgang markiert, nicht als fehlend.

Legende: ✅ automatisiert geprüft (`npm test`) · ◻︎ nicht automatisiert geprüft (Umsetzung laut Code vorhanden)

## AP1 — Projektverwaltung

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 1.1 | App erstmals ohne vorhandene Daten öffnen | Beispielprojekt „Kreditorenrechnungsprüfung“ (6 Akteure, 13 Schritte, 14 Verbindungen) wird geladen | ✅ |
| 1.2 | Änderung vornehmen, Seite neu laden | Autosave in `localStorage` stellt den Stand beim erneuten Öffnen wieder her | ✅ |
| 1.3 | Neues Projekt anlegen | Leeres Projekt (ohne Akteure/Schritte/Verbindungen) wird erzeugt, aktiviert und im Projekt-Auswähler gelistet | ✅ (Teil von 3.5-Vorlauf) |
| 1.4 | Projektname im Kopfbereich ändern | Name wird sofort im Auswähler und im Titel übernommen und gespeichert | ✅ |
| 1.5 | Projekt duplizieren | Vollständige Kopie mit neuen IDs für Projekt, Akteure, Schritte und Verbindungen entsteht; Original bleibt unverändert | ✅ (Anzahl geprüft; Unabhängigkeit der IDs laut Code, nicht einzeln verifiziert) |
| 1.6 | Projekt löschen (mehrere vorhanden) | Nach Bestätigung wird das Projekt entfernt, ein verbleibendes Projekt wird aktiv | ✅ |
| 1.7 | Letztes verbleibendes Projekt löschen | Löschen wird verhindert, Hinweis „kann nicht gelöscht werden“ erscheint | ✅ |
| 1.8 | Zwischen mehreren Projekten wechseln | Ausgewähltes Projekt wird in allen Ansichten (SIPOC, Akteure, Verbindungen, Diagramm) angezeigt | ✅ |
| 1.9 | „Alle Daten löschen“ (z. B. um das mitgelieferte Beispielprojekt zu entfernen und real zu starten) | Nach Bestätigung werden **alle** Projekte entfernt und durch ein einzelnes leeres Projekt ersetzt; Autosave und eine ggf. verknüpfte Datei übernehmen den leeren Stand, der Reload bestätigt | ✅ |

## AP2 — Akteure (Swimlanes)

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 2.1 | Neuen Akteur mit Name, Beschreibung und Farbe anlegen | Akteur erscheint in der Liste und steht als Swimlane für Prozessschritte zur Verfügung | ✅ (Beispielprojekt) |
| 2.2 | Akteur ohne Beschreibung anlegen | Anlage funktioniert, Beschreibungszeile bleibt in der Liste leer | ✅ |
| 2.3 | Akteur bearbeiten (Name/Beschreibung/Farbe ändern) | Änderungen erscheinen in Liste, SIPOC-Badges und Diagramm | ✅ |
| 2.4 | Reihenfolge eines Akteurs nach oben/unten verschieben | Zeilenreihenfolge ändert sich sofort und bestimmt die Zeilenfolge im Swimlane-Diagramm | ✅ |
| 2.5 | Unbenutzten Akteur löschen | Akteur wird nach Bestätigung entfernt | ✅ |
| 2.6 | Akteur löschen, der noch von Prozessschritten verwendet wird | Löschen wird verhindert, Hinweis mit Anzahl betroffener Schritte erscheint | ✅ |

## AP3 — SIPOC-Prozessschritte

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 3.1 | Neuen Schritt vom Typ „Start“ anlegen | Schritt erscheint in der Tabelle mit grünem Typ-Badge | ✅ |
| 3.2 | Neuen Schritt vom Typ „Aufgabe“ anlegen | Schritt erscheint mit blauem Typ-Badge | ✅ |
| 3.3 | Neuen Schritt vom Typ „Entscheidung“ anlegen | Schritt erscheint mit orangem Typ-Badge, wird im Diagramm als Raute dargestellt | ✅ |
| 3.4 | Neuen Schritt vom Typ „Ende“ anlegen | Schritt erscheint mit rotem Typ-Badge | ✅ |
| 3.5 | Schritt ohne Akteur anlegen versuchen (noch kein Akteur im Projekt) | Anlage wird verhindert, Hinweis „zuerst Akteur anlegen“ erscheint | ✅ |
| 3.6 | Schritt mit vollständigen SIPOC-Feldern (Supplier/Input/Output/Customer) anlegen | Alle vier Felder erscheinen als Kurzzusammenfassung unter dem Schrittnamen | ✅ |
| 3.7 | Schritt mit leeren SIPOC-Feldern anlegen | Anlage funktioniert, Zusammenfassungszeile bleibt entsprechend leer/kürzer | ✅ |
| 3.8 | Pflichtfeld „Name“ leer lassen und speichern | Browser-native Validierung verhindert Absenden | ✅ |
| 3.9 | Schritt bearbeiten (inkl. Akteur- oder Typwechsel) | Änderungen erscheinen in Tabelle und Diagramm, Diagramm-Layout passt sich an | ◻︎ |
| 3.10 | Nach Akteur filtern | Nur Schritte des gewählten Akteurs werden angezeigt; „Alle Akteure“ setzt Filter zurück | ✅ |
| 3.11 | Schritt ohne Verbindungen löschen | Schritt wird nach Bestätigung direkt entfernt | ✅ (Teil des Aufräumens vor 5.1) |
| 3.12 | Schritt mit bestehenden Verbindungen löschen | Zusätzlicher Hinweis auf Anzahl betroffener Verbindungen; nach Bestätigung werden Schritt **und** die betroffenen Verbindungen entfernt | ◻︎ |

## AP4 — Verbindungen

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 4.1 | Zwei Schritte ohne Beschriftung verbinden | Verbindung erscheint in der Liste und als Pfeil im Diagramm | ✅ (Beispielprojekt, unbeschriftete Kanten) |
| 4.2 | Zwei Schritte mit Beschriftung verbinden (z. B. „Ja“/„Nein“) | Beschriftung erscheint als Badge in der Liste und als Label am Pfeil im Diagramm/XML | ✅ |
| 4.3 | Schritt mit sich selbst verbinden | Anlage wird verhindert, Hinweistext erscheint | ✅ |
| 4.4 | Bereits bestehende Verbindung (gleiches Von/Bis) erneut anlegen | Anlage wird verhindert, Hinweis auf vorhandene Verbindung erscheint | ✅ |
| 4.5 | Verbindung bearbeiten (Ziel oder Label ändern) | Änderung wirkt sich sofort auf Liste und Diagramm aus | ✅ |
| 4.6 | Verbindung löschen | Verbindung verschwindet aus Liste und Diagramm, beteiligte Schritte bleiben erhalten | ✅ |
| 4.7 | Rückwärts gerichtete Verbindung anlegen (Rework-Schleife, Ziel liegt „vor“ der Quelle) | Layout-Berechnung erkennt den Zyklus, bricht nicht ab; Kante wird im Diagramm gestrichelt unterhalb des Ablaufs geführt | ✅ (Beispielprojekt: „erneut einreichen“) |

## AP5 — Swimlane-Diagramm & Export

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 5.1 | Diagramm-Reiter ohne jegliche Prozessschritte öffnen | Hinweistext „Noch kein Diagramm“ statt leerer Fläche | ✅ |
| 5.2 | Diagramm-Reiter mit vollständigem Beispielprojekt öffnen | Alle Akteure als Zeilen, alle Schritte in der laut Verbindungen korrekten Spalte, Verzweigungen und Zusammenführungen korrekt gezeichnet | ✅ |
| 5.3 | Zwei Schritte desselben Akteurs auf derselben Ablaufspalte (Kollisionsfall) | Schritte werden innerhalb der Zeile untereinander gestapelt, Zeilenhöhe vergrößert sich automatisch | ✅ (visuell im Screenshot bestätigt, Akteur „Fachbereich“ im Beispielprojekt) |
| 5.4 | Zoom vergrößern/verkleinern über die Buttons | Diagrammgröße skaliert, Prozentanzeige aktualisiert sich | ✅ |
| 5.5 | „Einpassen“ nach Fenstergrößenänderung | Zoomstufe wird automatisch neu berechnet, Diagramm passt vollständig in den sichtbaren Bereich | ◻︎ |
| 5.6 | „Als draw.io exportieren“ | `.drawio.xml`-Datei wird heruntergeladen, enthält gültiges `mxfile`-XML mit einer `swimlane` je Akteur, typgerechten Formen je Schritt-Typ und beschrifteten Kanten | ✅ (Wohlgeformtheit und Struktur automatisiert geprüft) |
| 5.7 | „XML kopieren“ | XML liegt in der Zwischenablage vor und kann direkt in draw.io eingefügt werden | ◻︎ |
| 5.8 | „XML kopieren“ in einem Kontext ohne Zwischenablagen-Berechtigung | Automatischer Rückfall auf Dateidownload statt Fehlermeldung | ◻︎ |
| 5.9 | Exportierte `.drawio.xml` in draw.io/diagrams.net öffnen | Diagramm öffnet sich als natives, weiter editierbares Swimlane-Diagramm mit identischer Struktur wie die App-Vorschau | ◻︎ (nur XML-Struktur geprüft, nicht der Import in draw.io selbst) |

## AP6 — Persistenz & Datenaustausch

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 6.1 | Beliebige Änderung vornehmen, Seite neu laden (ohne Datei-Verknüpfung) | Änderung ist über `localStorage` erhalten geblieben | ✅ (deckungsgleich mit 1.2) |
| 6.2 | „Datei verknüpfen…“ in Chrome/Edge | Datei-Auswahldialog öffnet sich, gewählte/neue Datei wird ab sofort bei jeder Änderung automatisch beschrieben | ◻︎ |
| 6.3 | „Datei verknüpfen…“ in einem Browser ohne File-System-Access-API (z. B. Firefox) | Hinweis auf Export/Import als Alternative statt Fehler ohne Erklärung | ◻︎ |
| 6.4 | Aktuelles Projekt exportieren | `*.sipoc.json`-Datei mit vollständigem Projektinhalt wird heruntergeladen | ✅ |
| 6.5 | Exportierte Einzelprojekt-Datei in einer anderen Browser-Instanz importieren | Projekt erscheint zusätzlich im Projekt-Auswähler und wird aktiv | ✅ |
| 6.6 | Datei mit mehreren Projekten (Gesamt-Export) importieren | Alle enthaltenen Projekte werden ergänzt, ohne vorhandene Projekte zu überschreiben | ✅ |
| 6.7 | Ungültige Datei importieren (kein SIPOC-JSON) | Fehlermeldung „kein gültiges SIPOC-Projekt“, bestehende Daten bleiben unangetastet | ✅ |

## AP7 — Darstellung

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 7.1 | Darstellung zwischen System/Hell/Dunkel umschalten | Farbschema wechselt sofort in allen Bereichen (Listen, Panel, Diagramm) und bleibt nach Neuladen erhalten | ✅ |
| 7.2 | Fenster verkleinern (schmaler Viewport) | Seitenleiste reduziert sich auf Icons, Inhalt bleibt bedienbar | ✅ |
| 7.3 | Aktionsmenü in der Kopfzeile öffnen, Eintrag wählen, per Klick daneben oder Escape schließen | Menü öffnet und schließt sauber; der gewählte Eintrag führt seine Aktion aus, das Menü schließt vorher | ✅ |

## AP8 — Auslieferung & Robustheit

| # | Vorgang | Erwartetes Ergebnis | Geprüft |
|---|---|---|---|
| 8.1 | „App als Datei herunterladen…“ mit „Aktuelle Daten übernehmen“ | Einzelne HTML-Datei wird erzeugt, in der Gestaltung und Programm eingebettet sind und die keine externen Dateien mehr referenziert; der aktuelle Datenbestand liegt eingebettet bei | ✅ |
| 8.2 | Download mit „Beispielprojekt“ bzw. „Leer starten“ | Datei enthält statt der aktuellen Daten das Beispielprojekt bzw. ein einzelnes leeres Projekt | ◻︎ |
| 8.3 | Heruntergeladene Datei per Doppelklick (`file://`) öffnen | App startet ohne Internetverbindung vollständig: Gestaltung greift, übernommene Daten sind vorhanden, Diagramm und draw.io-Export funktionieren, keine JavaScript-Fehler | ✅ |
| 8.4 | Aus der heruntergeladenen Datei heraus erneut „App als Datei herunterladen“ | Erzeugt wieder eine vollständige, eigenständige Datei — auch ohne Nachladen von Dateien | ✅ |
| 8.5 | Seitengerüst und Programmdatei stammen aus verschiedenen Ständen (veralteter Browser-Cache) | Hinweisleiste „veraltete Programmdatei … bitte neu laden“ erscheint, statt dass Schaltflächen stillschweigend wirkungslos bleiben | ✅ |
| 8.6 | Ein erwartetes Bedienelement fehlt im Seitengerüst | Die übrige Anwendung bleibt vollständig bedienbar; es erscheint lediglich eine Warnung in der Browser-Konsole | ✅ |

## Smoke-Test ausführen

```bash
npm install                                   # einmalig, nur für diesen Testlauf
npx playwright install --with-deps chromium   # einmalig
npm test
```

Der Test öffnet `index.html` unverändert per `file://`, führt die oben mit ✅
markierten Vorgänge nacheinander aus und meldet am Ende Anzahl bestandener
Vorgänge sowie etwaige JavaScript-Fehler der Seite. Er verändert nichts an
der Anwendung selbst und ist für die Nutzung von SIPOC Swimlane Studio nicht
erforderlich.

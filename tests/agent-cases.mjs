// Fallsammlung für die Prüfung des Agenten-Imports (AP9 in docs/vorgaenge.md).
//
// Jeder Fall beschreibt eine Antwort, wie sie ein KI-Agent liefern könnte, und
// was die Anwendung daraus machen muss: durchlassen oder beanstanden — und mit
// welcher Aussage in der Rückmeldung an den Agenten.
//
// Feld "expect": Mindestens einer der Teilstrings muss in der Rückmeldung
// vorkommen (mehrere Einträge decken gleichwertige Formulierungen ab).

const gutesJson = {
  format: "sipoc-swimlane-studio/agent-import",
  version: 1,
  project: { name: "Reklamation bearbeiten" },
  lanes: [
    { name: "Kundenservice", description: "Erstkontakt" },
    { name: "Qualitätssicherung", description: "Technische Bewertung" },
  ],
  steps: [
    { key: "eingang", name: "Reklamation aufnehmen", lane: "Kundenservice", type: "start",
      supplier: "Kundin", input: "Reklamationsmeldung", output: "Erfasster Vorgang", customer: "Qualitätssicherung" },
    { key: "pruefen", name: "Mangel technisch bewerten", lane: "Qualitätssicherung", type: "task",
      supplier: "Kundenservice", input: "Erfasster Vorgang", output: "Prüfbericht", customer: "Kundenservice" },
    { key: "berechtigt", name: "Reklamation berechtigt?", lane: "Qualitätssicherung", type: "decision",
      supplier: "Qualitätssicherung", input: "Prüfbericht", output: "Entscheidung", customer: "Kundenservice" },
    { key: "ersatz", name: "Ersatzlieferung veranlassen", lane: "Kundenservice", type: "end",
      supplier: "Qualitätssicherung", input: "Positive Entscheidung", output: "Ersatzlieferung", customer: "Kundin" },
    { key: "absage", name: "Ablehnung begründen", lane: "Kundenservice", type: "end",
      supplier: "Qualitätssicherung", input: "Negative Entscheidung", output: "Begründete Absage", customer: "Kundin" },
  ],
  connections: [
    { from: "eingang", to: "pruefen" },
    { from: "pruefen", to: "berechtigt" },
    { from: "berechtigt", to: "ersatz", label: "Ja" },
    { from: "berechtigt", to: "absage", label: "Nein" },
  ],
};

const clone = (mutate) => {
  const c = JSON.parse(JSON.stringify(gutesJson));
  if (mutate) mutate(c);
  return JSON.stringify(c, null, 2);
};

export const cases = [
  // Verweist eine Verbindung auf einen Schritt, der wegen eines eigenen Mangels
  // verworfen wurde, darf daraus kein zweiter (Folge-)Fehler entstehen.
  { name: "kein Folgefehler bei verworfenem Schritt", input: clone((c) => { c.steps[1].lane = "Unbekannt"; }), expectOk: false,
    expect: ['Der Akteur "Unbekannt" ist unter lanes nicht definiert'],
    expectNot: ['Der Schlüssel "pruefen" kommt in steps nicht vor'] },
  { name: "leere Eingabe", input: "", expectOk: false, expect: ["kein Text eingefügt"] },
  { name: "Fließtext ohne JSON", input: "Klar, hier ist dein Prozess!", expectOk: false, expect: ["kein gültiges JSON"] },
  { name: "Markdown-Codeblock", input: "```json\n" + clone() + "\n```", expectOk: true, expect: ["Markdown-Codeblock"] },
  { name: "Erklärtext vor dem JSON", input: "Gerne! Hier das Ergebnis:\n" + clone(), expectOk: true, expect: ["zusätzlicher Text"] },
  { name: "Komma am Listenende", input: '{ "project": { "name": "X" }, "lanes": [], }', expectOk: false, expect: ["kein gültiges JSON", "Zeile"] },
  { name: "Liste statt Objekt", input: "[]", expectOk: false, expect: ["eine Liste"] },
  { name: "format fehlt", input: clone((c) => delete c.format), expectOk: true, expect: ["Das Feld format fehlt"] },
  { name: "project fehlt", input: clone((c) => delete c.project), expectOk: false, expect: ["Abschnitt project fehlt"] },
  { name: "project ist Text", input: clone((c) => { c.project = "Reklamation"; }), expectOk: false, expect: ["project ist Text"] },
  { name: "project.name leer", input: clone((c) => { c.project.name = "  "; }), expectOk: false, expect: ["Prozessname fehlt"] },
  { name: "lanes fehlt", input: clone((c) => delete c.lanes), expectOk: false, expect: ["Abschnitt lanes fehlt"] },
  { name: "lanes leer", input: clone((c) => { c.lanes = []; }), expectOk: false, expect: ["lanes ist leer"] },
  { name: "lanes ist Objekt", input: clone((c) => { c.lanes = { name: "X" }; }), expectOk: false, expect: ["lanes ist Objekt"] },
  { name: "Akteur ohne name", input: clone((c) => { c.lanes[1] = { description: "ohne Namen" }; }), expectOk: false, expect: ["lanes[1].name"] },
  { name: "doppelter Akteur", input: clone((c) => { c.lanes[1].name = "Kundenservice"; }), expectOk: false, expect: ["mehrfach vorhanden"] },
  { name: "steps fehlt", input: clone((c) => delete c.steps), expectOk: false, expect: ["Abschnitt steps fehlt"] },
  { name: "steps leer", input: clone((c) => { c.steps = []; }), expectOk: false, expect: ["steps ist leer"] },
  { name: "Schritt ohne key", input: clone((c) => { delete c.steps[1].key; }), expectOk: false, expect: ["steps[1].key", "Schlüssel key fehlt"] },
  { name: "doppelter key", input: clone((c) => { c.steps[2].key = "pruefen"; }), expectOk: false, expect: ["mehrfach verwendet"] },
  // Der zuerst vergebene Schritt ist hier zusätzlich fehlerhaft (unbekannter
  // Akteur) und wird verworfen — das Duplikat muss trotzdem auffallen.
  { name: "doppelter key trotz verworfenem Vorgänger", input: clone((c) => { c.steps[1].lane = "Unbekannt"; c.steps[2].key = "pruefen"; }), expectOk: false, expect: ["mehrfach verwendet"] },
  { name: "key mit Leerzeichen", input: clone((c) => { c.steps[1].key = "mangel pruefen"; c.connections[1].from = "mangel pruefen"; c.connections[1].to = "berechtigt"; c.connections[0].to = "mangel pruefen"; }), expectOk: true, expect: ["Sonderzeichen oder Leerzeichen"] },
  { name: "Schritt ohne name", input: clone((c) => { delete c.steps[1].name; }), expectOk: false, expect: ["steps[1].name", "Name des Prozessschritts fehlt"] },
  { name: "name ist Zahl", input: clone((c) => { c.steps[1].name = 42; }), expectOk: false, expect: ["steps[1].name"] },
  { name: "unbekannter Akteur", input: clone((c) => { c.steps[1].lane = "Buchhaltung"; }), expectOk: false, expect: ["ist unter lanes nicht definiert", "Definierte Akteure"] },
  { name: "Akteur nur andere Schreibweise", input: clone((c) => { c.steps[1].lane = "qualitätssicherung"; }), expectOk: true, expect: ["wich in der Schreibweise ab"] },
  { name: "lane fehlt", input: clone((c) => { delete c.steps[1].lane; }), expectOk: false, expect: ["Zuordnung zu einem Akteur fehlt"] },
  { name: "type fehlt", input: clone((c) => { delete c.steps[1].type; }), expectOk: false, expect: ["Feld type fehlt"] },
  { name: "type ungültig", input: clone((c) => { c.steps[1].type = "erledigt" }), expectOk: false, expect: ['Ungültiger Wert "erledigt"', '"start", "task", "decision", "end"'] },
  { name: "type deutsch", input: clone((c) => { c.steps[1].type = "Entscheidung"; }), expectOk: true, expect: ['gewertet', "decision"] },
  { name: "type großgeschrieben", input: clone((c) => { c.steps[1].type = "TASK"; }), expectOk: true, expect: ["kleingeschrieben"] },
  { name: "connections fehlt", input: clone((c) => delete c.connections), expectOk: false, expect: ["Abschnitt connections fehlt"] },
  { name: "connections leer", input: clone((c) => { c.connections = []; }), expectOk: false, expect: ["connections ist leer"] },
  { name: "from unbekannt", input: clone((c) => { c.connections[0].from = "start_xyz"; }), expectOk: false, expect: ['"start_xyz" kommt in steps nicht vor', "Vorhandene Schlüssel"] },
  { name: "to fehlt", input: clone((c) => { delete c.connections[0].to; }), expectOk: false, expect: ["connections[0].to", "Feld to fehlt"] },
  { name: "Verbindung auf sich selbst", input: clone((c) => { c.connections[0].to = "eingang"; }), expectOk: false, expect: ["verweist auf sich selbst"] },
  { name: "doppelte Verbindung", input: clone((c) => { c.connections.push({ from: "eingang", to: "pruefen" }); }), expectOk: true, expect: ["doppelt vorhanden"] },
  { name: "label ist Zahl", input: clone((c) => { c.connections[2].label = 1; }), expectOk: true, expect: ["label ist Zahl"] },
  { name: "kein start", input: clone((c) => { c.steps[0].type = "task"; }), expectOk: true, expect: ['Kein Schritt hat type "start"'] },
  { name: "zwei start", input: clone((c) => { c.steps[1].type = "start"; }), expectOk: true, expect: ['Schritte mit type "start"'] },
  { name: "kein end", input: clone((c) => { c.steps[3].type = "task"; c.steps[4].type = "task"; }), expectOk: true, expect: ['Kein Schritt hat type "end"'] },
  { name: "Entscheidung mit einem Zweig", input: clone((c) => { c.connections = c.connections.filter((x) => x.to !== "absage"); }), expectOk: true, expect: ["ausgehende Verbindung"] },
  { name: "Entscheidungszweige ohne label", input: clone((c) => { delete c.connections[2].label; delete c.connections[3].label; }), expectOk: true, expect: ["label"] },
  { name: "verwaister Schritt", input: clone((c) => { c.steps.push({ key: "isoliert", name: "Vorgang archivieren", lane: "Kundenservice", type: "task", supplier: "a", input: "b", output: "c", customer: "d" }); }), expectOk: true, expect: ["über keine Verbindung erreichbar"] },
  { name: "SIPOC-Felder fehlen", input: clone((c) => { delete c.steps[1].supplier; delete c.steps[1].input; }), expectOk: true, expect: ["SIPOC-Felder"] },
  { name: "unbekanntes Feld", input: clone((c) => { c.steps[1].dauer = "3 Tage"; }), expectOk: true, expect: ["Unbekannte Felder: dauer"] },
  { name: "Akteur ohne Schritte", input: clone((c) => { c.lanes.push({ name: "Vertrieb" }); }), expectOk: true, expect: ["kein Prozessschritt zugeordnet"] },
  { name: "vollständig korrekt", input: clone(), expectOk: true, expect: ["erfolgreich"] },
];

export const gutesBeispiel = clone();

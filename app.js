"use strict";

/* =====================================================================
   SIPOC Swimlane Studio
   Standalone Browser-App zur Erfassung von SIPOC-Prozessen und deren
   automatischer Darstellung als Swimlane-Diagramm inkl. draw.io-Export.
   Keine Abhängigkeiten, kein Build-Schritt, kein Server — läuft per
   Doppelklick auf index.html oder als statische Seite.
   ===================================================================== */

(function () {
  const STORAGE_KEY = "sipocSwimlaneStudio.store.v1";
  const IDB_NAME = "sipoc-swimlane-studio";
  const IDB_STORE = "handles";

  // Muss mit <meta name="app-version"> in index.html übereinstimmen. Weicht sie
  // ab, hat der Browser eine der beiden Dateien aus einem veralteten Cache
  // geladen — dann fehlen Bedienelemente oder deren Funktion stillschweigend.
  const APP_VERSION = "1.6.0";

  const STEP_TYPES = {
    trigger:  { label: "Trigger",       shape: "event",       color: "var(--purple)", order: 0 },
    start:    { label: "Start",         shape: "terminator",  color: "var(--green)",  order: 1 },
    task:     { label: "Aufgabe",       shape: "rect",        color: "var(--accent)", order: 2 },
    decision: { label: "Entscheidung",  shape: "rhombus",     color: "var(--orange)", order: 3 },
    end:      { label: "Ende",          shape: "terminator",  color: "var(--red)",    order: 4 },
  };

  const LANE_COLORS = [
    "#0a84ff", "#34c759", "#ff9500", "#af52de",
    "#30b0c7", "#ff375f", "#5856d6", "#ffd60a",
  ];

  const LAYOUT = {
    laneStartSize: 42,   // Breite des Akteur-Beschriftungsstreifens links
    stepWidth: 190,
    stepHeight: 66,
    colGap: 70,
    rowGap: 18,
    laneVPad: 20,
    lanePadTop: 40,
    lanePadBottom: 24,
  };

  /* ------------------------------------------------------------ utils */

  // Defensives Verdrahten: Fehlt ein Element (z. B. weil der Browser eine
  // veraltete index.html zwischengespeichert hat), darf nicht der gesamte
  // Rest der Verdrahtung ausfallen — deshalb wird nur gewarnt.
  function on(id, event, handler) {
    const el = document.getElementById(id);
    if (!el) {
      console.warn("[SIPOC Swimlane Studio] Bedienelement nicht gefunden: #" + id);
      return null;
    }
    el.addEventListener(event, handler);
    return el;
  }

  function uid(prefix) {
    const rnd = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return (prefix || "id") + "-" + rnd.slice(0, 8);
  }

  function escapeXml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  function nowLabel() {
    const d = new Date();
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ------------------------------------------------------ Beispieldaten */
  // Fiktives, realistisches Beispiel (Kreditorenrechnungsprüfung bei einem
  // Ingenieurbüro) — bewusst branchenneutral für Beispiel-/Demozwecke, ohne
  // Bezug zu einem konkreten Fach-/Zielsystem, damit die App für beliebige
  // SIPOC-Prozesse wiederverwendbar bleibt.
  function seedProject() {
    const lane = (name, description, color) => ({ id: uid("lane"), name, description, color });
    const L = {
      lieferant: lane("Lieferant", "Externer Rechnungssteller (Wesselmann Baustoffhandel GmbH)", LANE_COLORS[0]),
      posteingang: lane("Rechnungseingang", "Zentrale Poststelle / E-Invoicing-Eingang", LANE_COLORS[1]),
      kreditoren: lane("Kreditorenbuchhaltung", "Team Kreditoren der Finanzbuchhaltung", LANE_COLORS[2]),
      fachbereich: lane("Fachbereich", "Projektleitung / Kostenstellenverantwortliche", LANE_COLORS[3]),
      geschaeftsfuehrung: lane("Geschäftsführung", "Freigabeinstanz für Rechnungen über 5.000 €", LANE_COLORS[4]),
      finanzsystem: lane("Finanzsystem", "Zahlungsverkehr im ERP (automatisierter Zahllauf)", LANE_COLORS[5]),
    };
    const lanes = Object.values(L);

    const step = (laneKey, type, name, s) => ({
      id: uid("step"),
      lane: L[laneKey].id,
      type,
      name,
      supplier: s.supplier || "",
      input: s.input || "",
      output: s.output || "",
      customer: s.customer || "",
      description: s.description || "",
      inputFrom: [],
    });

    const S = {};
    S.s1 = step("lieferant", "start", "Rechnung erstellen und versenden", {
      supplier: "Wesselmann Baustoffhandel GmbH",
      input: "Leistungsnachweis, Aufmaß, Lieferschein",
      output: "Rechnung (PDF per E-Mail bzw. Papierpost)",
      customer: "Rechnungseingang",
      description: "Der Lieferant stellt nach erbrachter Leistung eine Rechnung mit Bezug auf die Bestellnummer aus.",
    });
    S.s2 = step("posteingang", "task", "Rechnung erfassen und digitalisieren", {
      supplier: "Wesselmann Baustoffhandel GmbH",
      input: "Eingehende Papier- oder PDF-Rechnung",
      output: "Digitalisierte Rechnung mit Eingangsstempel und Barcode",
      customer: "Kreditorenbuchhaltung",
      description: "Posteingang scannt Papierrechnungen bzw. übernimmt E-Rechnungen automatisiert in die Workflow-Ablage.",
    });
    S.s3 = step("kreditoren", "task", "Rechnung im Finanzsystem anlegen", {
      supplier: "Rechnungseingang",
      input: "Digitalisierte Rechnung",
      output: "Rechnungsbeleg mit Belegnummer",
      customer: "Kreditorenbuchhaltung",
      description: "Erfassung der Kopfdaten (Lieferant, Betrag, Fälligkeit, Bestellbezug) im Finanzsystem.",
    });
    S.s4 = step("kreditoren", "decision", "Formalprüfung vollständig?", {
      supplier: "Kreditorenbuchhaltung",
      input: "Rechnungsbeleg, Bestelldaten",
      output: "Prüfprotokoll (Bestellnummer, Steuernummer, Kontierung)",
      customer: "Kreditorenbuchhaltung",
      description: "Prüfung, ob alle Pflichtangaben und der Bestellbezug vorhanden sind.",
    });
    S.s5 = step("kreditoren", "task", "Rückfrage an Lieferanten klären", {
      supplier: "Kreditorenbuchhaltung",
      input: "Unvollständige Rechnungsangaben",
      output: "Korrigierte bzw. ergänzte Rechnung",
      customer: "Wesselmann Baustoffhandel GmbH",
      description: "Bei fehlenden Angaben wird der Lieferant zur Korrektur aufgefordert; die Rechnung wird danach erneut geprüft.",
    });
    S.s6 = step("fachbereich", "decision", "Leistung erbracht und mengenmäßig korrekt?", {
      supplier: "Kreditorenbuchhaltung",
      input: "Rechnungsbeleg, Aufmaß / Lieferschein",
      output: "Sachliches Prüfergebnis",
      customer: "Fachbereich",
      description: "Der Kostenstellenverantwortliche bestätigt, dass die berechnete Leistung tatsächlich erbracht wurde.",
    });
    S.s7 = step("fachbereich", "end", "Rechnung zurückweisen", {
      supplier: "Fachbereich",
      input: "Negatives Prüfergebnis",
      output: "Rückweisungsschreiben",
      customer: "Wesselmann Baustoffhandel GmbH",
      description: "Bei nicht nachweisbarer Leistungserbringung wird die Rechnung förmlich zurückgewiesen; der Vorgang endet hier.",
    });
    S.s8 = step("fachbereich", "decision", "Rechnungsbetrag über 5.000 €?", {
      supplier: "Fachbereich",
      input: "Sachlich geprüfte Rechnung",
      output: "Erforderliche Freigabestufe",
      customer: "Fachbereich / Geschäftsführung",
      description: "Bestimmt, ob die Freigabe durch den Kostenstellenverantwortlichen ausreicht oder die Geschäftsführung einbezogen werden muss.",
    });
    S.s9 = step("fachbereich", "task", "Freigabe durch Kostenstellenverantwortlichen", {
      supplier: "Fachbereich",
      input: "Geprüfte Rechnung bis 5.000 €",
      output: "Freigegebene Rechnung",
      customer: "Kreditorenbuchhaltung",
      description: "",
    });
    S.s10 = step("geschaeftsfuehrung", "task", "Freigabe durch Geschäftsführung", {
      supplier: "Fachbereich",
      input: "Geprüfte Rechnung über 5.000 €",
      output: "Freigegebene Rechnung",
      customer: "Kreditorenbuchhaltung",
      description: "",
    });
    S.s11 = step("kreditoren", "task", "Zahlungslauf einplanen", {
      supplier: "Fachbereich / Geschäftsführung",
      input: "Freigegebene Rechnung",
      output: "Zahlungsvorschlag im Zahllauf",
      customer: "Finanzsystem",
      description: "",
    });
    S.s12 = step("finanzsystem", "task", "Zahlung ausführen (SEPA-Überweisung)", {
      supplier: "Kreditorenbuchhaltung",
      input: "Zahlungsvorschlag",
      output: "Zahlungsavis, Kontoauszugsbuchung",
      customer: "Wesselmann Baustoffhandel GmbH",
      description: "",
    });
    S.s13 = step("kreditoren", "end", "Vorgang abschließen und archivieren", {
      supplier: "Finanzsystem",
      input: "Zahlungsbestätigung",
      output: "Revisionssicher archivierter Rechnungsvorgang",
      customer: "Revision / Wirtschaftsprüfung",
      description: "Nach erfolgter Zahlung wird der vollständige Vorgang GoBD-konform archiviert.",
    });

    const steps = Object.values(S);
    const conn = (from, to, label) => ({ id: uid("conn"), from: S[from].id, to: S[to].id, label: label || "" });
    const connections = [
      conn("s1", "s2"),
      conn("s2", "s3"),
      conn("s3", "s4"),
      conn("s4", "s5", "Nein"),
      conn("s5", "s3", "erneut einreichen"),
      conn("s4", "s6", "Ja"),
      conn("s6", "s7", "Nein"),
      conn("s6", "s8", "Ja"),
      conn("s8", "s9", "≤ 5.000 €"),
      conn("s8", "s10", "> 5.000 €"),
      conn("s9", "s11"),
      conn("s10", "s11"),
      conn("s11", "s12"),
      conn("s12", "s13"),
    ];

    // Artefaktkette: Woher stammt der Input eines Schritts? Bei s11 laufen die
    // beiden Freigabewege zusammen — der Input hat also zwei Herkünfte.
    const herkunft = {
      s2: ["s1"], s3: ["s2"], s4: ["s3"], s5: ["s4"], s6: ["s4"], s7: ["s6"],
      s8: ["s6"], s9: ["s8"], s10: ["s8"], s11: ["s9", "s10"], s12: ["s11"], s13: ["s12"],
    };
    Object.keys(herkunft).forEach((key) => {
      S[key].inputFrom = herkunft[key].map((q) => S[q].id);
    });

    return {
      id: uid("proj"),
      name: "Kreditorenrechnungsprüfung",
      updatedAt: Date.now(),
      lanes,
      steps,
      connections,
    };
  }

  // Dem Rechnungsprozess vorgelagert: Hier entsteht die Bestellung, auf die
  // sich die spätere Rechnung bezieht.
  function seedProcurementProject() {
    const lane = (name, description, color) => ({ id: uid("lane"), name, description, color });
    const L = {
      projektleitung: lane("Projektleitung", "Bedarfsträger im Ingenieurprojekt", LANE_COLORS[3]),
      einkauf: lane("Einkauf", "Zentraler Einkauf", LANE_COLORS[2]),
      geschaeftsfuehrung: lane("Geschäftsführung", "Freigabeinstanz ab 10.000 €", LANE_COLORS[4]),
    };
    const lanes = Object.values(L);
    const step = (laneKey, type, name, s) => ({
      id: uid("step"), lane: L[laneKey].id, type, name,
      supplier: s.supplier || "", input: s.input || "", output: s.output || "",
      customer: s.customer || "", description: s.description || "", inputFrom: [],
    });

    const S = {};
    S.b1 = step("projektleitung", "start", "Bedarf im Projekt feststellen", {
      supplier: "Projektteam", input: "Leistungsverzeichnis, Terminplan",
      output: "Bedarfsmeldung mit Mengengerüst", customer: "Projektleitung",
      description: "Aus der Bauablaufplanung ergibt sich ein Material- oder Leistungsbedarf.",
    });
    S.b2 = step("projektleitung", "task", "Bestellanforderung erfassen", {
      supplier: "Projektleitung", input: "Bedarfsmeldung mit Mengengerüst",
      output: "Bestellanforderung mit Kostenstelle", customer: "Einkauf",
    });
    S.b3 = step("einkauf", "task", "Angebote einholen und vergleichen", {
      supplier: "Projektleitung", input: "Bestellanforderung mit Kostenstelle",
      output: "Angebotsspiegel mit Vergabevorschlag", customer: "Einkauf",
    });
    S.b4 = step("einkauf", "decision", "Auftragswert über 10.000 €?", {
      supplier: "Einkauf", input: "Angebotsspiegel mit Vergabevorschlag",
      output: "Erforderliche Freigabestufe", customer: "Einkauf / Geschäftsführung",
    });
    S.b5 = step("geschaeftsfuehrung", "task", "Vergabe freigeben", {
      supplier: "Einkauf", input: "Vergabevorschlag über 10.000 €",
      output: "Freigegebener Vergabevorschlag", customer: "Einkauf",
    });
    S.b6 = step("einkauf", "task", "Bestellung beim Lieferanten auslösen", {
      supplier: "Einkauf / Geschäftsführung", input: "Freigegebener Vergabevorschlag",
      output: "Bestellung mit Bestellnummer", customer: "Wesselmann Baustoffhandel GmbH",
    });
    S.b7 = step("einkauf", "end", "Auftragsbestätigung ablegen", {
      supplier: "Wesselmann Baustoffhandel GmbH", input: "Auftragsbestätigung des Lieferanten",
      output: "Verbindliche Bestellung mit Bestellnummer", customer: "Kreditorenbuchhaltung",
      description: "Die abgelegte Bestellung ist später die Grundlage der Rechnungsprüfung.",
    });

    const conn = (from, to, label) => ({ id: uid("conn"), from: S[from].id, to: S[to].id, label: label || "" });
    const herkunft = { b2: ["b1"], b3: ["b2"], b4: ["b3"], b5: ["b4"], b6: ["b5", "b4"], b7: ["b6"] };
    Object.keys(herkunft).forEach((k) => { S[k].inputFrom = herkunft[k].map((q) => S[q].id); });

    return {
      id: uid("proj"),
      name: "Beschaffungsantrag freigeben",
      updatedAt: Date.now(),
      lanes,
      steps: Object.values(S),
      connections: [
        conn("b1", "b2"), conn("b2", "b3"), conn("b3", "b4"),
        conn("b4", "b5", "Ja"), conn("b4", "b6", "Nein"),
        conn("b5", "b6"), conn("b6", "b7"),
      ],
    };
  }

  // Dem Rechnungsprozess nachgelagert: Was mit den gebuchten Vorgängen zum
  // Monatsende geschieht.
  function seedClosingProject() {
    const lane = (name, description, color) => ({ id: uid("lane"), name, description, color });
    const L = {
      kreditoren: lane("Kreditorenbuchhaltung", "Team Kreditoren der Finanzbuchhaltung", LANE_COLORS[2]),
      hauptbuch: lane("Hauptbuchhaltung", "Verantwortlich für den Monatsabschluss", LANE_COLORS[6]),
      pruefung: lane("Wirtschaftsprüfung", "Externe Prüfgesellschaft", LANE_COLORS[5]),
    };
    const lanes = Object.values(L);
    const step = (laneKey, type, name, s) => ({
      id: uid("step"), lane: L[laneKey].id, type, name,
      supplier: s.supplier || "", input: s.input || "", output: s.output || "",
      customer: s.customer || "", description: s.description || "", inputFrom: [],
    });

    const S = {};
    S.m1 = step("kreditoren", "start", "Offene Posten zum Monatsende ermitteln", {
      supplier: "Kreditorenbuchhaltung", input: "Archivierte Rechnungsvorgänge des Monats",
      output: "Liste der offenen Posten", customer: "Kreditorenbuchhaltung",
    });
    S.m2 = step("kreditoren", "task", "Abgrenzungen für erbrachte, nicht berechnete Leistungen bilden", {
      supplier: "Fachbereich", input: "Liste der offenen Posten, Leistungsstände",
      output: "Abgrenzungsbuchungen", customer: "Hauptbuchhaltung",
    });
    S.m3 = step("kreditoren", "task", "Saldenabstimmung mit Lieferanten durchführen", {
      supplier: "Wesselmann Baustoffhandel GmbH", input: "Saldenbestätigungen",
      output: "Abgestimmte Kreditorensalden", customer: "Kreditorenbuchhaltung",
    });
    S.m4 = step("kreditoren", "decision", "Differenzen in der Abstimmung?", {
      supplier: "Kreditorenbuchhaltung", input: "Abgestimmte Kreditorensalden",
      output: "Abstimmergebnis", customer: "Kreditorenbuchhaltung",
    });
    S.m5 = step("kreditoren", "task", "Differenzen klären und korrigieren", {
      supplier: "Kreditorenbuchhaltung", input: "Abweichungsliste",
      output: "Korrekturbuchungen", customer: "Kreditorenbuchhaltung",
      description: "Nach der Korrektur wird die Abstimmung erneut durchlaufen.",
    });
    S.m6 = step("hauptbuch", "task", "Kreditorenkonten ins Hauptbuch überleiten", {
      supplier: "Kreditorenbuchhaltung", input: "Abgestimmte Salden, Abgrenzungsbuchungen",
      output: "Überleitung im Hauptbuch", customer: "Hauptbuchhaltung",
    });
    S.m7 = step("hauptbuch", "end", "Abschlussunterlagen bereitstellen", {
      supplier: "Hauptbuchhaltung", input: "Überleitung im Hauptbuch",
      output: "Abschlussmappe Kreditoren", customer: "Wirtschaftsprüfung",
    });
    S.m8 = step("pruefung", "end", "Belegstichprobe prüfen", {
      supplier: "Hauptbuchhaltung", input: "Abschlussmappe Kreditoren",
      output: "Prüfvermerk", customer: "Geschäftsführung",
    });

    const conn = (from, to, label) => ({ id: uid("conn"), from: S[from].id, to: S[to].id, label: label || "" });
    const herkunft = { m2: ["m1"], m3: ["m1"], m4: ["m3"], m5: ["m4"], m6: ["m2", "m4"], m7: ["m6"], m8: ["m7"] };
    Object.keys(herkunft).forEach((k) => { S[k].inputFrom = herkunft[k].map((q) => S[q].id); });

    return {
      id: uid("proj"),
      name: "Monatsabschluss Kreditoren",
      updatedAt: Date.now(),
      lanes,
      steps: Object.values(S),
      connections: [
        conn("m1", "m2"), conn("m1", "m3"), conn("m3", "m4"),
        conn("m4", "m5", "Ja"), conn("m5", "m3", "erneut abstimmen"),
        conn("m4", "m6", "Nein"), conn("m2", "m6"),
        conn("m6", "m7"), conn("m7", "m8"),
      ],
    };
  }

  // Startbestand: drei aufeinander aufbauende Prozesse desselben fiktiven
  // Ingenieurbüros, damit die Prozesskette von Anfang an etwas zu zeigen hat.
  function seedStore() {
    const beschaffung = seedProcurementProject();
    const rechnung = seedProject();
    const abschluss = seedClosingProject();

    const letzterSchritt = (p) => p.steps[p.steps.length - 1];
    const ersterSchritt = (p) => p.steps[0];
    const schrittMit = (p, teil) => p.steps.find((s) => s.name.indexOf(teil) !== -1) || ersterSchritt(p);

    return {
      projects: [beschaffung, rechnung, abschluss],
      currentProjectId: rechnung.id,
      processLinks: [
        {
          id: uid("link"),
          fromProject: beschaffung.id,
          fromStep: letzterSchritt(beschaffung).id,
          toProject: rechnung.id,
          toStep: schrittMit(rechnung, "Finanzsystem anlegen").id,
          artifact: "Verbindliche Bestellung mit Bestellnummer",
          description: "Der Bestellbezug ist Voraussetzung für die Formalprüfung der Rechnung.",
        },
        {
          id: uid("link"),
          fromProject: rechnung.id,
          fromStep: letzterSchritt(rechnung).id,
          toProject: abschluss.id,
          toStep: ersterSchritt(abschluss).id,
          artifact: "Revisionssicher archivierter Rechnungsvorgang",
          description: "Die gebuchten und archivierten Vorgänge sind die Grundlage des Monatsabschlusses.",
        },
      ],
    };
  }

  function blankProject(name) {
    return {
      id: uid("proj"),
      name: name || "Neuer SIPOC-Prozess",
      updatedAt: Date.now(),
      lanes: [],
      steps: [],
      connections: [],
    };
  }

  /* --------------------------------------------------------- State/Storage */

  let store = null;       // { projects: [...], currentProjectId }
  let ui = {
    section: "sipoc",
    stepFilterLane: "",
    showArtifacts: localStorage.getItem("sipocSwimlaneStudio.showArtifacts") === "1",
    zoom: 1,
    theme: localStorage.getItem("sipocSwimlaneStudio.theme") || "auto",
  };
  let fileHandle = null;  // FileSystemFileHandle, falls verknüpft

  // Ergänzt fehlende Felder älterer Datenstände und entfernt Verweise, deren
  // Ziel es nicht mehr gibt — sonst zeigen Ketten ins Leere.
  function normalizeStore(s) {
    if (!s || !Array.isArray(s.projects)) return s;
    if (!Array.isArray(s.processLinks)) s.processLinks = [];
    s.projects.forEach((p) => {
      if (!Array.isArray(p.lanes)) p.lanes = [];
      if (!Array.isArray(p.steps)) p.steps = [];
      if (!Array.isArray(p.connections)) p.connections = [];
      const stepIds = new Set(p.steps.map((st) => st.id));
      p.steps.forEach((st) => {
        st.inputFrom = Array.isArray(st.inputFrom)
          ? st.inputFrom.filter((id) => stepIds.has(id) && id !== st.id)
          : [];
      });
    });
    const projectIds = new Set(s.projects.map((p) => p.id));
    const stepIdsOf = (projectId) => {
      const p = s.projects.find((x) => x.id === projectId);
      return p ? new Set(p.steps.map((st) => st.id)) : new Set();
    };
    s.processLinks = s.processLinks.filter((l) =>
      l && projectIds.has(l.fromProject) && projectIds.has(l.toProject) && l.fromProject !== l.toProject);
    s.processLinks.forEach((l) => {
      if (l.fromStep && !stepIdsOf(l.fromProject).has(l.fromStep)) l.fromStep = "";
      if (l.toStep && !stepIdsOf(l.toProject).has(l.toStep)) l.toStep = "";
    });
    return s;
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.projects) && parsed.projects.length) {
          return normalizeStore(parsed);
        }
      }
    } catch (e) { /* beschädigter Speicher -> weiter zu den Startdaten */ }

    // In einer heruntergeladenen Standalone-Datei kann ein Datenbestand
    // mitgeliefert sein. Er greift nur, solange dieser Browser noch keine
    // eigenen Daten hat, und überschreibt daher nie vorhandene Arbeit.
    const bundled = document.getElementById("bundledData");
    if (bundled && bundled.textContent.trim()) {
      try {
        const parsed = JSON.parse(bundled.textContent);
        if (parsed && Array.isArray(parsed.projects) && parsed.projects.length) return normalizeStore(parsed);
      } catch (e) { /* fehlerhafter Bundle-Inhalt -> Beispielprojekt */ }
    }

    return seedStore();
  }

  const persistLocal = debounce(function () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      setSaveStatus("In diesem Browser gespeichert · " + nowLabel());
    } catch (e) {
      setSaveStatus("Speichern fehlgeschlagen (Speicherplatz?)");
    }
  }, 250);

  const persistFile = debounce(async function () {
    if (!fileHandle) return;
    try {
      const perm = await fileHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") return;
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(store, null, 2));
      await writable.close();
      setSaveStatus("Gespeichert in " + fileHandle.name + " · " + nowLabel());
    } catch (e) {
      setSaveStatus("Datei konnte nicht geschrieben werden");
    }
  }, 400);

  function touch() {
    getProject().updatedAt = Date.now();
    persistLocal();
    persistFile();
  }

  function setSaveStatus(text) {
    const el = document.getElementById("saveStatus");
    if (el) el.textContent = text;
  }

  function getProject() {
    return store.projects.find((p) => p.id === store.currentProjectId) || store.projects[0];
  }

  function getLane(id) {
    return getProject().lanes.find((l) => l.id === id);
  }
  function getStep(id) {
    return getProject().steps.find((s) => s.id === id);
  }

  /* ------------------------------------------------------- IndexedDB (Handle) */

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function tryRestoreFileHandle() {
    if (!("showSaveFilePicker" in window)) return;
    try {
      const handle = await idbGet("projectFile");
      if (!handle) return;
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        fileHandle = handle;
        setSaveStatus("Verknüpft mit " + fileHandle.name);
      }
      // Bei "prompt" warten wir auf eine Nutzeraktion (Klick auf "Datei verknüpfen"),
      // da requestPermission ohne Geste vom Browser blockiert wird.
    } catch (e) { /* handle evtl. nicht mehr gültig */ }
  }

  async function linkFile() {
    if (!("showSaveFilePicker" in window)) {
      showToast("Diese Funktion benötigt Chrome oder Edge. Nutze stattdessen Exportieren/Importieren.", "warn");
      return;
    }
    try {
      // Falls bereits ein Handle existiert, aber nur Berechtigung fehlt: erneut anfragen.
      const existing = await idbGet("projectFile");
      if (existing) {
        const perm = await existing.requestPermission({ mode: "readwrite" });
        if (perm === "granted") {
          fileHandle = existing;
          const file = await fileHandle.getFile();
          const text = await file.text();
          await maybeAdoptFileContents(text);
          setSaveStatus("Verknüpft mit " + fileHandle.name);
          persistFile();
          return;
        }
      }
      const handle = await window.showSaveFilePicker({
        suggestedName: "sipoc-projekte.json",
        types: [{ description: "SIPOC Swimlane Studio Projekte", accept: { "application/json": [".json"] } }],
      });
      fileHandle = handle;
      await idbSet("projectFile", handle);
      try {
        const file = await fileHandle.getFile();
        const text = await file.text();
        if (text && text.trim()) await maybeAdoptFileContents(text);
      } catch (e) { /* neue, leere Datei */ }
      setSaveStatus("Verknüpft mit " + fileHandle.name);
      persistFile();
      showToast("Datei verknüpft — Änderungen werden ab jetzt automatisch gespeichert.");
    } catch (e) {
      if (e && e.name !== "AbortError") showToast("Datei konnte nicht verknüpft werden.", "warn");
    }
  }

  async function maybeAdoptFileContents(text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.projects) && parsed.projects.length) {
        const useFile = confirm(
          "Die verknüpfte Datei enthält bereits " + parsed.projects.length +
          " Projekt(e). Diese anstelle der aktuellen Browser-Daten laden?\n\n" +
          "OK = Datei laden · Abbrechen = aktuelle Daten behalten und in die Datei schreiben"
        );
        if (useFile) {
          store = parsed;
          if (!store.projects.some((p) => p.id === store.currentProjectId)) {
            store.currentProjectId = store.projects[0].id;
          }
          renderAll();
        }
      }
    } catch (e) { /* keine gültige JSON-Datei, ignorieren und überschreiben */ }
  }

  /* ------------------------------------------------------------ Mutations */

  function addLane(data) {
    const p = getProject();
    const color = LANE_COLORS[p.lanes.length % LANE_COLORS.length];
    p.lanes.push({ id: uid("lane"), name: data.name, description: data.description || "", color: data.color || color });
    touch();
  }
  function updateLane(id, data) {
    Object.assign(getLane(id), data);
    touch();
  }
  function deleteLane(id) {
    const p = getProject();
    const used = p.steps.filter((s) => s.lane === id).length;
    if (used > 0) {
      showToast("Akteur wird von " + used + " Prozessschritt(en) verwendet und kann nicht gelöscht werden.", "warn");
      return false;
    }
    p.lanes = p.lanes.filter((l) => l.id !== id);
    touch();
    return true;
  }
  function moveLane(id, dir) {
    const p = getProject();
    const i = p.lanes.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.lanes.length) return;
    [p.lanes[i], p.lanes[j]] = [p.lanes[j], p.lanes[i]];
    touch();
  }

  function addStep(data) {
    const p = getProject();
    p.steps.push({
      id: uid("step"),
      lane: data.lane,
      type: data.type,
      name: data.name,
      supplier: data.supplier || "",
      input: data.input || "",
      output: data.output || "",
      customer: data.customer || "",
      description: data.description || "",
      inputFrom: Array.isArray(data.inputFrom) ? data.inputFrom : [],
    });
    touch();
  }
  function updateStep(id, data) {
    Object.assign(getStep(id), data);
    touch();
  }
  function deleteStep(id) {
    const p = getProject();
    const affected = p.connections.filter((c) => c.from === id || c.to === id).length;
    if (affected > 0 && !confirm(
      "Dieser Schritt ist Teil von " + affected + " Verbindung(en). Schritt und die betroffenen Verbindungen löschen?"
    )) return false;
    p.connections = p.connections.filter((c) => c.from !== id && c.to !== id);
    p.steps = p.steps.filter((s) => s.id !== id);
    // Artefaktherkünfte und Prozessverknüpfungen dürfen nicht ins Leere zeigen.
    p.steps.forEach((s) => { s.inputFrom = (s.inputFrom || []).filter((q) => q !== id); });
    store.processLinks.forEach((l) => {
      if (l.fromStep === id) l.fromStep = "";
      if (l.toStep === id) l.toStep = "";
    });
    touch();
    return true;
  }

  /* ----------------------------------------- Prozesskette (Projektebene) */

  function getProcessLinks() {
    if (!Array.isArray(store.processLinks)) store.processLinks = [];
    return store.processLinks;
  }
  function getProjectById(id) {
    return store.projects.find((p) => p.id === id) || null;
  }
  function addProcessLink(data) {
    if (data.fromProject === data.toProject) {
      showToast("Ein Prozess kann nicht mit sich selbst verkettet werden.", "warn");
      return false;
    }
    const dup = getProcessLinks().find((l) => l.fromProject === data.fromProject && l.toProject === data.toProject);
    if (dup) {
      showToast("Diese Verkettung existiert bereits — bitte die vorhandene bearbeiten.", "warn");
      return false;
    }
    getProcessLinks().push({
      id: uid("link"),
      fromProject: data.fromProject,
      fromStep: data.fromStep || "",
      toProject: data.toProject,
      toStep: data.toStep || "",
      artifact: data.artifact || "",
      description: data.description || "",
    });
    touch();
    return true;
  }
  function updateProcessLink(id, data) {
    const link = getProcessLinks().find((l) => l.id === id);
    if (!link) return false;
    if (data.fromProject === data.toProject) {
      showToast("Ein Prozess kann nicht mit sich selbst verkettet werden.", "warn");
      return false;
    }
    Object.assign(link, data);
    if (link.fromStep && !(getProjectById(link.fromProject) || { steps: [] }).steps.some((s) => s.id === link.fromStep)) link.fromStep = "";
    if (link.toStep && !(getProjectById(link.toProject) || { steps: [] }).steps.some((s) => s.id === link.toStep)) link.toStep = "";
    touch();
    return true;
  }
  function deleteProcessLink(id) {
    store.processLinks = getProcessLinks().filter((l) => l.id !== id);
    touch();
  }

  function addConnection(data) {
    const p = getProject();
    if (data.from === data.to) {
      showToast("Ein Schritt kann nicht mit sich selbst verbunden werden.", "warn");
      return false;
    }
    const dup = p.connections.find((c) => c.from === data.from && c.to === data.to);
    if (dup) {
      showToast("Diese Verbindung existiert bereits — bitte bearbeite die vorhandene.", "warn");
      return false;
    }
    p.connections.push({ id: uid("conn"), from: data.from, to: data.to, label: data.label || "" });
    touch();
    return true;
  }
  function updateConnection(id, data) {
    Object.assign(p_getConn(id), data);
    touch();
  }
  function p_getConn(id) {
    return getProject().connections.find((c) => c.id === id);
  }
  function deleteConnection(id) {
    const p = getProject();
    p.connections = p.connections.filter((c) => c.id !== id);
    touch();
  }

  /* -------------------------------------------------------------- Layout */

  function computeLayout(project) {
    const L = LAYOUT;
    const lanes = project.lanes;
    const steps = project.steps;
    const conns = project.connections.filter((c) => getStep(c.from) && getStep(c.to));

    const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));

    // Rückkanten erkennen (DFS, klassische weiß/grau/schwarz-Markierung),
    // damit Rework-Schleifen die Spaltenberechnung nicht in eine Endlosschleife
    // schicken und stattdessen als "zurücklaufende" Kante gezeichnet werden.
    const adj = new Map(steps.map((s) => [s.id, []]));
    conns.forEach((c) => { if (adj.has(c.from)) adj.get(c.from).push(c); });
    const color = new Map(steps.map((s) => [s.id, 0])); // 0 weiß, 1 grau, 2 schwarz
    const backEdgeIds = new Set();
    function dfs(id) {
      color.set(id, 1);
      for (const c of adj.get(id) || []) {
        const st = color.get(c.to);
        if (st === 1) backEdgeIds.add(c.id);
        else if (st === 0) dfs(c.to);
      }
      color.set(id, 2);
    }
    steps.forEach((s) => { if (color.get(s.id) === 0) dfs(s.id); });

    // Tiefe (Spalte) je Schritt via längstem Pfad über Vorwärtskanten.
    const forwardPreds = new Map(steps.map((s) => [s.id, []]));
    conns.forEach((c) => { if (!backEdgeIds.has(c.id) && forwardPreds.has(c.to)) forwardPreds.get(c.to).push(c.from); });
    const depth = new Map();
    const visiting = new Set();
    function depthOf(id) {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0; // Sicherheitsnetz gegen unerkannte Zyklen
      visiting.add(id);
      const preds = forwardPreds.get(id) || [];
      const d = preds.length ? Math.max(...preds.map(depthOf)) + 1 : 0;
      visiting.delete(id);
      depth.set(id, d);
      return d;
    }
    steps.forEach((s) => depthOf(s.id));

    const maxDepth = steps.length ? Math.max(...steps.map((s) => depth.get(s.id))) : 0;

    // Schritte je (Akteur, Spalte) gruppieren -> Sub-Zeile innerhalb der Lane.
    const cellKey = (laneId, d) => laneId + "|" + d;
    const cells = new Map();
    steps.forEach((s) => {
      const k = cellKey(s.lane, depth.get(s.id));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(s);
    });

    const stepGeom = new Map(); // id -> {x, relY, w, h}
    steps.forEach((s) => {
      const k = cellKey(s.lane, depth.get(s.id));
      const cell = cells.get(k);
      const subRow = cell.indexOf(s);
      const x = L.laneStartSize + depth.get(s.id) * (L.stepWidth + L.colGap) + L.colGap / 2;
      const relY = L.lanePadTop + subRow * (L.stepHeight + L.rowGap);
      stepGeom.set(s.id, { x, relY, w: L.stepWidth, h: L.stepHeight, subRow, depth: depth.get(s.id) });
    });

    // Lane-Höhen aus maximaler Stapelung innerhalb der Lane ableiten.
    const laneMaxStack = new Map(lanes.map((l) => [l.id, 1]));
    cells.forEach((arr, key) => {
      const laneId = key.slice(0, key.lastIndexOf("|"));
      laneMaxStack.set(laneId, Math.max(laneMaxStack.get(laneId) || 1, arr.length));
    });

    let cursorY = 0;
    const laneGeom = lanes.map((l) => {
      const stack = Math.max(1, laneMaxStack.get(l.id) || 1);
      const height = L.lanePadTop + stack * L.stepHeight + (stack - 1) * L.rowGap + L.lanePadBottom;
      const g = { id: l.id, name: l.name, color: l.color, y: cursorY, height };
      cursorY += height;
      return g;
    });
    const laneGeomById = new Map(laneGeom.map((g) => [g.id, g]));

    const width = L.laneStartSize + (maxDepth + 1) * (L.stepWidth + L.colGap) + L.colGap / 2;
    const height = cursorY;

    const stepsOut = steps.map((s) => {
      const g = stepGeom.get(s.id);
      const laneG = laneGeomById.get(s.lane);
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        laneId: s.lane,
        x: g.x,
        relY: g.relY,
        y: (laneG ? laneG.y : 0) + g.relY,
        w: g.w,
        h: g.h,
        depth: g.depth,
      };
    });
    const stepById = new Map(stepsOut.map((s) => [s.id, s]));

    // Ist beim Zielschritt hinterlegt, dass sein Input aus dem Output dieses
    // Quellschritts stammt, kann die Kante das Artefakt tragen. Ein eigenes
    // Label (Ja/Nein) hat Vorrang, sonst würde die Verzweigung unlesbar.
    const stepDataById = new Map(steps.map((s) => [s.id, s]));
    const connsOut = conns.map((c) => {
      const target = stepDataById.get(c.to);
      const source = stepDataById.get(c.from);
      const carriesArtifact = !!(target && (target.inputFrom || []).indexOf(c.from) !== -1 && source && source.output);
      return {
        id: c.id,
        from: c.from,
        to: c.to,
        label: c.label,
        artifact: carriesArtifact ? source.output : "",
        isBackEdge: backEdgeIds.has(c.id),
      };
    });

    return { lanes: laneGeom, steps: stepsOut, stepById, connections: connsOut, width, height, maxDepth };
  }

  /* -------------------------------------------------------- SVG Rendering */

  function shapePath(type, x, y, w, h) {
    if (type === "trigger") {
      const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }
    if (type === "decision") {
      const cx = x + w / 2, cy = y + h / 2;
      return `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`;
    }
    if (type === "start" || type === "end") {
      const r = h / 2;
      return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    }
    const r = 12;
    return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
  }

  function edgeRoute(fromBox, toBox, isBackEdge, laneCount, laneHeight, dedupeIndex) {
    // Orthogonale Achsknicke; Rückkanten (Rework-Schleifen) laufen unterhalb aller Lanes.
    const pad = 4;
    if (!isBackEdge && toBox.depth > fromBox.depth) {
      const sx = fromBox.x + fromBox.w, sy = fromBox.y + fromBox.h / 2;
      const tx = toBox.x, ty = toBox.y + toBox.h / 2;
      const midX = sx + (tx - sx) / 2;
      if (Math.abs(sy - ty) < 1) return `M ${sx} ${sy} L ${tx} ${ty}`;
      return `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
    }
    // Rückkante oder gleiche Spalte: Bogen unterhalb des Quellschritts nach unten.
    const sx = fromBox.x + fromBox.w / 2, sy = fromBox.y + fromBox.h;
    const tx = toBox.x + toBox.w / 2, ty = toBox.y + toBox.h;
    const dropY = Math.max(sy, ty) + 26 + dedupeIndex * 16;
    return `M ${sx} ${sy} L ${sx} ${dropY} L ${tx} ${dropY} L ${tx} ${ty}`;
  }

  function renderDiagramSVG(layout) {
    const W = layout.width, H = layout.height;
    const parts = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">`
    );
    parts.push(`<defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="var(--text-secondary)"></path>
      </marker>
    </defs>`);

    // Lane-Hintergründe + Beschriftung
    layout.lanes.forEach((l, i) => {
      const bg = i % 2 === 0 ? "var(--bg-card)" : "var(--bg-subtle)";
      parts.push(`<rect x="0" y="${l.y}" width="${W}" height="${l.height}" fill="${bg}"></rect>`);
      parts.push(`<rect x="0" y="${l.y}" width="${LAYOUT.laneStartSize}" height="${l.height}" fill="${escapeXml(l.color)}" opacity="0.16"></rect>`);
      parts.push(`<line x1="0" y1="${l.y}" x2="${W}" y2="${l.y}" stroke="var(--separator)" stroke-width="1"></line>`);
      parts.push(`<line x1="${LAYOUT.laneStartSize}" y1="${l.y}" x2="${LAYOUT.laneStartSize}" y2="${l.y + l.height}" stroke="${escapeXml(l.color)}" stroke-width="3"></line>`);
      const cy = l.y + l.height / 2;
      parts.push(
        `<text class="lane-label-text" x="16" y="${cy}" font-size="12" transform="rotate(-90 16 ${cy})" text-anchor="middle">${escapeXml(l.name)}</text>`
      );
    });
    parts.push(`<line x1="0" y1="${layout.height}" x2="${W}" y2="${layout.height}" stroke="var(--separator)" stroke-width="1"></line>`);

    // Kanten zuerst (liegen unter den Knoten)
    const pairCount = new Map();
    layout.connections.forEach((c) => {
      const from = layout.stepById.get(c.from), to = layout.stepById.get(c.to);
      if (!from || !to) return;
      const key = c.from + ">" + c.to;
      const dedupeIndex = pairCount.get(key) || 0;
      pairCount.set(key, dedupeIndex + 1);
      const d = edgeRoute(from, to, c.isBackEdge, layout.lanes.length, LAYOUT.stepHeight, dedupeIndex);
      const strokeColor = c.isBackEdge ? "var(--orange)" : "var(--text-tertiary)";
      parts.push(`<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="1.6" marker-end="url(#arrow)" ${c.isBackEdge ? 'stroke-dasharray="5,4"' : ""}></path>`);
      const edgeLabel = c.label || (ui.showArtifacts && c.artifact
        ? (c.artifact.length > 34 ? c.artifact.slice(0, 33).trim() + "…" : c.artifact)
        : "");
      if (edgeLabel) {
        // Label-Position: Mittelpunkt der Route grob am ersten horizontalen Segment
        const lx = c.isBackEdge ? (from.x + from.w / 2 + to.x + to.w / 2) / 2 : (from.x + from.w + to.x) / 2;
        const ly = c.isBackEdge ? Math.max(from.y + from.h, to.y + to.h) + 26 + dedupeIndex * 16 : (from.y + from.h / 2 + to.y + to.h / 2) / 2;
        const lw = Math.max(28, edgeLabel.length * 6.4 + 14);
        const isArtifact = !c.label;
        parts.push(`<rect x="${lx - lw / 2}" y="${ly - 10}" width="${lw}" height="20" rx="10" fill="var(--bg-elevated)" stroke="${isArtifact ? "var(--accent)" : "var(--separator)"}"></rect>`);
        parts.push(`<text x="${lx}" y="${ly + 4}" font-size="10.5" font-weight="600" text-anchor="middle" fill="${isArtifact ? "var(--accent)" : "var(--text-secondary)"}">${escapeXml(edgeLabel)}</text>`);
      }
    });

    // Knoten
    layout.steps.forEach((s) => {
      const meta = STEP_TYPES[s.type] || STEP_TYPES.task;
      parts.push(`<path d="${shapePath(s.type, s.x, s.y, s.w, s.h)}" fill="${meta.color}" fill-opacity="0.14" stroke="${meta.color}" stroke-width="1.8"></path>`);
      parts.push(`<foreignObject x="${s.x + 8}" y="${s.y + 6}" width="${s.w - 16}" height="${s.h - 12}">`);
      parts.push(
        `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;">` +
          `<div class="step-node-label" style="color:var(--text-primary);">${escapeHtml(s.name)}</div>` +
        `</div>`
      );
      parts.push(`</foreignObject>`);
    });

    parts.push(`</svg>`);
    return parts.join("");
  }

  /* ---------------------------------------------------------- draw.io XML */

  function buildDrawioXml(project, layout) {
    const cells = [];
    cells.push(`<mxCell id="0" />`);
    cells.push(`<mxCell id="1" parent="0" />`);

    layout.lanes.forEach((l) => {
      cells.push(
        `<mxCell id="${l.id}" value="${escapeXml(l.name)}" style="swimlane;horizontal=0;whiteSpace=wrap;html=1;startSize=${LAYOUT.laneStartSize};fillColor=${l.color}22;strokeColor=${l.color};swimlaneFillColor=#ffffff;" vertex="1" parent="1">` +
          `<mxGeometry x="0" y="${Math.round(l.y)}" width="${Math.round(layout.width)}" height="${Math.round(l.height)}" as="geometry" />` +
        `</mxCell>`
      );
    });

    layout.steps.forEach((s) => {
      const meta = STEP_TYPES[s.type] || STEP_TYPES.task;
      let style;
      if (s.type === "trigger") {
        style = "ellipse;whiteSpace=wrap;html=1;fillColor=#f6ecfd;strokeColor=#af52de;";
      } else if (s.type === "decision") {
        style = "rhombus;whiteSpace=wrap;html=1;fillColor=#fff4e5;strokeColor=#ff9500;";
      } else if (s.type === "start" || s.type === "end") {
        style = "terminator;whiteSpace=wrap;html=1;fillColor=" + (s.type === "start" ? "#e8f8ec" : "#ffece8") + ";strokeColor=" + (s.type === "start" ? "#34c759" : "#ff3b30") + ";";
      } else {
        style = "rounded=1;arcSize=18;whiteSpace=wrap;html=1;fillColor=#eaf3ff;strokeColor=#007aff;";
      }
      cells.push(
        `<mxCell id="${s.id}" value="${escapeXml(s.name)}" style="${style}" vertex="1" parent="${s.laneId}">` +
          `<mxGeometry x="${Math.round(s.x)}" y="${Math.round(s.relY)}" width="${Math.round(s.w)}" height="${Math.round(s.h)}" as="geometry" />` +
        `</mxCell>`
      );
    });

    layout.connections.forEach((c) => {
      const style = c.isBackEdge
        ? "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#ff9500;dashed=1;exitX=0.5;exitY=1;entryX=0.5;entryY=1;"
        : "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#8e8e93;";
      const value = c.label || (ui.showArtifacts && c.artifact ? c.artifact : "");
      cells.push(
        `<mxCell id="${c.id}" value="${escapeXml(value)}" style="${style}" edge="1" parent="1" source="${c.from}" target="${c.to}">` +
          `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`
      );
    });

    const diagramName = escapeXml(project.name || "Swimlane");
    return (
      `<mxfile host="sipoc-swimlane-studio" modified="${new Date().toISOString()}" agent="SIPOC Swimlane Studio" version="21.6.5" type="device">\n` +
      `  <diagram id="${uid("diag")}" name="${diagramName}">\n` +
      `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.round(layout.width) + 40}" pageHeight="${Math.round(layout.height) + 40}" math="0" shadow="0">\n` +
      `      <root>\n        ${cells.join("\n        ")}\n      </root>\n` +
      `    </mxGraphModel>\n  </diagram>\n</mxfile>\n`
    );
  }

  /* =====================================================================
     Import vom KI-Agenten
     Eigenes, bewusst schlichtes Austauschformat: Der Agent vergibt sprechende
     Schlüssel statt IDs und referenziert Akteure über ihren Namen. Die
     Prüfung sammelt alle Beanstandungen auf einmal und formuliert sie als
     Arbeitsauftrag zurück an den Agenten.
     ===================================================================== */

  const AGENT_FORMAT_ID = "sipoc-swimlane-studio/agent-import";
  const AGENT_TYPES = ["trigger", "start", "task", "decision", "end"];

  // Häufige Abweichungen, die verstanden, aber zurückgemeldet werden.
  const AGENT_TYPE_ALIASES = {
    ausloeser: "trigger", "auslöser": "trigger", ereignis: "trigger", event: "trigger", signal: "trigger",
    beginn: "start", anfang: "start", startpunkt: "start",
    aufgabe: "task", schritt: "task", taetigkeit: "task", tätigkeit: "task", prozessschritt: "task", activity: "task", process: "task",
    entscheidung: "decision", verzweigung: "decision", pruefung: "decision", prüfung: "decision", gateway: "decision",
    ende: "end", endpunkt: "end", abschluss: "end", stop: "end", terminator: "end",
  };

  const AGENT_PROMPT = [
    "Du erzeugst Prozessdaten für die Anwendung „SIPOC Swimlane Studio“. Aus deiner Antwort wird",
    "automatisch ein SIPOC-Katalog und ein Swimlane-Diagramm erzeugt. Halte dich exakt an das folgende Format.",
    "",
    "## Ausgaberegeln",
    "1. Gib ausschließlich ein einziges JSON-Objekt aus. Kein einleitender Satz, keine Erklärung, keine Nachbemerkung.",
    "2. Keine Markdown-Codeblöcke (keine ```-Zeilen), keine Kommentare, keine abschließenden Kommas.",
    "3. Nur doppelte Anführungszeichen. Alle Werte sind einzeilige Zeichenketten ohne Zeilenumbrüche.",
    "4. Schreibe die Inhalte in der Sprache des Prozesses (in der Regel Deutsch), die Feldnamen bleiben englisch wie unten angegeben.",
    "",
    "## Grundgerüst",
    "{",
    '  "format": "' + AGENT_FORMAT_ID + '",',
    '  "version": 1,',
    '  "project": { "name": "…" },',
    '  "lanes": [ … ],',
    '  "steps": [ … ],',
    '  "connections": [ … ]',
    "}",
    "",
    "## Felder im Einzelnen",
    "",
    "project.name  (Pflicht, Text 3–80 Zeichen)  Sprechender Name des Prozesses, z. B. „Kreditorenrechnungsprüfung“.",
    "",
    "lanes  (Pflicht, 1–12 Einträge)  Die Swimlanes: beteiligte Rollen, Abteilungen, Systeme oder externe Partner.",
    "  - name         Pflicht, eindeutig, kurz (z. B. „Kreditorenbuchhaltung“).",
    "  - description  Optional, ein Satz zur Zuständigkeit.",
    "  Reihenfolge = Reihenfolge der Zeilen im Diagramm. Beginne mit der auslösenden Seite (oft extern).",
    "",
    "steps  (Pflicht, 1–60 Einträge)  Die Prozessschritte in SIPOC-Sicht.",
    "  - key          Pflicht, eindeutig, kurz, nur Buchstaben/Ziffern/Bindestrich/Unterstrich (z. B. „rechnung_pruefen“).",
    "                 Der Schlüssel dient nur zum Verknüpfen in connections und taucht in der Oberfläche nicht auf.",
    "  - name         Pflicht, die Tätigkeit als Verb-Formulierung (z. B. „Rechnung sachlich prüfen“).",
    "                 Bei type „decision“ formuliere eine Ja/Nein-Frage (z. B. „Betrag über 5.000 €?“).",
    "  - lane         Pflicht, muss ZEICHENGENAU einem der oben definierten lanes[].name entsprechen.",
    '  - type         Pflicht, genau einer dieser fünf kleingeschriebenen Werte:',
    '                 "trigger"  = auslösendes Ereignis (Zeitpunkt, Eingang, Signal), das den Prozess anstößt,',
    '                 "start"    = erster aktiv ausgeführter Schritt,',
    '                 "task"     = Arbeitsschritt,',
    '                 "decision" = Verzweigung mit Ja/Nein-Frage,',
    '                 "end"      = Abschluss eines Ablaufwegs.',
    "  - supplier     Wer den Input dieses Schritts liefert (Rolle, System oder Partner).",
    "  - input        Was in den Schritt hineingeht (Beleg, Datensatz, Information).",
    "  - output       Was der Schritt erzeugt.",
    "  - customer     Wer den Output empfängt bzw. weiterverarbeitet.",
    "  - description  Optional, ein Satz zur fachlichen Erläuterung.",
    "  - inputFrom    Optional, Liste von keys anderer Schritte, deren Output diesen Input speist.",
    "                 Beispiel: \"inputFrom\": [\"antrag_pruefen\"] bedeutet: Der Input dieses Schritts ist der",
    "                 Output von \"antrag_pruefen\". Mehrere Herkünfte sind erlaubt, etwa wenn zwei",
    "                 Freigabewege zusammenlaufen. Daraus entsteht die Artefaktkette der SIPOC-Übersicht.",
    "  Die vier Felder supplier, input, output und customer sind der Kern von SIPOC — fülle sie für jeden Schritt.",
    "",
    "connections  (Pflicht, mindestens 1 Eintrag)  Der Ablauf zwischen den Schritten.",
    "  - from   Pflicht, ein key aus steps.",
    "  - to     Pflicht, ein anderer key aus steps.",
    '  - label  Bei Verzweigungen Pflicht (z. B. "Ja", "Nein", "über 5.000 €"), sonst weglassen.',
    "",
    "## Inhaltliche Regeln",
    '- Der Ablauf beginnt mit genau einem Schritt vom type "trigger" oder "start"; mindestens ein Schritt hat type "end".',
    '- Nutze "trigger" für den auslösenden Umstand (z. B. "Rechnung geht ein", "Monatsletzter erreicht"),',
    '  wenn der Prozess durch ein Ereignis angestoßen wird und nicht durch eine eigene Tätigkeit.',
    '- Jeder Schritt mit type "decision" hat mindestens zwei ausgehende connections, jede mit einem label.',
    '- Jeder Schritt außer dem "start"-Schritt ist über mindestens eine Verbindung erreichbar.',
    "- Rückschleifen (Nacharbeit, erneute Prüfung) sind ausdrücklich erlaubt und erwünscht, wo sie fachlich vorkommen.",
    "- Ein Schritt verweist nie auf sich selbst.",
    "- Wechselt die Zuständigkeit, wechselt auch die lane — daraus entstehen die Swimlanes.",
    "- Setze inputFrom überall dort, wo ein Schritt auf dem Ergebnis eines früheren Schritts aufsetzt;",
    "  in aller Regel entspricht das den eingehenden connections.",
    "",
    "## Vollständiges Beispiel",
    "{",
    '  "format": "' + AGENT_FORMAT_ID + '",',
    '  "version": 1,',
    '  "project": { "name": "Urlaubsantrag bearbeiten" },',
    '  "lanes": [',
    '    { "name": "Mitarbeitende", "description": "Antragstellende Person" },',
    '    { "name": "Führungskraft", "description": "Fachliche Genehmigung" },',
    '    { "name": "Personalabteilung", "description": "Verbuchung im Zeitwirtschaftssystem" }',
    "  ],",
    '  "steps": [',
    '    { "key": "antrag_stellen", "name": "Urlaubsantrag stellen", "lane": "Mitarbeitende", "type": "start",',
    '      "supplier": "Mitarbeitende", "input": "Urlaubswunsch, Resturlaubskonto", "output": "Erfasster Urlaubsantrag", "customer": "Führungskraft" },',
    '    { "key": "antrag_pruefen", "name": "Antrag auf Vertretung und Auslastung prüfen", "lane": "Führungskraft", "type": "task",',
    '      "supplier": "Mitarbeitende", "input": "Erfasster Urlaubsantrag", "output": "Prüfergebnis", "customer": "Führungskraft",',
    '      "inputFrom": ["antrag_stellen"] },',
    '    { "key": "genehmigt", "name": "Antrag genehmigt?", "lane": "Führungskraft", "type": "decision",',
    '      "supplier": "Führungskraft", "input": "Prüfergebnis", "output": "Entscheidung", "customer": "Personalabteilung",',
    '      "inputFrom": ["antrag_pruefen"] },',
    '    { "key": "verbuchen", "name": "Urlaub im Zeitkonto verbuchen", "lane": "Personalabteilung", "type": "task",',
    '      "supplier": "Führungskraft", "input": "Genehmigter Antrag", "output": "Aktualisiertes Zeitkonto", "customer": "Mitarbeitende",',
    '      "inputFrom": ["genehmigt"] },',
    '    { "key": "abgelehnt", "name": "Ablehnung mitteilen", "lane": "Führungskraft", "type": "end",',
    '      "supplier": "Führungskraft", "input": "Ablehnungsentscheidung", "output": "Begründete Absage", "customer": "Mitarbeitende",',
    '      "inputFrom": ["genehmigt"] },',
    '    { "key": "bestaetigen", "name": "Genehmigung bestätigen", "lane": "Personalabteilung", "type": "end",',
    '      "supplier": "Personalabteilung", "input": "Aktualisiertes Zeitkonto", "output": "Bestätigung im Self-Service", "customer": "Mitarbeitende",',
    '      "inputFrom": ["verbuchen"] }',
    "  ],",
    '  "connections": [',
    '    { "from": "antrag_stellen", "to": "antrag_pruefen" },',
    '    { "from": "antrag_pruefen", "to": "genehmigt" },',
    '    { "from": "genehmigt", "to": "verbuchen", "label": "Ja" },',
    '    { "from": "genehmigt", "to": "abgelehnt", "label": "Nein" },',
    '    { "from": "verbuchen", "to": "bestaetigen" }',
    "  ]",
    "}",
    "",
    "## Wenn du eine Fehlermeldung zurückbekommst",
    "Die Anwendung meldet Beanstandungen mit genauer Fundstelle (z. B. steps[3].type). Korrigiere ausschließlich",
    "die genannten Punkte und gib danach das vollständige JSON erneut aus — nicht nur den geänderten Ausschnitt.",
  ].join("\n");

  /* ------------------------------------------------- Prüfung des Agenten-JSON */

  function issue(path, message, fix) {
    return { path, message, fix };
  }

  function isText(v) {
    return typeof v === "string" && v.trim() !== "";
  }

  function typeName(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "Liste";
    if (typeof v === "string") return "Text";
    if (typeof v === "number") return "Zahl";
    if (typeof v === "boolean") return "Wahrheitswert";
    if (typeof v === "object") return "Objekt";
    return typeof v;
  }

  // Nimmt den Rohtext aus dem Eingabefeld und liefert Beanstandungen sowie —
  // sofern nichts Blockierendes gefunden wurde — das fertige Projekt.
  function checkAgentPayload(rawInput) {
    const errors = [];
    const notes = [];
    let text = String(rawInput == null ? "" : rawInput).trim();

    if (!text) {
      errors.push(issue("(Eingabe)", "Es wurde kein Text eingefügt.",
        "Füge die vollständige JSON-Antwort des Agenten in das Feld ein."));
      return { ok: false, errors, notes, project: null };
    }

    // Toleranz gegenüber dem häufigsten Agentenfehler: Markdown-Codeblock.
    const fence = text.match(/^\s*```[a-zA-Z]*\s*([\s\S]*?)\s*```\s*$/);
    if (fence) {
      text = fence[1].trim();
      notes.push(issue("(Ausgabeform)", "Die Antwort war in einen Markdown-Codeblock eingefasst; er wurde entfernt.",
        "Gib das JSON künftig ohne umschließende ```-Zeilen aus."));
    }
    // Ebenfalls häufig: erklärender Text vor oder nach dem Objekt.
    if (!text.startsWith("{")) {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first !== -1 && last > first) {
        text = text.slice(first, last + 1);
        notes.push(issue("(Ausgabeform)", "Vor dem JSON stand zusätzlicher Text; er wurde ignoriert.",
          "Gib ausschließlich das JSON-Objekt aus, ohne einleitende oder abschließende Sätze."));
      }
    }

    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      const pos = /position (\d+)/i.exec(e.message);
      let where = "";
      if (pos) {
        const index = Number(pos[1]);
        const upto = text.slice(0, index);
        const line = upto.split("\n").length;
        const column = index - upto.lastIndexOf("\n");
        where = " (Zeile " + line + ", Spalte " + column + ": …" +
          text.slice(Math.max(0, index - 40), index + 40).replace(/\n/g, "⏎") + "…)";
      }
      errors.push(issue("(JSON)", "Die Antwort ist kein gültiges JSON: " + e.message + where,
        "Häufige Ursachen: ein Komma hinter dem letzten Element einer Liste, einfache statt doppelte " +
        "Anführungszeichen, ein fehlendes Komma zwischen zwei Objekten oder ein Zeilenumbruch innerhalb eines Textwertes. " +
        "Prüfe die genannte Stelle und gib das vollständige JSON erneut aus."));
      return { ok: false, errors, notes, project: null };
    }

    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      errors.push(issue("(Wurzel)", "Die Antwort ist " + (Array.isArray(doc) ? "eine Liste" : "kein Objekt") + ".",
        'Die Antwort muss ein einzelnes Objekt sein, das mit "{" beginnt und die Schlüssel project, lanes, steps und connections enthält.'));
      return { ok: false, errors, notes, project: null };
    }

    if (doc.format !== AGENT_FORMAT_ID) {
      notes.push(issue("format", "Das Feld format fehlt oder weicht ab (gefunden: " +
        (doc.format === undefined ? "nicht vorhanden" : JSON.stringify(doc.format)) + ").",
        'Setze "format": "' + AGENT_FORMAT_ID + '".'));
    }

    /* ---- project ---- */
    let projectName = "Importierter Prozess";
    if (doc.project === undefined) {
      errors.push(issue("project", "Der Abschnitt project fehlt.",
        'Ergänze "project": { "name": "Name des Prozesses" }.'));
    } else if (typeof doc.project !== "object" || doc.project === null || Array.isArray(doc.project)) {
      errors.push(issue("project", "project ist " + typeName(doc.project) + ", erwartet wird ein Objekt.",
        'Schreibe "project": { "name": "Name des Prozesses" }.'));
    } else if (!isText(doc.project.name)) {
      errors.push(issue("project.name", "Der Prozessname fehlt oder ist leer.",
        'Ergänze einen sprechenden Namen, z. B. "project": { "name": "Kreditorenrechnungsprüfung" }.'));
    } else {
      projectName = doc.project.name.trim();
      if (projectName.length > 80) {
        notes.push(issue("project.name", "Der Prozessname ist mit " + projectName.length + " Zeichen sehr lang.",
          "Kürze ihn auf höchstens 80 Zeichen."));
      }
    }

    /* ---- lanes ---- */
    const laneByName = new Map();
    if (doc.lanes === undefined) {
      errors.push(issue("lanes", "Der Abschnitt lanes fehlt.",
        'Ergänze "lanes" als Liste der beteiligten Rollen, z. B. [ { "name": "Fachbereich" } ].'));
    } else if (!Array.isArray(doc.lanes)) {
      errors.push(issue("lanes", "lanes ist " + typeName(doc.lanes) + ", erwartet wird eine Liste.",
        'Schreibe "lanes": [ { "name": "…" } ].'));
    } else if (doc.lanes.length === 0) {
      errors.push(issue("lanes", "lanes ist leer.",
        "Gib mindestens einen Akteur an — jede Swimlane des Diagramms entspricht einem Eintrag."));
    } else {
      doc.lanes.forEach((lane, i) => {
        const at = "lanes[" + i + "]";
        if (typeof lane !== "object" || lane === null || Array.isArray(lane)) {
          errors.push(issue(at, "Eintrag ist " + typeName(lane) + ", erwartet wird ein Objekt.",
            'Schreibe { "name": "…", "description": "…" }.'));
          return;
        }
        if (!isText(lane.name)) {
          errors.push(issue(at + ".name", "Der Name des Akteurs fehlt oder ist leer.",
            "Jeder Akteur braucht einen eindeutigen Namen, z. B. \"Kreditorenbuchhaltung\"."));
          return;
        }
        const name = lane.name.trim();
        if (laneByName.has(name)) {
          errors.push(issue(at + ".name", "Der Akteur \"" + name + "\" ist mehrfach vorhanden.",
            "Vergib je Akteur genau einen Eintrag und verweise aus mehreren Schritten auf denselben Namen."));
          return;
        }
        if (lane.description !== undefined && typeof lane.description !== "string") {
          notes.push(issue(at + ".description", "description ist " + typeName(lane.description) + " statt Text.",
            "Gib eine einzeilige Beschreibung als Text an oder lasse das Feld weg."));
        }
        laneByName.set(name, {
          id: uid("lane"),
          name,
          description: typeof lane.description === "string" ? lane.description.trim() : "",
          color: LANE_COLORS[laneByName.size % LANE_COLORS.length],
        });
      });
      if (doc.lanes.length > 12) {
        notes.push(issue("lanes", "Es sind " + doc.lanes.length + " Akteure angegeben.",
          "Mehr als zwölf Zeilen werden im Diagramm unübersichtlich; fasse verwandte Rollen zusammen."));
      }
    }

    /* ---- steps ---- */
    const stepByKey = new Map();
    // Getrennt geführt, damit doppelte Schlüssel auch dann auffallen, wenn der
    // zuerst vergebene Schritt wegen eines anderen Mangels verworfen wurde.
    const seenKeys = new Set();
    if (doc.steps === undefined) {
      errors.push(issue("steps", "Der Abschnitt steps fehlt.",
        'Ergänze "steps" als Liste der Prozessschritte.'));
    } else if (!Array.isArray(doc.steps)) {
      errors.push(issue("steps", "steps ist " + typeName(doc.steps) + ", erwartet wird eine Liste.",
        'Schreibe "steps": [ { "key": "…", "name": "…", "lane": "…", "type": "task", … } ].'));
    } else if (doc.steps.length === 0) {
      errors.push(issue("steps", "steps ist leer.", "Gib mindestens einen Prozessschritt an."));
    } else {
      doc.steps.forEach((step, i) => {
        const at = "steps[" + i + "]";
        if (typeof step !== "object" || step === null || Array.isArray(step)) {
          errors.push(issue(at, "Eintrag ist " + typeName(step) + ", erwartet wird ein Objekt.",
            'Schreibe { "key": "…", "name": "…", "lane": "…", "type": "task" }.'));
          return;
        }

        const label = isText(step.name) ? ' ("' + step.name.trim() + '")' : "";
        let key = null;
        if (!isText(step.key)) {
          errors.push(issue(at + ".key", "Der Schlüssel key fehlt oder ist leer" + label + ".",
            "Vergib einen kurzen, eindeutigen Schlüssel wie \"rechnung_pruefen\"; connections verweisen darauf."));
        } else {
          key = step.key.trim();
          if (seenKeys.has(key)) {
            errors.push(issue(at + ".key", "Der Schlüssel \"" + key + "\" wird mehrfach verwendet.",
              "Jeder Schritt braucht einen eigenen key; ergänze z. B. eine Nummer."));
            key = null;
          } else {
            seenKeys.add(key);
            if (!/^[A-Za-z0-9_-]+$/.test(key)) {
              notes.push(issue(at + ".key", "Der Schlüssel \"" + key + "\" enthält Sonderzeichen oder Leerzeichen.",
                "Verwende nur Buchstaben, Ziffern, Bindestrich und Unterstrich."));
            }
          }
        }

        if (!isText(step.name)) {
          errors.push(issue(at + ".name", "Der Name des Prozessschritts fehlt oder ist leer.",
            "Benenne die Tätigkeit, z. B. \"Rechnung sachlich prüfen\"."));
        }

        // Typ prüfen, dabei bekannte Abweichungen verstehen und melden.
        let type = null;
        if (step.type === undefined || step.type === null || step.type === "") {
          errors.push(issue(at + ".type", "Das Feld type fehlt" + label + ".",
            'Setze genau einen der Werte "start", "task", "decision" oder "end".'));
        } else if (typeof step.type !== "string") {
          errors.push(issue(at + ".type", "type ist " + typeName(step.type) + " statt Text.",
            'Setze "type": "task" (bzw. start, decision, end).'));
        } else {
          const raw = step.type.trim();
          const lower = raw.toLowerCase();
          if (AGENT_TYPES.indexOf(lower) !== -1) {
            type = lower;
            if (raw !== lower) {
              notes.push(issue(at + ".type", "type war \"" + raw + "\" geschrieben.",
                "Schreibe den Wert kleingeschrieben: \"" + lower + "\"."));
            }
          } else if (AGENT_TYPE_ALIASES[lower]) {
            type = AGENT_TYPE_ALIASES[lower];
            notes.push(issue(at + ".type", "type war \"" + raw + "\"; das wurde als \"" + type + "\" gewertet.",
              'Verwende ausschließlich die vier englischen Werte "start", "task", "decision", "end".'));
          } else {
            errors.push(issue(at + ".type", "Ungültiger Wert \"" + raw + "\"" + label + ".",
              'Erlaubt sind genau: "start", "task", "decision", "end". Wähle den passenden Wert.'));
          }
        }

        let laneRef = null;
        if (!isText(step.lane)) {
          errors.push(issue(at + ".lane", "Die Zuordnung zu einem Akteur fehlt" + label + ".",
            "Setze lane auf einen der unter lanes definierten Namen."));
        } else {
          const laneName = step.lane.trim();
          if (laneByName.has(laneName)) {
            laneRef = laneByName.get(laneName);
          } else {
            const known = Array.from(laneByName.keys());
            const close = known.find((n) => n.toLowerCase() === laneName.toLowerCase());
            if (close) {
              laneRef = laneByName.get(close);
              notes.push(issue(at + ".lane", "Der Akteur \"" + laneName + "\" wich in der Schreibweise ab (verwendet: \"" + close + "\").",
                "Schreibe lane zeichengenau wie in lanes[].name."));
            } else {
              errors.push(issue(at + ".lane", "Der Akteur \"" + laneName + "\" ist unter lanes nicht definiert.",
                "Definierte Akteure: " + (known.length ? known.map((n) => '"' + n + '"').join(", ") : "(keine)") +
                ". Ergänze den Akteur in lanes oder korrigiere die Schreibweise."));
            }
          }
        }

        ["supplier", "input", "output", "customer", "description"].forEach((f) => {
          if (step[f] !== undefined && typeof step[f] !== "string") {
            notes.push(issue(at + "." + f, f + " ist " + typeName(step[f]) + " statt Text.",
              "Gib den Wert als einzeilige Zeichenkette an."));
          }
        });

        const unknown = Object.keys(step).filter((k) =>
          ["key", "name", "lane", "type", "supplier", "input", "output", "customer", "description", "inputFrom"].indexOf(k) === -1);
        if (unknown.length) {
          notes.push(issue(at, "Unbekannte Felder: " + unknown.join(", ") + ".",
            "Diese Felder werden ignoriert; lasse sie weg."));
        }

        if (key && type && laneRef) {
          const text_ = (v) => (typeof v === "string" ? v.trim() : "");
          stepByKey.set(key, {
            id: uid("step"),
            key,
            inputFromKeys: Array.isArray(step.inputFrom) ? step.inputFrom : (step.inputFrom === undefined ? [] : null),
            inputFromRaw: step.inputFrom,
            lane: laneRef.id,
            type,
            name: isText(step.name) ? step.name.trim() : "(ohne Namen)",
            supplier: text_(step.supplier),
            input: text_(step.input),
            output: text_(step.output),
            customer: text_(step.customer),
            description: text_(step.description),
          });
        }
      });
    }

    /* ---- Artefaktherkunft (inputFrom) ----
       Erst nach allen Schritten auflösbar, weil ein Schritt auch auf einen
       weiter unten stehenden Schlüssel verweisen darf. */
    stepByKey.forEach((entry, key) => {
      const at = "steps (" + key + ").inputFrom";
      if (entry.inputFromKeys === null) {
        errors.push(issue(at, "inputFrom ist " + typeName(entry.inputFromRaw) + ", erwartet wird eine Liste von Schlüsseln.",
          'Schreibe "inputFrom": ["schluessel_a", "schluessel_b"] oder lasse das Feld weg.'));
        entry.inputFrom = [];
        return;
      }
      const resolved = [];
      entry.inputFromKeys.forEach((raw) => {
        if (!isText(raw)) {
          errors.push(issue(at, "Ein Eintrag in inputFrom ist " + typeName(raw) + " statt eines Schlüssels.",
            "Gib die keys der Schritte als Text an."));
          return;
        }
        const ref = raw.trim();
        if (ref === key) {
          errors.push(issue(at, "Der Schritt verweist über inputFrom auf sich selbst.",
            "Ein Schritt kann seinen eigenen Output nicht als Input beziehen; entferne den Eintrag."));
          return;
        }
        const target = stepByKey.get(ref);
        if (!target) {
          if (!seenKeys.has(ref)) {
            errors.push(issue(at, "Der Schlüssel \"" + ref + "\" kommt in steps nicht vor.",
              "Vorhandene Schlüssel: " + (Array.from(seenKeys).map((k) => '"' + k + '"').join(", ") || "(keine)") +
              ". Korrigiere den Eintrag oder ergänze den fehlenden Schritt."));
          }
          return;
        }
        if (resolved.indexOf(target.id) === -1) resolved.push(target.id);
      });
      entry.inputFrom = resolved;
    });

    /* ---- connections ---- */
    const connections = [];
    if (doc.connections === undefined) {
      errors.push(issue("connections", "Der Abschnitt connections fehlt.",
        'Ergänze "connections" mit dem Ablauf, z. B. [ { "from": "schritt_a", "to": "schritt_b" } ].'));
    } else if (!Array.isArray(doc.connections)) {
      errors.push(issue("connections", "connections ist " + typeName(doc.connections) + ", erwartet wird eine Liste.",
        'Schreibe "connections": [ { "from": "…", "to": "…" } ].'));
    } else if (doc.connections.length === 0 && stepByKey.size > 1) {
      errors.push(issue("connections", "connections ist leer, es gibt aber mehrere Schritte.",
        "Verbinde die Schritte in der Reihenfolge des Ablaufs; daraus entsteht das Diagramm."));
    } else {
      const seen = new Set();
      doc.connections.forEach((conn, i) => {
        const at = "connections[" + i + "]";
        if (typeof conn !== "object" || conn === null || Array.isArray(conn)) {
          errors.push(issue(at, "Eintrag ist " + typeName(conn) + ", erwartet wird ein Objekt.",
            'Schreibe { "from": "…", "to": "…", "label": "…" }.'));
          return;
        }
        const from = isText(conn.from) ? conn.from.trim() : null;
        const to = isText(conn.to) ? conn.to.trim() : null;

        // Verweist eine Verbindung auf einen Schritt, den der Agent zwar
        // angelegt hat, der aber wegen eines eigenen Mangels verworfen wurde,
        // wäre eine zweite Meldung nur ein Folgefehler: Die Ursache steht
        // bereits in der Liste und würde von der Wiederholung zugedeckt.
        const known = (key) => stepByKey.has(key) || seenKeys.has(key);
        const keyList = () => Array.from(seenKeys).map((k) => '"' + k + '"').join(", ") || "(keine)";

        if (!from) {
          errors.push(issue(at + ".from", "Das Feld from fehlt oder ist leer.",
            "Setze from auf den key des Schritts, von dem der Ablauf ausgeht."));
        } else if (!known(from)) {
          errors.push(issue(at + ".from", "Der Schlüssel \"" + from + "\" kommt in steps nicht vor.",
            "Vorhandene Schlüssel: " + keyList() + ". Korrigiere from oder ergänze den fehlenden Schritt."));
        }
        if (!to) {
          errors.push(issue(at + ".to", "Das Feld to fehlt oder ist leer.",
            "Setze to auf den key des Folgeschritts."));
        } else if (!known(to)) {
          errors.push(issue(at + ".to", "Der Schlüssel \"" + to + "\" kommt in steps nicht vor.",
            "Vorhandene Schlüssel: " + keyList() + ". Korrigiere to oder ergänze den fehlenden Schritt."));
        }
        if (from && to && from === to) {
          errors.push(issue(at, "Der Schritt \"" + from + "\" verweist auf sich selbst.",
            "Eine Verbindung führt immer zu einem anderen Schritt; entferne sie oder korrigiere das Ziel."));
          return;
        }
        if (conn.label !== undefined && typeof conn.label !== "string") {
          notes.push(issue(at + ".label", "label ist " + typeName(conn.label) + " statt Text.",
            "Gib die Beschriftung als Text an, z. B. \"Ja\"."));
        }
        const pair = from + "→" + to;
        if (from && to && stepByKey.has(from) && stepByKey.has(to)) {
          if (seen.has(pair)) {
            notes.push(issue(at, "Die Verbindung " + pair + " ist doppelt vorhanden.",
              "Führe je Richtung nur eine Verbindung; nutze label, um Zweige zu unterscheiden."));
            return;
          }
          seen.add(pair);
          connections.push({
            id: uid("conn"),
            from: stepByKey.get(from).id,
            to: stepByKey.get(to).id,
            label: typeof conn.label === "string" ? conn.label.trim() : "",
          });
        }
      });
    }

    /* ---- fachliche Plausibilität (nur Hinweise) ----
       Nur sinnvoll, wenn die Struktur stimmt: Sind Schritte wegen eines Fehlers
       verworfen worden, wären die Folgerungen daraus (kein Start, nicht
       erreichbar …) irreführend und würden die eigentliche Ursache zudecken. */
    if (!errors.length && stepByKey.size) {
      const steps = Array.from(stepByKey.values());
      const starts = steps.filter((s) => s.type === "start" || s.type === "trigger");
      if (starts.length === 0) {
        notes.push(issue("steps", 'Kein Schritt hat type "trigger" oder "start".',
          'Kennzeichne den Einstieg: "trigger" für ein auslösendes Ereignis, "start" für den ersten aktiven Schritt.'));
      } else if (starts.length > 1) {
        notes.push(issue("steps", "Es gibt " + starts.length + " Einstiegspunkte (" +
          starts.map((s) => s.key + ": " + s.type).join(", ") + ").",
          "Ein Prozess hat genau einen Einstieg; setze die übrigen auf \"task\"."));
      }
      if (!steps.some((s) => s.type === "end")) {
        notes.push(issue("steps", 'Kein Schritt hat type "end".',
          'Markiere jeden Abschluss des Ablaufs mit "type": "end".'));
      }

      const outgoing = new Map(steps.map((s) => [s.id, []]));
      const incoming = new Map(steps.map((s) => [s.id, 0]));
      connections.forEach((c) => {
        if (outgoing.has(c.from)) outgoing.get(c.from).push(c);
        if (incoming.has(c.to)) incoming.set(c.to, incoming.get(c.to) + 1);
      });
      steps.forEach((s) => {
        const outs = outgoing.get(s.id) || [];
        if (s.type === "decision") {
          if (outs.length < 2) {
            notes.push(issue("steps (" + s.key + ")", "Der Entscheidungsschritt hat nur " + outs.length + " ausgehende Verbindung(en).",
              "Eine Entscheidung braucht mindestens zwei Zweige, jeder mit einem label wie \"Ja\" bzw. \"Nein\"."));
          } else if (outs.some((c) => !c.label)) {
            notes.push(issue("steps (" + s.key + ")", "Nicht alle Zweige der Entscheidung haben ein label.",
              "Beschrifte jeden ausgehenden Zweig, damit das Diagramm lesbar bleibt."));
          }
        }
        if (s.type !== "start" && incoming.get(s.id) === 0) {
          notes.push(issue("steps (" + s.key + ")", "Der Schritt ist über keine Verbindung erreichbar.",
            "Ergänze eine Verbindung, die zu diesem Schritt führt, oder entferne ihn."));
        }
        if (s.type !== "end" && outs.length === 0) {
          notes.push(issue("steps (" + s.key + ")", "Der Schritt hat keine ausgehende Verbindung.",
            'Ergänze den Folgeschritt oder kennzeichne den Schritt mit "type": "end".'));
        }
      });

      const missingSipoc = steps.filter((s) => !s.supplier || !s.input || !s.output || !s.customer);
      if (missingSipoc.length) {
        notes.push(issue("steps", missingSipoc.length + " von " + steps.length +
          " Schritten haben nicht alle vier SIPOC-Felder gefüllt (" +
          missingSipoc.slice(0, 5).map((s) => s.key).join(", ") + (missingSipoc.length > 5 ? ", …" : "") + ").",
          "Fülle supplier, input, output und customer für jeden Schritt — sie sind der Kern der SIPOC-Sicht."));
      }
    }

    if (errors.length) return { ok: false, errors, notes, project: null };

    const lanes = Array.from(laneByName.values());
    const usedLanes = new Set(Array.from(stepByKey.values()).map((s) => s.lane));
    lanes.filter((l) => !usedLanes.has(l.id)).forEach((l) => {
      notes.push(issue("lanes (" + l.name + ")", "Dem Akteur ist kein Prozessschritt zugeordnet.",
        "Ordne ihm einen Schritt zu oder entferne ihn aus lanes."));
    });

    const project = {
      id: uid("proj"),
      name: projectName,
      updatedAt: Date.now(),
      lanes,
      steps: Array.from(stepByKey.values()).map((s) => {
        const copy = Object.assign({}, s);
        delete copy.key;
        delete copy.inputFromKeys;
        delete copy.inputFromRaw;
        copy.inputFrom = s.inputFrom || [];
        return copy;
      }),
      connections,
    };
    return { ok: true, errors, notes, project };
  }

  // Formuliert das Prüfergebnis als Arbeitsauftrag zurück an den Agenten.
  function formatAgentReport(result) {
    const lines = [];
    if (result.ok) {
      lines.push("Der Import in SIPOC Swimlane Studio war erfolgreich.");
      if (result.notes.length) {
        lines.push("");
        lines.push("Folgende Punkte solltest du beim nächsten Mal besser machen:");
        result.notes.forEach((n, i) => {
          lines.push((i + 1) + ". [" + n.path + "] " + n.message + " → " + n.fix);
        });
      }
      return lines.join("\n");
    }

    lines.push("Der Import in SIPOC Swimlane Studio ist fehlgeschlagen.");
    lines.push("Korrigiere die folgenden Punkte und gib danach das VOLLSTÄNDIGE, korrigierte JSON erneut aus –");
    lines.push("ohne Erklärtext, ohne Markdown-Codeblock und ohne nur den geänderten Ausschnitt zu senden.");
    lines.push("");
    lines.push("ZU BEHEBEN (" + result.errors.length + "):");
    result.errors.forEach((e, i) => {
      lines.push((i + 1) + ". Fundstelle " + e.path);
      lines.push("   Problem:  " + e.message);
      lines.push("   Korrektur: " + e.fix);
    });
    if (result.notes.length) {
      lines.push("");
      lines.push("ZUSÄTZLICHE HINWEISE (" + result.notes.length + ", nicht blockierend):");
      result.notes.forEach((n, i) => {
        lines.push((i + 1) + ". [" + n.path + "] " + n.message + " → " + n.fix);
      });
    }
    lines.push("");
    lines.push("Erwartetes Format zur Erinnerung:");
    lines.push('{ "format": "' + AGENT_FORMAT_ID + '", "version": 1,');
    lines.push('  "project": { "name": "…" },');
    lines.push('  "lanes": [ { "name": "…", "description": "…" } ],');
    lines.push('  "steps": [ { "key": "…", "name": "…", "lane": "<lanes[].name>", "type": "start|task|decision|end",');
    lines.push('              "supplier": "…", "input": "…", "output": "…", "customer": "…" } ],');
    lines.push('  "connections": [ { "from": "<step.key>", "to": "<step.key>", "label": "…" } ] }');
    return lines.join("\n");
  }

  /* ------------------------------------------- Standalone-Datei erzeugen */

  // Baut aus der laufenden Seite eine einzelne, in sich geschlossene
  // HTML-Datei: Stylesheet und Skript werden eingebettet, alle zur Laufzeit
  // gefüllten Bereiche zurückgesetzt. Funktioniert sowohl auf einem Server
  // (Assets werden nachgeladen) als auch aus einer bereits gebündelten Datei
  // heraus (Assets stehen dann schon inline im Dokument).
  async function buildStandaloneHtml(bundledStore) {
    const root = document.documentElement.cloneNode(true);
    resetDocumentTemplate(root);

    const linkEl = root.querySelector('link[rel="stylesheet"]');
    if (linkEl) {
      const css = await fetchAssetText(linkEl.getAttribute("href"));
      const style = document.createElement("style");
      style.textContent = css.replace(/<\/style>/gi, "<\\/style>");
      linkEl.replaceWith(style);
    }

    const scriptEl = root.querySelector("script[src]");
    if (scriptEl) {
      const js = await fetchAssetText(scriptEl.getAttribute("src"));
      const inline = document.createElement("script");
      inline.textContent = js.replace(/<\/script>/gi, "<\\/script>");
      scriptEl.replaceWith(inline);
    }

    // Vorhandenen Datenbestand entfernen und ggf. neu setzen.
    const oldData = root.querySelector("#bundledData");
    if (oldData) oldData.remove();
    if (bundledStore) {
      const dataEl = document.createElement("script");
      dataEl.type = "application/json";
      dataEl.id = "bundledData";
      // "<" maskieren, damit Nutzertexte das Dokument nicht aufbrechen können.
      dataEl.textContent = JSON.stringify(bundledStore).replace(/</g, "\\u003c");
      const body = root.querySelector("body");
      body.insertBefore(dataEl, body.firstChild);
    }

    return "<!doctype html>\n" + root.outerHTML + "\n";
  }

  async function fetchAssetText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status + " für " + url);
    return res.text();
  }

  // Setzt alles zurück, was erst zur Laufzeit entsteht, damit die erzeugte
  // Datei so startet wie eine frische Auslieferung.
  function resetDocumentTemplate(root) {
    root.setAttribute("data-theme", "auto");
    ["stepList", "laneList", "connectionList", "diagramCanvasWrapper", "panelForm", "projectSelect", "stepFilterLane"]
      .forEach((id) => { const el = root.querySelector("#" + id); if (el) el.innerHTML = ""; });

    const wrapper = root.querySelector("#diagramCanvasWrapper");
    if (wrapper) wrapper.removeAttribute("style");

    const nameInput = root.querySelector("#projectNameInput");
    if (nameInput) nameInput.removeAttribute("value");

    const status = root.querySelector("#saveStatus");
    if (status) status.textContent = "—";

    const zoom = root.querySelector("#zoomLabel");
    if (zoom) zoom.textContent = "100%";

    const versionLabel = root.querySelector("#versionLabel");
    if (versionLabel) versionLabel.textContent = "—";

    const toast = root.querySelector("#toast");
    if (toast) { toast.textContent = ""; toast.className = "toast hidden"; toast.removeAttribute("style"); }

    const panel = root.querySelector("#panel");
    if (panel) { panel.className = "panel hidden"; panel.setAttribute("aria-hidden", "true"); }

    const overlay = root.querySelector("#overlay");
    if (overlay) overlay.className = "overlay hidden";

    const menu = root.querySelector("#moreMenu");
    if (menu) menu.className = "menu hidden";
    const menuBtn = root.querySelector("#moreMenuBtn");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");

    const warning = root.querySelector("#versionWarning");
    if (warning) warning.className = "version-warning hidden";

    const diagramEmpty = root.querySelector("#diagramEmpty");
    if (diagramEmpty) diagramEmpty.className = "empty-state hidden";

    root.querySelectorAll(".nav-item.active").forEach((el) => el.classList.remove("active"));
    root.querySelectorAll(".section.active").forEach((el) => el.classList.remove("active"));
  }

  function openDownloadAppForm() {
    const projectCount = store.projects.length;
    const stepCount = store.projects.reduce((n, p) => n + p.steps.length, 0);
    const fields =
      `<p class="field-note">Erzeugt eine einzelne HTML-Datei, die alles enthält: Programm, Gestaltung und optional deine Daten.
        Die Datei lässt sich per Doppelklick ohne Internetverbindung öffnen, auf einem Netzlaufwerk ablegen oder als
        Confluence-Anhang weitergeben.</p>` +
      fieldSelect("content", "Inhalt der Datei", [
        { value: "current", label: `Aktuelle Daten übernehmen (${projectCount} Projekt(e), ${stepCount} Schritt(e))` },
        { value: "example", label: "Mit dem Beispielprojekt starten" },
        { value: "empty", label: "Leer starten" },
      ], "current", { required: true }) +
      `<p class="field-note">Hinweis: Die heruntergeladene Datei hat einen eigenen, getrennten Datenspeicher — sie greift
        nicht auf die Daten dieser Browser-Adresse zu. Ohne Übernahme startet sie also unabhängig von deinem jetzigen Stand.</p>`;

    openPanel("App als Datei herunterladen", fields, {
      submitLabel: "Herunterladen",
      onSubmit: (data) => {
        downloadStandaloneApp(data.content);
      },
    });
  }

  async function downloadStandaloneApp(mode) {
    let bundledStore = null;
    if (mode === "current") {
      bundledStore = JSON.parse(JSON.stringify(store));
    } else if (mode === "empty") {
      const fresh = blankProject("Neuer SIPOC-Prozess");
      bundledStore = { projects: [fresh], currentProjectId: fresh.id };
    } // "example" -> kein Bundle, die App legt beim Start ihr Beispielprojekt an

    showToast("Datei wird zusammengestellt…");
    try {
      const html = await buildStandaloneHtml(bundledStore);
      downloadFile("sipoc-swimlane-studio.html", html, "text/html;charset=utf-8");
      showToast("App heruntergeladen — Datei per Doppelklick im Browser öffnen.");
    } catch (e) {
      showToast("App konnte nicht gebündelt werden: " + e.message, "warn");
    }
  }

  /* --------------------------------------------------------------- Toast */

  let toastTimer = null;
  function showToast(msg, kind) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.style.color = kind === "warn" ? "var(--red)" : "var(--text-primary)";
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
  }

  /* --------------------------------------------------------------- Panel */

  function openPanel(title, fieldsHtml, opts) {
    document.getElementById("panelTitle").textContent = title;
    const form = document.getElementById("panelForm");
    form.innerHTML = fieldsHtml + `
      <div class="panel-actions">
        ${opts.onDelete ? `<button type="button" id="panelDeleteBtn" class="btn btn-ghost btn-danger">Löschen</button>` : ""}
        <button type="submit" class="btn btn-primary">${opts.submitLabel || "Speichern"}</button>
      </div>`;
    form.onsubmit = (e) => {
      e.preventDefault();
      const data = {};
      new FormData(form).forEach((v, k) => { data[k] = v; });
      const ok = opts.onSubmit(data);
      if (ok !== false) closePanel();
    };
    if (opts.onDelete) {
      document.getElementById("panelDeleteBtn").onclick = () => {
        const ok = opts.onDelete();
        if (ok !== false) closePanel();
      };
    }
    document.getElementById("overlay").classList.remove("hidden");
    document.getElementById("panel").classList.remove("hidden");
    document.getElementById("panel").setAttribute("aria-hidden", "false");
    const first = form.querySelector("input, select, textarea");
    if (first) setTimeout(() => first.focus(), 60);
  }
  function closePanel() {
    document.getElementById("overlay").classList.add("hidden");
    document.getElementById("panel").classList.add("hidden");
    document.getElementById("panel").setAttribute("aria-hidden", "true");
  }

  function fieldText(name, label, value, opts) {
    opts = opts || {};
    return `<div class="field"><label for="f_${name}">${label}${opts.required ? " *" : ""}</label>
      <input type="text" id="f_${name}" name="${name}" value="${escapeHtml(value || "")}" ${opts.required ? "required" : ""} placeholder="${escapeHtml(opts.placeholder || "")}" />
      ${opts.hint ? `<span class="hint">${opts.hint}</span>` : ""}
    </div>`;
  }
  function fieldTextarea(name, label, value, opts) {
    opts = opts || {};
    return `<div class="field"><label for="f_${name}">${label}</label>
      <textarea id="f_${name}" name="${name}" placeholder="${escapeHtml(opts.placeholder || "")}">${escapeHtml(value || "")}</textarea>
    </div>`;
  }
  function fieldSelect(name, label, options, value, opts) {
    opts = opts || {};
    return `<div class="field"><label for="f_${name}">${label}${opts.required ? " *" : ""}</label>
      <select id="f_${name}" name="${name}" ${opts.required ? "required" : ""}>
        ${options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
      </select>
    </div>`;
  }
  // Mehrfachauswahl: Aus welchen Outputs anderer Schritte speist sich dieser
  // Input? Daraus entsteht die Artefaktkette in der SIPOC-Übersicht.
  function fieldInputSources(step, project) {
    const others = project.steps.filter((s) => !step || s.id !== step.id);
    if (!others.length) return "";
    const selected = new Set((step && step.inputFrom) || []);
    return `<div class="field"><label>Input stammt aus dem Output von</label>
      <span class="hint">Verkettet die SIPOC-Zeilen über ihre Artefakte — mehrere Herkünfte sind möglich.</span>
      <div class="source-list">
        ${others.map((s) => `
          <label class="source-option">
            <input type="checkbox" name="inputFrom" value="${escapeHtml(s.id)}" ${selected.has(s.id) ? "checked" : ""} />
            <span class="source-option-text">
              <span class="source-option-name">${escapeHtml(s.name)}</span>
              <span class="source-option-out">${s.output ? escapeHtml(s.output) : "ohne Output-Angabe"}</span>
            </span>
          </label>`).join("")}
      </div>
    </div>`;
  }

  function fieldTypeRadio(name, value) {
    const entries = Object.entries(STEP_TYPES);
    return `<div class="field"><label>Schritt-Typ *</label>
      <div class="type-radio-group">
        ${entries.map(([k, meta]) => `
          <input class="type-radio" type="radio" id="f_${name}_${k}" name="${name}" value="${k}" ${k === (value || "task") ? "checked" : ""} required />
          <label class="type-radio-label" style="--type-color:${meta.color}" for="f_${name}_${k}">${meta.label}</label>
        `).join("")}
      </div>
    </div>`;
  }

  /* --------------------------------------------------------- Renderers */

  function renderProjectPicker() {
    const sel = document.getElementById("projectSelect");
    sel.innerHTML = store.projects
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "de"))
      .map((p) => `<option value="${p.id}" ${p.id === store.currentProjectId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
      .join("");
    document.getElementById("projectNameInput").value = getProject().name;
  }

  function renderLanes() {
    const p = getProject();
    const list = document.getElementById("laneList");
    if (!p.lanes.length) {
      list.innerHTML = `<div class="list-row"><div class="list-row-main"><div class="list-row-sub">Noch keine Akteure angelegt. Ein Akteur ist eine Swimlane — z. B. eine Rolle, Abteilung oder ein System.</div></div></div>`;
      return;
    }
    list.innerHTML = p.lanes.map((l, i) => {
      const count = p.steps.filter((s) => s.lane === l.id).length;
      return `<div class="list-row" data-lane-id="${l.id}">
        <span class="list-row-swatch" style="background:${l.color}"></span>
        <div class="list-row-main">
          <div class="list-row-title-line"><span class="list-row-title">${escapeHtml(l.name)}</span>
            <span class="badge">${count} Schritt${count === 1 ? "" : "e"}</span>
          </div>
          ${l.description ? `<div class="list-row-sub">${escapeHtml(l.description)}</div>` : ""}
        </div>
        <div class="list-row-actions">
          <button class="btn btn-icon lane-up" type="button" title="Nach oben" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn btn-icon lane-down" type="button" title="Nach unten" ${i === p.lanes.length - 1 ? "disabled" : ""}>↓</button>
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll(".list-row").forEach((row) => {
      const id = row.dataset.laneId;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".lane-up") || e.target.closest(".lane-down")) return;
        openLaneForm(getLane(id));
      });
      row.querySelector(".lane-up")?.addEventListener("click", (e) => { e.stopPropagation(); moveLane(id, -1); renderLanes(); });
      row.querySelector(".lane-down")?.addEventListener("click", (e) => { e.stopPropagation(); moveLane(id, 1); renderLanes(); });
    });
  }

  function openLaneForm(lane) {
    const fields =
      fieldText("name", "Name", lane ? lane.name : "", { required: true, placeholder: "z. B. Kreditorenbuchhaltung" }) +
      fieldTextarea("description", "Beschreibung", lane ? lane.description : "", { placeholder: "Rolle, Abteilung oder System, das diese Swimlane repräsentiert" }) +
      `<div class="field"><label>Farbe</label><div class="color-swatch-group">
        ${LANE_COLORS.map((c) => `<span class="color-swatch ${lane && lane.color === c ? "selected" : ""}" data-color="${c}" style="background:${c}"></span>`).join("")}
      </div><input type="hidden" name="color" value="${lane ? lane.color : LANE_COLORS[0]}" /></div>`;

    openPanel(lane ? "Akteur bearbeiten" : "Neuer Akteur", fields, {
      submitLabel: lane ? "Speichern" : "Anlegen",
      onSubmit: (data) => {
        if (lane) updateLane(lane.id, data); else addLane(data);
        renderLanes(); renderStepFilter(); renderStepTable(); renderDiagramIfActive();
      },
      onDelete: lane ? () => {
        if (!confirm("Akteur „" + lane.name + "“ wirklich löschen?")) return false;
        const ok = deleteLane(lane.id);
        if (ok) { renderLanes(); renderStepFilter(); renderStepTable(); renderDiagramIfActive(); }
        return ok;
      } : null,
    });

    document.querySelectorAll(".color-swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
        sw.classList.add("selected");
        document.querySelector('#panelForm input[name="color"]').value = sw.dataset.color;
      });
    });
  }

  function renderStepFilter() {
    const p = getProject();
    const sel = document.getElementById("stepFilterLane");
    const current = sel.value;
    sel.innerHTML = `<option value="">Alle Akteure</option>` + p.lanes.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
    sel.value = p.lanes.some((l) => l.id === current) ? current : "";
  }

  // Reihenfolge der Zeilen: entlang des Ablaufs, damit die Tabelle sich liest
  // wie der Prozess. Grundlage ist dieselbe Tiefenberechnung wie im Diagramm.
  function stepsInFlowOrder(project) {
    if (!project.steps.length) return [];
    const layout = computeLayout(project);
    const laneRank = new Map(project.lanes.map((l, i) => [l.id, i]));
    const depthOf = new Map(layout.steps.map((s) => [s.id, s.depth]));
    return project.steps.slice().sort((a, b) => {
      const da = depthOf.get(a.id) || 0, db = depthOf.get(b.id) || 0;
      if (da !== db) return da - db;
      return (laneRank.get(a.lane) || 0) - (laneRank.get(b.lane) || 0);
    });
  }

  // Die SIPOC-Sicht ist bewusst eine reine Tabelle: Hier werden Schritte
  // angelegt und gepflegt. Wie sie zusammenhängen, zeigen die Prozess-Sichten
  // (Swimlane-Diagramm und Prozesskette) — nicht diese Ansicht.
  function renderStepTable() {
    const p = getProject();
    const host = document.getElementById("stepTable");
    if (!host) return;
    const filter = document.getElementById("stepFilterLane").value;

    if (!p.steps.length) {
      host.innerHTML = `<div class="table-empty">Noch keine Prozessschritte erfasst. Lege zuerst Akteure an, dann Schritte mit Supplier, Input, Process, Output und Customer.</div>`;
      return;
    }

    let rows = stepsInFlowOrder(p);
    if (filter) rows = rows.filter((s) => s.lane === filter);
    if (!rows.length) {
      host.innerHTML = `<div class="table-empty">Kein Schritt für diesen Akteur.</div>`;
      return;
    }

    const byId = new Map(p.steps.map((s) => [s.id, s]));
    const text = (v) => (v ? escapeHtml(v) : '<span class="cell-empty">—</span>');

    host.innerHTML = `<table class="data-table">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th class="col-type">Typ</th>
          <th class="col-lane">Akteur</th>
          <th>Supplier</th>
          <th>Input</th>
          <th class="col-process">Process</th>
          <th>Output</th>
          <th>Customer</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((s, i) => {
          const lane = getLane(s.lane);
          const meta = STEP_TYPES[s.type] || STEP_TYPES.task;
          const sources = (s.inputFrom || []).map((id) => byId.get(id)).filter(Boolean);
          return `<tr data-step-id="${escapeHtml(s.id)}">
            <td class="col-num">${i + 1}</td>
            <td class="col-type"><span class="badge"><span class="badge-dot" style="background:${meta.color}"></span>${meta.label}</span></td>
            <td class="col-lane">${lane
              ? `<span class="lane-tag"><span class="badge-dot" style="background:${lane.color}"></span>${escapeHtml(lane.name)}</span>`
              : '<span class="cell-empty">ohne Akteur</span>'}</td>
            <td>${text(s.supplier)}</td>
            <td>${text(s.input)}${sources.length
              ? `<div class="cell-note cell-source">aus: ${sources.map((q) => escapeHtml(q.name)).join(", ")}</div>` : ""}</td>
            <td class="col-process">
              <span class="cell-strong">${escapeHtml(s.name)}</span>
              ${s.description ? `<div class="cell-note">${escapeHtml(s.description)}</div>` : ""}
            </td>
            <td>${text(s.output)}</td>
            <td>${text(s.customer)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

    host.querySelectorAll("tr[data-step-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const step = getStep(row.dataset.stepId);
        if (step) openStepForm(step);
      });
    });
  }
  function openStepForm(step) {
    const p = getProject();
    if (!p.lanes.length) {
      showToast("Bitte zuerst mindestens einen Akteur anlegen.", "warn");
      return;
    }
    const laneOptions = p.lanes.map((l) => ({ value: l.id, label: l.name }));
    const fields =
      fieldText("name", "Name des Prozessschritts", step ? step.name : "", { required: true, placeholder: "z. B. Formalprüfung vollständig?" }) +
      fieldSelect("lane", "Akteur", laneOptions, step ? step.lane : p.lanes[0].id, { required: true }) +
      fieldTypeRadio("type", step ? step.type : "task") +
      `<div class="field-group" style="display:flex;flex-direction:column;gap:16px;border-top:1px solid var(--separator);padding-top:16px;">` +
      fieldText("supplier", "Supplier (Lieferant des Inputs)", step ? step.supplier : "") +
      fieldText("input", "Input", step ? step.input : "") +
      fieldInputSources(step, p) +
      fieldText("output", "Output", step ? step.output : "") +
      fieldText("customer", "Customer (Empfänger des Outputs)", step ? step.customer : "") +
      `</div>` +
      fieldTextarea("description", "Beschreibung", step ? step.description : "");

    openPanel(step ? "Prozessschritt bearbeiten" : "Neuer Prozessschritt", fields, {
      submitLabel: step ? "Speichern" : "Anlegen",
      onSubmit: (data) => {
        data.inputFrom = Array.from(
          document.querySelectorAll('#panelForm input[name="inputFrom"]:checked')
        ).map((el) => el.value);
        if (step) updateStep(step.id, data); else addStep(data);
        renderStepTable(); renderConnections(); renderDiagramIfActive();
      },
      onDelete: step ? () => {
        if (!confirm("Prozessschritt „" + step.name + "“ wirklich löschen?")) return false;
        const ok = deleteStep(step.id);
        if (ok) { renderStepTable(); renderConnections(); renderDiagramIfActive(); }
        return ok;
      } : null,
    });
  }

  function renderConnections() {
    const p = getProject();
    const list = document.getElementById("connectionList");
    if (!p.connections.length) {
      list.innerHTML = `<div class="list-row"><div class="list-row-main"><div class="list-row-sub">Noch keine Verbindungen. Verbinde Prozessschritte, um den Ablauf und damit das Swimlane-Diagramm zu erzeugen.</div></div></div>`;
      return;
    }
    list.innerHTML = p.connections.map((c) => {
      const from = getStep(c.from), to = getStep(c.to);
      const fromLane = from && getLane(from.lane), toLane = to && getLane(to.lane);
      return `<div class="list-row" data-conn-id="${c.id}">
        <div class="list-row-main">
          <div class="list-row-title-line">
            <span class="list-row-title">${from ? escapeHtml(from.name) : "?"}</span>
            <span>→</span>
            <span class="list-row-title">${to ? escapeHtml(to.name) : "?"}</span>
            ${c.label ? `<span class="badge">${escapeHtml(c.label)}</span>` : ""}
          </div>
          <div class="list-row-sub">${fromLane ? escapeHtml(fromLane.name) : "?"} → ${toLane ? escapeHtml(toLane.name) : "?"}</div>
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll(".list-row[data-conn-id]").forEach((row) => {
      row.addEventListener("click", () => openConnectionForm(p_getConn(row.dataset.connId)));
    });
  }

  function openConnectionForm(conn) {
    const p = getProject();
    if (p.steps.length < 2) {
      showToast("Es werden mindestens zwei Prozessschritte benötigt.", "warn");
      return;
    }
    const stepOptions = p.steps.map((s) => ({ value: s.id, label: s.name }));
    const fields =
      fieldSelect("from", "Von", stepOptions, conn ? conn.from : p.steps[0].id, { required: true }) +
      fieldSelect("to", "Bis", stepOptions, conn ? conn.to : p.steps[1].id, { required: true }) +
      fieldText("label", "Beschriftung (optional)", conn ? conn.label : "", { placeholder: "z. B. Ja / Nein / erneut einreichen" });

    openPanel(conn ? "Verbindung bearbeiten" : "Neue Verbindung", fields, {
      submitLabel: conn ? "Speichern" : "Anlegen",
      onSubmit: (data) => {
        let ok;
        if (conn) { updateConnection(conn.id, data); ok = true; }
        else ok = addConnection(data);
        if (ok !== false) { renderConnections(); renderDiagramIfActive(); }
        return ok;
      },
      onDelete: conn ? () => {
        if (!confirm("Verbindung wirklich löschen?")) return false;
        deleteConnection(conn.id);
        renderConnections(); renderDiagramIfActive();
        return true;
      } : null,
    });
  }

  /* --------------------------------------------- Oberfläche: Prozesskette */

  function renderProcessLinks() {
    const list = document.getElementById("processLinkList");
    if (!list) return;
    const links = getProcessLinks();
    if (!links.length) {
      list.innerHTML = `<div class="list-row"><div class="list-row-main"><div class="list-row-sub">
        Noch keine Verkettung. Verbinde den Output eines Prozesses mit dem Input eines anderen, um die Prozesskette abzubilden.
      </div></div></div>`;
      return;
    }
    list.innerHTML = links.map((l) => {
      const from = getProjectById(l.fromProject), to = getProjectById(l.toProject);
      const fromStep = from && l.fromStep ? from.steps.find((s) => s.id === l.fromStep) : null;
      const toStep = to && l.toStep ? to.steps.find((s) => s.id === l.toStep) : null;
      return `<div class="list-row" data-link-id="${escapeHtml(l.id)}">
        <div class="list-row-main">
          <div class="list-row-title-line">
            <span class="list-row-title">${from ? escapeHtml(from.name) : "?"}</span>
            <span>→</span>
            <span class="list-row-title">${to ? escapeHtml(to.name) : "?"}</span>
            ${l.artifact ? `<span class="badge">${escapeHtml(l.artifact)}</span>` : ""}
          </div>
          <div class="list-row-sub">
            ${fromStep ? "ab „" + escapeHtml(fromStep.name) + "“" : "aus dem Gesamtprozess"} ·
            ${toStep ? "an „" + escapeHtml(toStep.name) + "“" : "an den Gesamtprozess"}
            ${l.description ? "<br>" + escapeHtml(l.description) : ""}
          </div>
        </div>
      </div>`;
    }).join("");
    list.querySelectorAll(".list-row[data-link-id]").forEach((row) => {
      row.addEventListener("click", () => {
        openProcessLinkForm(getProcessLinks().find((l) => l.id === row.dataset.linkId));
      });
    });
  }

  function openProcessLinkForm(link) {
    if (store.projects.length < 2) {
      showToast("Für eine Prozesskette werden mindestens zwei Prozesse benötigt.", "warn");
      return;
    }
    const projectOptions = store.projects.map((p) => ({ value: p.id, label: p.name }));
    const stepOptions = (projectId) => {
      const p = getProjectById(projectId);
      return [{ value: "", label: "— gesamter Prozess —" }]
        .concat((p ? p.steps : []).map((s) => ({ value: s.id, label: s.name })));
    };
    const fromProject = link ? link.fromProject : store.projects[0].id;
    const toProject = link ? link.toProject : store.projects[1].id;

    const fields =
      fieldSelect("fromProject", "Liefernder Prozess", projectOptions, fromProject, { required: true }) +
      fieldSelect("fromStep", "Ab welchem Schritt (optional)", stepOptions(fromProject), link ? link.fromStep : "") +
      fieldText("artifact", "Übergebenes Artefakt", link ? link.artifact : "", {
        placeholder: "z. B. Verbindliche Bestellung mit Bestellnummer",
      }) +
      fieldSelect("toProject", "Empfangender Prozess", projectOptions, toProject, { required: true }) +
      fieldSelect("toStep", "An welchen Schritt (optional)", stepOptions(toProject), link ? link.toStep : "") +
      fieldTextarea("description", "Beschreibung der Übergabe", link ? link.description : "");

    openPanel(link ? "Verkettung bearbeiten" : "Neue Verkettung", fields, {
      submitLabel: link ? "Speichern" : "Anlegen",
      onSubmit: (data) => {
        const ok = link ? updateProcessLink(link.id, data) : addProcessLink(data);
        if (ok !== false) { renderProcessLinks(); renderChainMap(); }
        return ok;
      },
      onDelete: link ? () => {
        if (!confirm("Verkettung wirklich löschen?")) return false;
        deleteProcessLink(link.id);
        renderProcessLinks(); renderChainMap();
        return true;
      } : null,
    });

    // Die Schrittauswahl folgt dem jeweils gewählten Prozess.
    const refresh = (projectField, stepField) => {
      const projectSel = document.getElementById("f_" + projectField);
      const stepSel = document.getElementById("f_" + stepField);
      if (!projectSel || !stepSel) return;
      projectSel.addEventListener("change", () => {
        stepSel.innerHTML = stepOptions(projectSel.value)
          .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("");
      });
    };
    refresh("fromProject", "fromStep");
    refresh("toProject", "toStep");
  }

  // Landkarte: Prozesse als Karten, Übergaben als beschriftete Pfeile.
  // Die Spalte ergibt sich aus der Tiefe in der Kette (längster Pfad).
  function renderChainMap() {
    const host = document.getElementById("chainMap");
    if (!host) return;
    const links = getProcessLinks();
    if (store.projects.length < 2) {
      host.innerHTML = `<div class="agent-placeholder">Sobald ein zweiter Prozess angelegt ist, entsteht hier die Landkarte der Prozesskette.</div>`;
      return;
    }

    const preds = new Map(store.projects.map((p) => [p.id, []]));
    links.forEach((l) => { if (preds.has(l.toProject)) preds.get(l.toProject).push(l.fromProject); });
    const depth = new Map();
    const busy = new Set();
    const depthOf = (id) => {
      if (depth.has(id)) return depth.get(id);
      if (busy.has(id)) return 0;
      busy.add(id);
      const ps = preds.get(id) || [];
      const d = ps.length ? Math.max.apply(null, ps.map(depthOf)) + 1 : 0;
      busy.delete(id);
      depth.set(id, d);
      return d;
    };
    store.projects.forEach((p) => depthOf(p.id));

    const W = 250, H = 96, GAPX = 230, GAPY = 40;
    const columns = new Map();
    store.projects.forEach((p) => {
      const d = depth.get(p.id) || 0;
      if (!columns.has(d)) columns.set(d, []);
      columns.get(d).push(p);
    });
    const pos = new Map();
    let maxRows = 0;
    Array.from(columns.keys()).sort((a, b) => a - b).forEach((d) => {
      columns.get(d).forEach((p, row) => {
        pos.set(p.id, { x: d * (W + GAPX), y: row * (H + GAPY) });
        maxRows = Math.max(maxRows, row + 1);
      });
    });
    const width = (Math.max.apply(null, Array.from(columns.keys())) + 1) * (W + GAPX) - GAPX + 4;
    const height = maxRows * (H + GAPY) - GAPY + 4;

    const edges = links.map((l) => {
      const a = pos.get(l.fromProject), b = pos.get(l.toProject);
      if (!a || !b) return "";
      const sx = a.x + W, sy = a.y + H / 2;
      const tx = b.x, ty = b.y + H / 2;
      const forward = tx > sx;
      const mid = forward ? sx + (tx - sx) / 2 : sx + 40;
      const d = forward
        ? `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`
        : `M ${sx} ${sy} C ${sx + 60} ${sy - 60}, ${tx - 60} ${ty - 60}, ${tx} ${ty}`;
      const lx = forward ? (sx + tx) / 2 : (sx + tx) / 2;
      const ly = forward ? (sy + ty) / 2 - 10 : Math.min(sy, ty) - 46;
      // Die Beschriftung muss in die Lücke zwischen zwei Karten passen.
      const maxChars = Math.floor((GAPX - 24) / 6.1);
      const label = (l.artifact || "").length > maxChars
        ? (l.artifact || "").slice(0, maxChars - 1).trim() + "…"
        : (l.artifact || "");
      const lw = Math.max(40, label.length * 6.1 + 16);
      return `<path d="${d}" class="chain-edge" marker-end="url(#chainArrow)"><title>${escapeXml(l.artifact || "Übergabe")}</title></path>` +
        (label
          ? `<rect x="${lx - lw / 2}" y="${ly - 11}" width="${lw}" height="22" rx="11" class="chain-edge-label-bg" />
             <text x="${lx}" y="${ly + 4}" class="chain-edge-label">${escapeXml(label)}</text>`
          : "");
    }).join("");

    const cards = store.projects.map((p) => {
      const pt = pos.get(p.id);
      const active = p.id === store.currentProjectId;
      const laneNames = p.lanes.slice(0, 3).map((l) => l.name).join(", ") + (p.lanes.length > 3 ? " …" : "");
      return `<foreignObject x="${pt.x}" y="${pt.y}" width="${W}" height="${H}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="chain-card${active ? " chain-card-active" : ""}" data-project-id="${escapeHtml(p.id)}">
          <div class="chain-card-name">${escapeHtml(p.name)}</div>
          <div class="chain-card-meta">${p.steps.length} Schritte · ${p.lanes.length} Akteure</div>
          <div class="chain-card-lanes">${escapeHtml(laneNames || "keine Akteure")}</div>
        </div>
      </foreignObject>`;
    }).join("");

    host.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
      <defs>
        <marker id="chainArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="var(--text-tertiary)" />
        </marker>
      </defs>
      ${edges}
      ${cards}
    </svg>`;

    host.querySelectorAll(".chain-card").forEach((card) => {
      card.addEventListener("click", () => {
        store.currentProjectId = card.dataset.projectId;
        touch();
        renderAll();
        showToast("Prozess „" + getProject().name + "“ ausgewählt.");
      });
    });
  }

  /* ------------------------------------------ Oberfläche: Import vom Agenten */

  let agentResult = null;

  function renderAgentPrompt() {
    const el = document.getElementById("agentPromptText");
    if (el && !el.textContent.trim()) el.textContent = AGENT_PROMPT;
  }

  function issueCard(item, kind) {
    return `<div class="issue issue-${kind}">
      <div class="issue-head">
        <span class="issue-badge">${kind === "error" ? "Fehler" : "Hinweis"}</span>
        <code class="issue-path">${escapeHtml(item.path)}</code>
      </div>
      <div class="issue-message">${escapeHtml(item.message)}</div>
      <div class="issue-fix"><strong>Korrektur:</strong> ${escapeHtml(item.fix)}</div>
    </div>`;
  }

  function renderAgentResult() {
    const box = document.getElementById("agentResult");
    if (!box) return;
    if (!agentResult) {
      box.innerHTML = `<div class="agent-placeholder">Noch nichts geprüft. Füge die Antwort des Agenten oben ein und wähle „Prüfen“.</div>`;
      return;
    }

    const r = agentResult;
    const head = r.ok
      ? `<div class="agent-verdict agent-verdict-ok">
           <strong>Format in Ordnung.</strong>
           ${escapeHtml(String(r.project.lanes.length))} Akteure ·
           ${escapeHtml(String(r.project.steps.length))} Prozessschritte ·
           ${escapeHtml(String(r.project.connections.length))} Verbindungen
           ${r.notes.length ? " · " + r.notes.length + " Hinweis(e)" : ""}
         </div>`
      : `<div class="agent-verdict agent-verdict-error">
           <strong>${escapeHtml(String(r.errors.length))} Beanstandung(en).</strong>
           Der Agent muss nachbessern — gib ihm den Bericht unten zurück.
         </div>`;

    const actions = `<div class="agent-result-actions">
        ${r.ok ? `<button id="importAgentBtn" class="btn btn-primary" type="button">Als neues Projekt übernehmen</button>` : ""}
        <button id="copyAgentReportBtn" class="btn btn-ghost" type="button">
          ${r.ok ? "Rückmeldung für den Agenten kopieren" : "Fehlerbericht für den Agenten kopieren"}
        </button>
      </div>`;

    const list =
      r.errors.map((e) => issueCard(e, "error")).join("") +
      r.notes.map((n) => issueCard(n, "note")).join("");

    const report = `<details class="agent-report"${r.ok ? "" : " open"}>
        <summary>Wortlaut der Rückmeldung an den Agenten</summary>
        <pre class="code-block code-block-small">${escapeHtml(formatAgentReport(r))}</pre>
      </details>`;

    box.innerHTML = head + actions + (list ? `<div class="issue-list">${list}</div>` : "") + report;

    const importBtn = document.getElementById("importAgentBtn");
    if (importBtn) importBtn.addEventListener("click", importAgentProject);
    const copyBtn = document.getElementById("copyAgentReportBtn");
    if (copyBtn) copyBtn.addEventListener("click", () => copyText(formatAgentReport(agentResult), "Rückmeldung kopiert."));
  }

  function checkAgentInput() {
    const input = document.getElementById("agentInput");
    agentResult = checkAgentPayload(input ? input.value : "");
    renderAgentResult();
    if (agentResult.ok) showToast("Format geprüft — Daten können übernommen werden.");
    else showToast(agentResult.errors.length + " Beanstandung(en) gefunden.", "warn");
  }

  function importAgentProject() {
    if (!agentResult || !agentResult.ok || !agentResult.project) return;
    const project = agentResult.project;
    store.projects.push(project);
    store.currentProjectId = project.id;
    touch();
    agentResult = null;
    const input = document.getElementById("agentInput");
    if (input) input.value = "";
    renderAll();
    showSection("sipoc");
    showToast("Prozess „" + project.name + "“ übernommen.");
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage);
    } catch (e) {
      downloadFile("sipoc-agent-text.txt", text, "text/plain;charset=utf-8");
      showToast("Zwischenablage nicht verfügbar — als Datei heruntergeladen.");
    }
  }

  let currentLayout = null;

  function applyZoom() {
    const wrapper = document.getElementById("diagramCanvasWrapper");
    wrapper.style.transform = `scale(${ui.zoom})`;
    if (currentLayout) {
      wrapper.style.width = currentLayout.width + "px";
      wrapper.style.height = currentLayout.height + "px";
    }
    document.getElementById("zoomLabel").textContent = Math.round(ui.zoom * 100) + "%";
  }

  function renderDiagram() {
    const p = getProject();
    const artifactsBtn = document.getElementById("toggleArtifactsBtn");
    if (artifactsBtn) {
      artifactsBtn.classList.toggle("btn-primary", ui.showArtifacts);
      artifactsBtn.classList.toggle("btn-ghost", !ui.showArtifacts);
      artifactsBtn.textContent = ui.showArtifacts ? "Artefakte ausblenden" : "Artefakte anzeigen";
    }
    const wrapper = document.getElementById("diagramCanvasWrapper");
    const empty = document.getElementById("diagramEmpty");
    if (!p.steps.length) {
      wrapper.innerHTML = "";
      currentLayout = null;
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    currentLayout = computeLayout(p);
    wrapper.innerHTML = renderDiagramSVG(currentLayout);
    applyZoom();
  }

  function renderDiagramIfActive() {
    if (ui.section === "diagram") renderDiagram();
  }

  function fitZoom() {
    if (!currentLayout) { ui.zoom = 1; applyZoom(); return; }
    const outer = document.getElementById("diagramCanvasOuter");
    const availW = outer.clientWidth - 48;
    const availH = outer.clientHeight - 48;
    const z = Math.min(1, availW / currentLayout.width, availH / currentLayout.height);
    ui.zoom = Math.max(0.15, Math.round(z * 100) / 100);
    applyZoom();
  }

  function showSection(section) {
    ui.section = section;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.section === section));
    document.querySelectorAll(".section").forEach((s) => s.classList.toggle("active", s.id === "section-" + section));
    if (section === "sipoc") { renderStepFilter(); renderStepTable(); }
    if (section === "lanes") renderLanes();
    if (section === "connections") renderConnections();
    if (section === "chain") { renderProcessLinks(); renderChainMap(); }
    if (section === "agent") { renderAgentPrompt(); renderAgentResult(); }
    if (section === "diagram") { renderDiagram(); fitZoom(); }
  }

  function renderAll() {
    renderProjectPicker();
    renderStepFilter();
    showSection(ui.section);
  }

  /* ------------------------------------------------------------ Wiring */

  function wireEvents() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => showSection(btn.dataset.section));
    });

    on("newLaneBtn", "click", () => openLaneForm(null));
    on("newStepBtn", "click", () => openStepForm(null));
    on("newConnectionBtn", "click", () => openConnectionForm(null));

    on("stepFilterLane", "change", renderStepTable);

    on("newProcessLinkBtn", "click", () => openProcessLinkForm(null));

    // Die Anleitung verweist auf die Bereiche, die sie beschreibt.
    document.querySelectorAll(".guide-jump").forEach((btn) => {
      btn.addEventListener("click", () => showSection(btn.dataset.goto));
    });

    on("overlay", "click", closePanel);
    on("panelClose", "click", closePanel);

    // Aktionsmenü
    const menu = document.getElementById("moreMenu");
    const menuBtn = document.getElementById("moreMenuBtn");
    function setMenuOpen(open) {
      if (!menu || !menuBtn) return;
      menu.classList.toggle("hidden", !open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    on("moreMenuBtn", "click", (e) => {
      e.stopPropagation();
      setMenuOpen(menu && menu.classList.contains("hidden"));
    });
    if (menu) {
      // Capture-Phase: Das Menü schließt, bevor die Aktion des Eintrags läuft
      // (sonst bliebe es während eines Bestätigungsdialogs offen stehen).
      menu.addEventListener("click", (e) => {
        if (e.target.closest(".menu-item")) setMenuOpen(false);
      }, true);
    }
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".menu-anchor")) setMenuOpen(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closePanel(); setMenuOpen(false); }
    });

    on("projectSelect", "change", (e) => {
      store.currentProjectId = e.target.value;
      touch();
      renderAll();
    });

    on("projectNameInput", "change", (e) => {
      getProject().name = e.target.value.trim() || "Unbenanntes Projekt";
      touch();
      renderProjectPicker();
    });

    on("newProjectBtn", "click", () => {
      const name = prompt("Name des neuen SIPOC-Prozesses:", "Neuer Prozess");
      if (name === null) return;
      const proj = blankProject(name.trim() || "Neuer Prozess");
      store.projects.push(proj);
      store.currentProjectId = proj.id;
      touch();
      renderAll();
      showToast("Projekt angelegt.");
    });

    on("duplicateProjectBtn", "click", () => {
      const p = JSON.parse(JSON.stringify(getProject()));
      p.id = uid("proj");
      p.name = p.name + " (Kopie)";
      // IDs neu vergeben, damit Kopie unabhängig ist
      const laneMap = new Map();
      p.lanes.forEach((l) => { const nid = uid("lane"); laneMap.set(l.id, nid); l.id = nid; });
      const stepMap = new Map();
      p.steps.forEach((s) => { const nid = uid("step"); stepMap.set(s.id, nid); s.id = nid; s.lane = laneMap.get(s.lane) || s.lane; });
      p.connections.forEach((c) => { c.id = uid("conn"); c.from = stepMap.get(c.from) || c.from; c.to = stepMap.get(c.to) || c.to; });
      p.steps.forEach((s) => { s.inputFrom = (s.inputFrom || []).map((q) => stepMap.get(q) || q); });
      store.projects.push(p);
      store.currentProjectId = p.id;
      touch();
      renderAll();
      showToast("Projekt dupliziert.");
    });

    on("deleteProjectBtn", "click", () => {
      if (store.projects.length <= 1) {
        showToast("Das letzte Projekt kann nicht gelöscht werden.", "warn");
        return;
      }
      const p = getProject();
      if (!confirm("Projekt „" + p.name + "“ inklusive aller Akteure, Schritte und Verbindungen löschen?")) return;
      store.projects = store.projects.filter((x) => x.id !== p.id);
      store.processLinks = getProcessLinks().filter((l) => l.fromProject !== p.id && l.toProject !== p.id);
      store.currentProjectId = store.projects[0].id;
      touch();
      renderAll();
      showToast("Projekt gelöscht.");
    });

    on("clearAllBtn", "click", () => {
      const totalSteps = store.projects.reduce((n, p) => n + p.steps.length, 0);
      const msg =
        "Wirklich ALLE " + store.projects.length + " Projekt(e) mit zusammen " + totalSteps +
        " Prozessschritt(en) unwiderruflich löschen (z. B. um das mitgelieferte Demoprojekt " +
        "zu entfernen und mit einem leeren Projekt zu starten)?\n\n" +
        "Betrifft die automatische Speicherung in diesem Browser sowie eine ggf. verknüpfte Datei.";
      if (!confirm(msg)) return;
      const fresh = blankProject("Neuer SIPOC-Prozess");
      store = { projects: [fresh], currentProjectId: fresh.id, processLinks: [] };
      ui.stepFilterLane = "";
      touch();
      renderAll();
      showToast("Alle Daten gelöscht — leeres Projekt angelegt.");
    });

    on("exportJsonBtn", "click", () => {
      const p = getProject();
      const filename = (p.name || "sipoc-projekt").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".sipoc.json";
      downloadFile(filename, JSON.stringify(p, null, 2), "application/json");
      showToast("Projekt als JSON exportiert.");
    });

    on("importJsonBtn", "click", () => {
      document.getElementById("importFileInput").click();
    });
    on("importFileInput", "change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.projects)) {
          // vollständiger Store
          parsed.projects.forEach((proj) => { if (!store.projects.some((p) => p.id === proj.id)) store.projects.push(proj); });
          (parsed.processLinks || []).forEach((l) => {
            if (!getProcessLinks().some((x) => x.id === l.id)) store.processLinks.push(l);
          });
          store.currentProjectId = parsed.currentProjectId || parsed.projects[0].id;
        } else if (parsed && parsed.id && Array.isArray(parsed.steps)) {
          // einzelnes Projekt
          if (store.projects.some((p) => p.id === parsed.id)) parsed.id = uid("proj");
          store.projects.push(parsed);
          store.currentProjectId = parsed.id;
        } else {
          throw new Error("Unbekanntes Format");
        }
        normalizeStore(store);
        touch();
        renderAll();
        showToast("Import erfolgreich.");
      } catch (err) {
        showToast("Import fehlgeschlagen: Datei ist kein gültiges SIPOC-Projekt.", "warn");
      }
    });

    on("linkFileBtn", "click", linkFile);
    on("downloadAppBtn", "click", openDownloadAppForm);

    on("copyAgentPromptBtn", "click", () => copyText(AGENT_PROMPT, "Prompt kopiert — im KI-Agenten einfügen."));
    on("downloadAgentPromptBtn", "click", () => {
      downloadFile("sipoc-agent-prompt.md", AGENT_PROMPT, "text/markdown;charset=utf-8");
      showToast("Prompt als Datei gespeichert.");
    });
    on("checkAgentBtn", "click", checkAgentInput);
    on("clearAgentInputBtn", "click", () => {
      const input = document.getElementById("agentInput");
      if (input) input.value = "";
      agentResult = null;
      renderAgentResult();
    });
    on("versionReloadBtn", "click", reloadFresh);
    on("updateReloadBtn", "click", reloadFresh);

    on("themeToggleBtn", "click", () => {
      const order = ["auto", "light", "dark"];
      ui.theme = order[(order.indexOf(ui.theme) + 1) % order.length];
      localStorage.setItem("sipocSwimlaneStudio.theme", ui.theme);
      applyTheme();
      showToast("Darstellung: " + ({ auto: "System", light: "Hell", dark: "Dunkel" }[ui.theme]));
    });

    on("toggleArtifactsBtn", "click", () => {
      ui.showArtifacts = !ui.showArtifacts;
      localStorage.setItem("sipocSwimlaneStudio.showArtifacts", ui.showArtifacts ? "1" : "0");
      renderDiagram();
      showToast(ui.showArtifacts
        ? "Artefakte werden an den Verbindungen angezeigt."
        : "Artefakte ausgeblendet.");
    });

    on("zoomInBtn", "click", () => { ui.zoom = Math.min(2.5, ui.zoom + 0.1); applyZoom(); });
    on("zoomOutBtn", "click", () => { ui.zoom = Math.max(0.15, ui.zoom - 0.1); applyZoom(); });
    on("zoomResetBtn", "click", fitZoom);

    on("exportDrawioBtn", "click", () => {
      const p = getProject();
      if (!p.steps.length) { showToast("Kein Diagramm zum Exportieren vorhanden.", "warn"); return; }
      const layout = currentLayout || computeLayout(p);
      const xml = buildDrawioXml(p, layout);
      const filename = (p.name || "swimlane").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".drawio.xml";
      downloadFile(filename, xml, "application/xml");
      showToast("draw.io-XML exportiert — in Confluence per „Diagramme (draw.io)“ → Datei importieren einfügen.");
    });

    on("copyXmlBtn", "click", async () => {
      const p = getProject();
      if (!p.steps.length) { showToast("Kein Diagramm vorhanden.", "warn"); return; }
      const layout = currentLayout || computeLayout(p);
      const xml = buildDrawioXml(p, layout);
      try {
        await navigator.clipboard.writeText(xml);
        showToast("draw.io-XML in die Zwischenablage kopiert.");
      } catch (e) {
        downloadFile("swimlane.drawio.xml", xml, "application/xml");
      }
    });

    window.addEventListener("resize", debounce(() => {
      if (ui.section === "diagram") fitZoom();
    }, 200));
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", ui.theme);
  }

  // Erkennt den Fall, dass Seitengerüst und Programmdatei aus unterschiedlichen
  // Ständen stammen (typisch: eine der beiden Dateien liegt noch im
  // Browser-Cache). Ohne diesen Hinweis fehlen Bedienelemente oder tun beim
  // Klick stillschweigend nichts.
  function checkVersion() {
    const label = document.getElementById("versionLabel");
    if (label) label.textContent = APP_VERSION;
    const meta = document.querySelector('meta[name="app-version"]');
    const pageVersion = meta ? meta.getAttribute("content") : null;
    if (pageVersion === APP_VERSION) return;
    console.warn(
      "[SIPOC Swimlane Studio] Versionskonflikt: Seite meldet " +
      (pageVersion || "keine Version") + ", Programmdatei ist " + APP_VERSION + "."
    );
    const warning = document.getElementById("versionWarning");
    if (warning) warning.classList.remove("hidden");
  }

  // Auch die Einstiegsseite selbst wird vom Hosting mit einer Verfallszeit
  // ausgeliefert. Wer die Seite offen hat oder kurz zuvor geladen hat, sieht
  // sonst beliebig lange einen alten Stand — ohne es zu merken, weil Seite und
  // Programmdatei dann gemeinsam veraltet und damit zueinander passend sind.
  // Deshalb wird die aktuelle Fassung direkt beim Anbieter erfragt.
  async function checkForUpdate() {
    if (location.protocol === "file:") return; // gebündelte Datei aktualisiert sich nicht selbst
    try {
      const res = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.version || data.version === APP_VERSION) return;
      const banner = document.getElementById("updateBanner");
      const label = document.getElementById("updateVersion");
      if (label) label.textContent = data.version;
      if (banner) banner.classList.remove("hidden");
      console.warn("[SIPOC Swimlane Studio] Neuere Fassung verfügbar: " + data.version + " (geladen: " + APP_VERSION + ")");
    } catch (e) { /* offline oder ohne version.json — dann bleibt es still */ }
  }

  // Erzwingt das Neuladen unter einer Adresse, die nicht im Zwischenspeicher
  // liegt; ein einfaches reload() würde erneut die alte Seite liefern.
  function reloadFresh() {
    const base = location.origin + location.pathname;
    location.replace(base + "?aktualisiert=" + Date.now());
  }

  /* -------------------------------------------------------------- Init */

  function init() {
    applyTheme();
    checkVersion();
    store = loadStore();
    if (!store.projects.some((p) => p.id === store.currentProjectId)) {
      store.currentProjectId = store.projects[0].id;
    }
    wireEvents();
    renderAll();
    tryRestoreFileHandle();
    checkForUpdate();
    // Lange offene Tabs bekommen eine Aktualisierung sonst nie mit.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkForUpdate();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

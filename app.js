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
  const APP_VERSION = "1.2.0";

  const STEP_TYPES = {
    start:    { label: "Start",         shape: "terminator", color: "var(--green)",  order: 0 },
    task:     { label: "Aufgabe",       shape: "rect",        color: "var(--accent)", order: 1 },
    decision: { label: "Entscheidung",  shape: "rhombus",     color: "var(--orange)", order: 2 },
    end:      { label: "Ende",          shape: "terminator",  color: "var(--red)",    order: 3 },
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

    return {
      id: uid("proj"),
      name: "Kreditorenrechnungsprüfung",
      updatedAt: Date.now(),
      lanes,
      steps,
      connections,
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
    zoom: 1,
    theme: localStorage.getItem("sipocSwimlaneStudio.theme") || "auto",
  };
  let fileHandle = null;  // FileSystemFileHandle, falls verknüpft

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.projects) && parsed.projects.length) {
          return parsed;
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
        if (parsed && Array.isArray(parsed.projects) && parsed.projects.length) return parsed;
      } catch (e) { /* fehlerhafter Bundle-Inhalt -> Beispielprojekt */ }
    }

    const seeded = seedProject();
    return { projects: [seeded], currentProjectId: seeded.id };
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
    touch();
    return true;
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

    const connsOut = conns.map((c) => ({
      id: c.id,
      from: c.from,
      to: c.to,
      label: c.label,
      isBackEdge: backEdgeIds.has(c.id),
    }));

    return { lanes: laneGeom, steps: stepsOut, stepById, connections: connsOut, width, height, maxDepth };
  }

  /* -------------------------------------------------------- SVG Rendering */

  function shapePath(type, x, y, w, h) {
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
      if (c.label) {
        // Label-Position: Mittelpunkt der Route grob am ersten horizontalen Segment
        const lx = c.isBackEdge ? (from.x + from.w / 2 + to.x + to.w / 2) / 2 : (from.x + from.w + to.x) / 2;
        const ly = c.isBackEdge ? Math.max(from.y + from.h, to.y + to.h) + 26 + dedupeIndex * 16 : (from.y + from.h / 2 + to.y + to.h / 2) / 2;
        const lw = Math.max(28, c.label.length * 6.4 + 14);
        parts.push(`<rect x="${lx - lw / 2}" y="${ly - 10}" width="${lw}" height="20" rx="10" fill="var(--bg-elevated)" stroke="var(--separator)"></rect>`);
        parts.push(`<text x="${lx}" y="${ly + 4}" font-size="10.5" font-weight="600" text-anchor="middle" fill="var(--text-secondary)">${escapeXml(c.label)}</text>`);
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
      if (s.type === "decision") {
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
      cells.push(
        `<mxCell id="${c.id}" value="${escapeXml(c.label || "")}" style="${style}" edge="1" parent="1" source="${c.from}" target="${c.to}">` +
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
        renderLanes(); renderStepFilter(); renderSteps(); renderDiagramIfActive();
      },
      onDelete: lane ? () => {
        if (!confirm("Akteur „" + lane.name + "“ wirklich löschen?")) return false;
        const ok = deleteLane(lane.id);
        if (ok) { renderLanes(); renderStepFilter(); renderSteps(); renderDiagramIfActive(); }
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

  function renderSteps() {
    const p = getProject();
    const list = document.getElementById("stepList");
    const filter = document.getElementById("stepFilterLane").value;
    let steps = p.steps.slice();
    if (filter) steps = steps.filter((s) => s.lane === filter);

    if (!p.steps.length) {
      list.innerHTML = `<div class="list-row"><div class="list-row-main"><div class="list-row-sub">Noch keine Prozessschritte erfasst. Lege zuerst Akteure an, dann Schritte mit Supplier, Input, Process, Output und Customer.</div></div></div>`;
      return;
    }
    if (!steps.length) {
      list.innerHTML = `<div class="list-row"><div class="list-row-main"><div class="list-row-sub">Kein Schritt für diesen Akteur.</div></div></div>`;
      return;
    }

    list.innerHTML = steps.map((s, i) => {
      const lane = getLane(s.lane);
      const meta = STEP_TYPES[s.type] || STEP_TYPES.task;
      const sipoc = [
        s.supplier ? `<strong>Supplier:</strong> ${escapeHtml(s.supplier)}` : "",
        s.input ? `<strong>Input:</strong> ${escapeHtml(s.input)}` : "",
        s.output ? `<strong>Output:</strong> ${escapeHtml(s.output)}` : "",
        s.customer ? `<strong>Customer:</strong> ${escapeHtml(s.customer)}` : "",
      ].filter(Boolean).join(" · ");
      return `<div class="list-row" data-step-id="${s.id}">
        <span class="list-row-order">${i + 1}</span>
        <div class="list-row-main">
          <div class="list-row-title-line">
            <span class="list-row-title">${escapeHtml(s.name)}</span>
            <span class="badge"><span class="badge-dot" style="background:${meta.color}"></span>${meta.label}</span>
            ${lane ? `<span class="badge"><span class="badge-dot" style="background:${lane.color}"></span>${escapeHtml(lane.name)}</span>` : `<span class="badge">Ohne Akteur</span>`}
          </div>
          ${sipoc ? `<div class="list-row-sub">${sipoc}</div>` : ""}
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll(".list-row[data-step-id]").forEach((row) => {
      row.addEventListener("click", () => openStepForm(getStep(row.dataset.stepId)));
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
      fieldText("output", "Output", step ? step.output : "") +
      fieldText("customer", "Customer (Empfänger des Outputs)", step ? step.customer : "") +
      `</div>` +
      fieldTextarea("description", "Beschreibung", step ? step.description : "");

    openPanel(step ? "Prozessschritt bearbeiten" : "Neuer Prozessschritt", fields, {
      submitLabel: step ? "Speichern" : "Anlegen",
      onSubmit: (data) => {
        if (step) updateStep(step.id, data); else addStep(data);
        renderSteps(); renderConnections(); renderDiagramIfActive();
      },
      onDelete: step ? () => {
        if (!confirm("Prozessschritt „" + step.name + "“ wirklich löschen?")) return false;
        const ok = deleteStep(step.id);
        if (ok) { renderSteps(); renderConnections(); renderDiagramIfActive(); }
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
    if (section === "sipoc") { renderStepFilter(); renderSteps(); }
    if (section === "lanes") renderLanes();
    if (section === "connections") renderConnections();
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

    on("stepFilterLane", "change", renderSteps);

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
      store = { projects: [fresh], currentProjectId: fresh.id };
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
          store.currentProjectId = parsed.currentProjectId || parsed.projects[0].id;
        } else if (parsed && parsed.id && Array.isArray(parsed.steps)) {
          // einzelnes Projekt
          if (store.projects.some((p) => p.id === parsed.id)) parsed.id = uid("proj");
          store.projects.push(parsed);
          store.currentProjectId = parsed.id;
        } else {
          throw new Error("Unbekanntes Format");
        }
        touch();
        renderAll();
        showToast("Import erfolgreich.");
      } catch (err) {
        showToast("Import fehlgeschlagen: Datei ist kein gültiges SIPOC-Projekt.", "warn");
      }
    });

    on("linkFileBtn", "click", linkFile);
    on("downloadAppBtn", "click", openDownloadAppForm);
    on("versionReloadBtn", "click", () => location.reload());

    on("themeToggleBtn", "click", () => {
      const order = ["auto", "light", "dark"];
      ui.theme = order[(order.indexOf(ui.theme) + 1) % order.length];
      localStorage.setItem("sipocSwimlaneStudio.theme", ui.theme);
      applyTheme();
      showToast("Darstellung: " + ({ auto: "System", light: "Hell", dark: "Dunkel" }[ui.theme]));
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

    window.addEventListener("resize", debounce(() => { if (ui.section === "diagram") fitZoom(); }, 200));
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
  }

  document.addEventListener("DOMContentLoaded", init);
})();

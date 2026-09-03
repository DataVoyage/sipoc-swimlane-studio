// Fachlicher Smoke-Test für SIPOC Swimlane Studio.
//
// Deckt die in docs/vorgaenge.md als "✅ manuell verifiziert" markierten
// Vorgänge automatisiert ab (per Playwright/Chromium gegen die statische
// index.html, ohne Server). Kein Bestandteil der App selbst — nur für
// Mitarbeitende, die an diesem Repository weiterentwickeln.
//
// Ausführen:
//   npm install
//   npx playwright install --with-deps chromium   (einmalig)
//   npm test

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import http from "http";
import os from "os";
import { fileURLToPath } from "url";
import { cases as agentCases, gutesBeispiel as agentGoodExample } from "./agent-cases.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = "file://" + path.resolve(__dirname, "..", "index.html");

const results = {};
function ok(key, cond, note) {
  results[key] = { pass: !!cond, note: note || "" };
}

const browser = await chromium.launch();
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push("PAGEERROR: " + e.message));
page.on("console", (msg) => { if (msg.type() === "error") jsErrors.push("CONSOLE: " + msg.text()); });
page.on("dialog", async (d) => {
  if (d.type() === "prompt") await d.accept("Leerprojekt-Test");
  else await d.accept();
});

// Seltener genutzte Aktionen liegen im Aktionsmenü der Kopfzeile.
async function openMenu() {
  await page.click("#moreMenuBtn");
  await page.waitForTimeout(120);
}
async function menuClick(id) {
  await openMenu();
  await page.click("#" + id);
  await page.waitForTimeout(180);
}

await page.goto(url);
await page.waitForTimeout(300);

// --- AP1 Projektverwaltung -------------------------------------------------

ok("1.1", (await page.locator("#stepList .list-row[data-step-id]").count()) === 13, "Beispielprojekt beim ersten Start");

await page.click('.nav-item[data-section="lanes"]');
await page.click("#newLaneBtn");
await page.fill("#f_name", "QS-Testakteur");
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(250);
await page.reload();
await page.waitForTimeout(300);
await page.click('.nav-item[data-section="lanes"]');
await page.waitForTimeout(150);
const laneNamesAfterReload = await page.locator("#laneList .list-row-title").allTextContents();
ok("1.2", laneNamesAfterReload.includes("QS-Testakteur"), "Autosave übersteht Reload");

await page.fill("#projectNameInput", "Kreditorenrechnungsprüfung (Test)");
await page.locator("#projectNameInput").dispatchEvent("change");
await page.waitForTimeout(150);
ok("1.4", (await page.locator("#projectSelect option:checked").textContent()).includes("Test"), "Projekt umbenennen");
await page.fill("#projectNameInput", "Kreditorenrechnungsprüfung");
await page.locator("#projectNameInput").dispatchEvent("change");

const projCountBefore = await page.locator("#projectSelect option").count();
await menuClick("duplicateProjectBtn");
await page.waitForTimeout(150);
ok("1.5", (await page.locator("#projectSelect option").count()) === projCountBefore + 1, "Projekt duplizieren");

const firstVal = await page.locator("#projectSelect option").first().getAttribute("value");
await page.selectOption("#projectSelect", firstVal);
await page.waitForTimeout(150);
ok("1.8", true, "Projekt wechseln ohne Fehler");

const beforeDel = await page.locator("#projectSelect option").count();
await menuClick("deleteProjectBtn");
await page.waitForTimeout(200);
ok("1.6", (await page.locator("#projectSelect option").count()) === beforeDel - 1, "Projekt löschen");

while ((await page.locator("#projectSelect option").count()) > 1) {
  await menuClick("deleteProjectBtn");
  await page.waitForTimeout(150);
}
await menuClick("deleteProjectBtn");
await page.waitForTimeout(200);
ok("1.7", (await page.locator("#toast").textContent()).includes("letzte"), "Letztes Projekt nicht löschbar");
ok("1.7b", (await page.locator("#projectSelect option").count()) === 1);

await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(300);

// --- AP2 Akteure -------------------------------------------------------

await page.click('.nav-item[data-section="lanes"]');
await page.click("#newLaneBtn");
await page.fill("#f_name", "Ohne Beschreibung");
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(150);
const laneRowText = await page.locator("#laneList .list-row", { hasText: "Ohne Beschreibung" }).innerText();
ok("2.2", !laneRowText.includes("undefined"), "Akteur ohne Beschreibung");

await page.locator("#laneList .list-row", { hasText: "Ohne Beschreibung" }).click();
await page.fill("#f_name", "Umbenannter Akteur");
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(150);
ok("2.3", (await page.locator("#laneList .list-row-title", { hasText: "Umbenannter Akteur" }).count()) > 0, "Akteur bearbeiten");

const beforeOrder = await page.locator("#laneList .list-row-title").allTextContents();
await page.locator("#laneList .list-row", { hasText: "Umbenannter Akteur" }).locator(".lane-up").click();
await page.waitForTimeout(150);
const afterOrder = await page.locator("#laneList .list-row-title").allTextContents();
ok("2.4", JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder), "Reihenfolge ändern");

await page.locator("#laneList .list-row", { hasText: "Rechnungseingang" }).click();
await page.waitForTimeout(100);
await page.click("#panelDeleteBtn");
await page.waitForTimeout(200);
const toastLaneInUse = await page.locator("#toast").textContent();
ok("2.6", toastLaneInUse.includes("kann nicht gelöscht werden"), "Akteur in Verwendung nicht löschbar");
await page.keyboard.press("Escape");

await page.locator("#laneList .list-row", { hasText: "Umbenannter Akteur" }).click();
await page.waitForTimeout(100);
await page.click("#panelDeleteBtn");
await page.waitForTimeout(200);
ok("2.5", (await page.locator("#laneList .list-row-title", { hasText: "Umbenannter Akteur" }).count()) === 0, "Unbenutzten Akteur löschen");

// --- AP3 Prozessschritte ------------------------------------------------

await page.click("#newProjectBtn");
await page.waitForTimeout(200);
await page.click('.nav-item[data-section="sipoc"]');
await page.click("#newStepBtn");
await page.waitForTimeout(150);
ok("3.5", (await page.locator("#toast").textContent()).includes("Akteur"), "Schritt ohne Akteur verhindert");

await page.click('.nav-item[data-section="lanes"]');
await page.click("#newLaneBtn");
await page.fill("#f_name", "Testrolle");
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(150);

await page.click('.nav-item[data-section="sipoc"]');
async function addStep(name, type, extra) {
  await page.click("#newStepBtn");
  await page.fill("#f_name", name);
  await page.click(`label[for="f_type_${type}"]`);
  if (extra) for (const [k, v] of Object.entries(extra)) await page.fill("#f_" + k, v);
  await page.click("#panelForm button[type=submit]");
  await page.waitForTimeout(120);
}
await addStep("Schritt Start", "start");
await addStep("Schritt Aufgabe", "task", { supplier: "S", input: "I", output: "O", customer: "C" });
await addStep("Schritt Entscheidung", "decision");
await addStep("Schritt Ende", "end");

const badges = await page.locator("#stepList .list-row").allInnerTexts();
ok("3.1", badges.some((t) => t.includes("Schritt Start") && t.includes("Start")));
ok("3.2", badges.some((t) => t.includes("Schritt Aufgabe") && t.includes("Aufgabe")));
ok("3.3", badges.some((t) => t.includes("Schritt Entscheidung") && t.includes("Entscheidung")));
ok("3.4", badges.some((t) => t.includes("Schritt Ende") && t.includes("Ende")));
ok("3.6", badges.some((t) => t.includes("Supplier: S") && t.includes("Customer: C")));
ok("3.7", badges.some((t) => t.includes("Schritt Start") && !t.includes("Supplier:")));

await page.click("#newStepBtn");
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(100);
ok("3.8", (await page.locator("#panel.hidden").count()) === 0, "Pflichtfeld Name blockiert Absenden");
await page.click("#panelClose");

await page.selectOption("#stepFilterLane", { label: "Testrolle" });
await page.waitForTimeout(100);
ok("3.10", (await page.locator("#stepList .list-row[data-step-id]").count()) === 4, "Filter nach Akteur");
await page.selectOption("#stepFilterLane", "");

// --- AP4 Verbindungen ----------------------------------------------------

await page.click('.nav-item[data-section="connections"]');
await page.click("#newConnectionBtn");
const stepIds = await page.locator("#f_from option").evaluateAll((opts) => opts.map((o) => o.value));
await page.selectOption("#f_from", stepIds[0]);
await page.selectOption("#f_to", stepIds[0]);
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(150);
ok("4.3", (await page.locator("#toast").textContent()).includes("nicht mit sich selbst"), "Selbstverbindung verhindert");
await page.click("#panelClose");

await page.click("#newConnectionBtn");
await page.selectOption("#f_from", stepIds[0]);
await page.selectOption("#f_to", stepIds[1]);
await page.fill("#f_label", "Ja");
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(150);
ok("4.1_4.2", (await page.locator("#connectionList .list-row").count()) === 1, "Verbindung mit Label anlegen");

await page.click("#newConnectionBtn");
await page.selectOption("#f_from", stepIds[0]);
await page.selectOption("#f_to", stepIds[1]);
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(150);
ok("4.4", (await page.locator("#toast").textContent()).includes("existiert bereits"), "Duplikat verhindert");
await page.click("#panelClose");

await page.locator("#connectionList .list-row").first().click();
await page.fill("#f_label", "Geändert");
await page.click("#panelForm button[type=submit]");
await page.waitForTimeout(150);
ok("4.5", (await page.locator("#connectionList .list-row .badge").first().textContent()).includes("Geändert"), "Verbindung bearbeiten");

await page.locator("#connectionList .list-row").first().click();
await page.click("#panelDeleteBtn");
await page.waitForTimeout(150);
ok("4.6", (await page.locator("#connectionList .list-row[data-conn-id]").count()) === 0, "Verbindung löschen");

// --- AP5 Diagramm & Export ------------------------------------------------

await page.click('.nav-item[data-section="diagram"]');
await page.waitForTimeout(200);
ok("5.2", (await page.locator("#diagramCanvasWrapper svg").count()) === 1, "Diagramm rendert");

const zoomBefore = await page.locator("#zoomLabel").textContent();
await page.click("#zoomInBtn");
await page.waitForTimeout(80);
ok("5.4", zoomBefore !== (await page.locator("#zoomLabel").textContent()), "Zoom-Buttons wirken");

await page.click('.nav-item[data-section="sipoc"]');
let stepRows = await page.locator("#stepList .list-row[data-step-id]").count();
while (stepRows > 0) {
  await page.locator("#stepList .list-row[data-step-id]").first().click();
  await page.click("#panelDeleteBtn");
  await page.waitForTimeout(120);
  stepRows = await page.locator("#stepList .list-row[data-step-id]").count();
}
await page.click('.nav-item[data-section="diagram"]');
await page.waitForTimeout(150);
ok("5.1", (await page.locator("#diagramEmpty:not(.hidden)").count()) === 1, "Leerzustand ohne Schritte");

// draw.io-XML-Struktur anhand des Beispielprojekts prüfen
await page.goto(url);
await page.waitForTimeout(300);
await page.selectOption("#projectSelect", { label: "Kreditorenrechnungsprüfung" });
await page.waitForTimeout(150);
await page.click('.nav-item[data-section="diagram"]');
await page.waitForTimeout(300);
const [xmlDownload] = await Promise.all([page.waitForEvent("download"), page.click("#exportDrawioBtn")]);
const xmlPath = await xmlDownload.path();
const xml = fs.readFileSync(xmlPath, "utf8");
ok("5.6a", xml.includes("<mxfile"), "draw.io-Export enthält mxfile-Wurzel");
ok("5.6b", xml.includes("swimlane;horizontal=0"), "draw.io-Export enthält Swimlane-Container je Akteur");
ok("5.6c", xml.includes("rhombus"), "draw.io-Export stellt Entscheidungen als Raute dar");
ok("5.6d", xml.includes('value="Nein"'), "draw.io-Export übernimmt Kantenbeschriftungen");
const xmlParse = await page.evaluate((xmlStr) => {
  const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
  const err = doc.getElementsByTagName("parsererror");
  return { ok: err.length === 0, cellCount: doc.getElementsByTagName("mxCell").length };
}, xml);
ok("5.6e", xmlParse.ok && xmlParse.cellCount > 0, "draw.io-Export ist wohlgeformtes XML (" + xmlParse.cellCount + " mxCell)");

// --- AP6 Persistenz & Datenaustausch --------------------------------------

await page.click('.nav-item[data-section="sipoc"]');
fs.writeFileSync("/tmp/sipoc-smoke-bad-import.json", JSON.stringify({ nope: true }));
await page.setInputFiles("#importFileInput", "/tmp/sipoc-smoke-bad-import.json");
await page.waitForTimeout(200);
ok("6.7", (await page.locator("#toast").textContent()).includes("fehlgeschlagen"), "Ungültiger Import wird abgewiesen");

await openMenu();
const [jsonDownload] = await Promise.all([page.waitForEvent("download"), page.click("#exportJsonBtn")]);
const jsonPath = await jsonDownload.path();
const projCountBeforeImport = await page.locator("#projectSelect option").count();
await menuClick("importJsonBtn");
await page.setInputFiles("#importFileInput", jsonPath);
await page.waitForTimeout(300);
ok("6.4_6.5", (await page.locator("#projectSelect option").count()) === projCountBeforeImport + 1, "Export/Import-Rundlauf Einzelprojekt");

const multiStore = { projects: [{ id: "proj-smoke-extra", name: "Import-Test A", lanes: [], steps: [], connections: [] }], currentProjectId: "proj-smoke-extra" };
fs.writeFileSync("/tmp/sipoc-smoke-multi-import.json", JSON.stringify(multiStore));
const beforeMulti = await page.locator("#projectSelect option").count();
await menuClick("importJsonBtn");
await page.setInputFiles("#importFileInput", "/tmp/sipoc-smoke-multi-import.json");
await page.waitForTimeout(300);
ok("6.6", (await page.locator("#projectSelect option").count()) === beforeMulti + 1, "Import eines Gesamt-Datenbestands");

// --- AP7 Darstellung -------------------------------------------------------

await page.click("#themeToggleBtn"); // auto -> hell
await page.click("#themeToggleBtn"); // hell -> dunkel
await page.waitForTimeout(100);
const themeBefore = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
await page.reload();
await page.waitForTimeout(200);
const themeAfter = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
ok("7.1", themeBefore === themeAfter && themeBefore === "dark", "Darstellung bleibt nach Reload erhalten");

await page.setViewportSize({ width: 500, height: 800 });
await page.waitForTimeout(150);
const sidebarWidth = await page.evaluate(() => document.querySelector(".sidebar").getBoundingClientRect().width);
ok("7.2", sidebarWidth < 100, "Seitenleiste reagiert auf schmalen Viewport");

// --- AP1 (Fortsetzung) — Alle Daten löschen --------------------------------

// Ausgangslage herstellen: mehrere Projekte mit Inhalt vorhanden (aus den
// vorherigen Abschnitten: mind. das befüllte Beispielprojekt sowie die
// Import-Testprojekte).
await page.click('.nav-item[data-section="sipoc"]');
const projectsBeforeClear = await page.locator("#projectSelect option").count();
ok("1.9_vorbedingung", projectsBeforeClear > 1, projectsBeforeClear + " Projekte vor dem Löschen");

await menuClick("clearAllBtn");
await page.waitForTimeout(250);
const projectsAfterClear = await page.locator("#projectSelect option").count();
ok("1.9a", projectsAfterClear === 1, "genau ein Projekt nach „Alle Daten löschen“");
ok("1.9b", (await page.locator("#stepList .list-row[data-step-id]").count()) === 0, "keine Prozessschritte mehr vorhanden");

await page.click('.nav-item[data-section="lanes"]');
ok("1.9c", (await page.locator("#laneList .list-row[data-lane-id]").count()) === 0, "keine Akteure mehr vorhanden");

await page.reload();
await page.waitForTimeout(300);
ok("1.9d", (await page.locator("#projectSelect option").count()) === 1, "leerer Zustand übersteht Reload (Autosave)");

// --- AP8 Auslieferung & Robustheit ------------------------------------------
//
// Diese Vorgänge brauchen die App über HTTP (wie auf GitHub Pages), weil sich
// Dateien per file:// aus Sicherheitsgründen nicht nachladen lassen.

const repoRoot = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(repoRoot, rel);
  if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("nicht gefunden"); return;
  }
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
  res.writeHead(200, { "Content-Type": (types[path.extname(file)] || "application/octet-stream") + "; charset=utf-8" });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const httpUrl = `http://127.0.0.1:${server.address().port}/index.html`;

// 8.1 — App über HTTP als Standalone-Datei herunterladen
const httpPage = await browser.newPage();
const httpErrors = [];
httpPage.on("pageerror", (e) => httpErrors.push("PAGEERROR: " + e.message));
await httpPage.goto(httpUrl);
await httpPage.waitForTimeout(400);
await httpPage.click("#moreMenuBtn");
await httpPage.waitForTimeout(150);
await httpPage.click("#downloadAppBtn");
await httpPage.waitForTimeout(250);
ok("8.1a", (await httpPage.locator("#panel:not(.hidden)").count()) === 1, "Auswahl für den App-Download öffnet sich");
const [appDownload] = await Promise.all([
  httpPage.waitForEvent("download"),
  httpPage.click("#panelForm button[type=submit]"),
]);
const standaloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "sipoc-standalone-"));
const standalonePath = path.join(standaloneDir, "sipoc-swimlane-studio.html");
await appDownload.saveAs(standalonePath);
const standaloneHtml = fs.readFileSync(standalonePath, "utf8");
ok("8.1b", !/<link[^>]+rel="stylesheet"/.test(standaloneHtml) && standaloneHtml.includes("<style>"), "Gestaltung ist eingebettet");
ok("8.1c", !/<script[^>]+src=/.test(standaloneHtml), "kein externes Skript mehr referenziert");
ok("8.1d", standaloneHtml.includes('id="bundledData"'), "aktuelle Daten sind eingebettet");

// 8.1e/f — die übrigen Inhaltsvarianten des Downloads
async function downloadVariant(value) {
  await httpPage.click("#moreMenuBtn");
  await httpPage.waitForTimeout(150);
  await httpPage.click("#downloadAppBtn");
  await httpPage.waitForTimeout(250);
  await httpPage.selectOption("#f_content", value);
  const [d] = await Promise.all([
    httpPage.waitForEvent("download"),
    httpPage.click("#panelForm button[type=submit]"),
  ]);
  return fs.readFileSync(await d.path(), "utf8");
}
const exampleVariant = await downloadVariant("example");
ok("8.1e", !exampleVariant.includes('id="bundledData"') && exampleVariant.includes("<style>"),
  "Variante „Beispielprojekt“ enthält keine übernommenen Daten");
const emptyVariant = await downloadVariant("empty");
const emptyMatch = /id="bundledData"[^>]*>([\s\S]*?)<\/script>/.exec(emptyVariant);
const emptyStore = emptyMatch ? JSON.parse(emptyMatch[1].replace(/\\u003c/g, "<")) : null;
ok("8.1f", !!emptyStore && emptyStore.projects.length === 1 && emptyStore.projects[0].steps.length === 0,
  "Variante „Leer starten“ enthält genau ein leeres Projekt");

// 8.2 — heruntergeladene Datei läuft eigenständig per file://
const standalonePage = await browser.newPage();
const standaloneErrors = [];
standalonePage.on("pageerror", (e) => standaloneErrors.push("PAGEERROR: " + e.message));
standalonePage.on("console", (m) => { if (m.type() === "error") standaloneErrors.push("CONSOLE: " + m.text()); });
await standalonePage.goto("file://" + standalonePath);
await standalonePage.waitForTimeout(500);
ok("8.2a", (await standalonePage.locator("#stepList .list-row[data-step-id]").count()) === 13, "übernommene Daten sind vorhanden");
const sidebarBg = await standalonePage.evaluate(() => getComputedStyle(document.querySelector(".sidebar")).backgroundColor);
ok("8.2b", sidebarBg !== "rgba(0, 0, 0, 0)" && sidebarBg !== "", "eingebettete Gestaltung greift (" + sidebarBg + ")");
ok("8.2c", (await standalonePage.locator("#versionWarning:not(.hidden)").count()) === 0, "keine Versionswarnung in der gebündelten Datei");
await standalonePage.click('.nav-item[data-section="diagram"]');
await standalonePage.waitForTimeout(400);
const [standaloneXml] = await Promise.all([
  standalonePage.waitForEvent("download"),
  standalonePage.click("#exportDrawioBtn"),
]);
const standaloneXmlText = fs.readFileSync(await standaloneXml.path(), "utf8");
ok("8.2d", standaloneXmlText.includes("<mxfile"), "draw.io-Export funktioniert auch offline");
ok("8.2e", standaloneErrors.length === 0, standaloneErrors.join(" | ") || "keine JS-Fehler offline");

// 8.3 — aus der gebündelten Datei heraus erneut bündeln (ohne Nachladen)
await standalonePage.click("#moreMenuBtn");
await standalonePage.waitForTimeout(150);
await standalonePage.click("#downloadAppBtn");
await standalonePage.waitForTimeout(200);
const [secondGen] = await Promise.all([
  standalonePage.waitForEvent("download"),
  standalonePage.click("#panelForm button[type=submit]"),
]);
const secondGenHtml = fs.readFileSync(await secondGen.path(), "utf8");
ok("8.3", secondGenHtml.includes("<style>") && !/<script[^>]+src=/.test(secondGenHtml), "gebündelte Datei kann sich selbst weitergeben");

// 8.4 — Versionskonflikt (veralteter Browser-Cache) wird sichtbar gemeldet
const conflictPage = await browser.newPage();
const appJsSource = fs.readFileSync(path.join(repoRoot, "app.js"), "utf8");
await conflictPage.route("**/app.js*", (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: appJsSource.replace(/const APP_VERSION = "[^"]+"/, 'const APP_VERSION = "9.9.9-test"'),
  })
);
await conflictPage.goto(httpUrl);
await conflictPage.waitForTimeout(400);
ok("8.4", (await conflictPage.locator("#versionWarning:not(.hidden)").count()) === 1, "Warnung bei nicht zusammenpassenden Dateiständen");

// 8.5 — fehlendes Bedienelement legt die übrige App nicht lahm
const robustPage = await browser.newPage();
const indexSource = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
await robustPage.route(/\/index\.html(\?.*)?$/, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: indexSource.replace('id="clearAllBtn"', 'id="clearAllBtn-fehlt-absichtlich"'),
  })
);
await robustPage.goto(httpUrl);
await robustPage.waitForTimeout(400);
const robustSteps = await robustPage.locator("#stepList .list-row[data-step-id]").count();
await robustPage.click("#themeToggleBtn");
await robustPage.waitForTimeout(150);
const robustTheme = await robustPage.evaluate(() => document.documentElement.getAttribute("data-theme"));
ok("8.5", robustSteps === 13 && robustTheme !== "auto", "App bleibt bedienbar (" + robustSteps + " Schritte, Theme " + robustTheme + ")");

await httpPage.close();
await standalonePage.close();
await conflictPage.close();
await robustPage.close();
fs.rmSync(standaloneDir, { recursive: true, force: true });
// Der HTTP-Server bleibt für die Zwischenablage-Prüfungen in AP9 bestehen.

// --- Nachträge zu AP3/AP5 (eigene Sitzung auf dem Beispielprojekt) -----------

const extraPage = await browser.newPage();
extraPage.on("dialog", (d) => d.accept());
await extraPage.goto(url);
await extraPage.waitForTimeout(300);
await extraPage.evaluate(() => localStorage.clear());
await extraPage.reload();
await extraPage.waitForTimeout(400);

// 3.9 — Schritt bearbeiten, inklusive Typwechsel
await extraPage.locator("#stepList .list-row", { hasText: "Rechnung im Finanzsystem anlegen" }).click();
await extraPage.waitForTimeout(150);
await extraPage.fill("#f_name", "Rechnungsbeleg erfassen");
await extraPage.click('label[for="f_type_decision"]');
await extraPage.click("#panelForm button[type=submit]");
await extraPage.waitForTimeout(250);
const editedRow = await extraPage.locator("#stepList .list-row", { hasText: "Rechnungsbeleg erfassen" }).innerText();
ok("3.9", editedRow.includes("Entscheidung"), "Name und Typ übernommen");

// 3.12 — Schritt mit bestehenden Verbindungen löschen entfernt auch diese
await extraPage.click('.nav-item[data-section="connections"]');
await extraPage.waitForTimeout(200);
const connBefore = await extraPage.locator("#connectionList .list-row[data-conn-id]").count();
await extraPage.click('.nav-item[data-section="sipoc"]');
await extraPage.locator("#stepList .list-row", { hasText: "Rechnungsbeleg erfassen" }).click();
await extraPage.waitForTimeout(150);
await extraPage.click("#panelDeleteBtn");
await extraPage.waitForTimeout(300);
await extraPage.click('.nav-item[data-section="connections"]');
await extraPage.waitForTimeout(200);
const connAfter = await extraPage.locator("#connectionList .list-row[data-conn-id]").count();
ok("3.12", connAfter === connBefore - 3 &&
  (await extraPage.locator("#stepList .list-row", { hasText: "Rechnungsbeleg erfassen" }).count()) === 0,
  `Schritt entfernt, Verbindungen ${connBefore} → ${connAfter}`);

// 5.5 — „Einpassen“ nach Fenstergrößenänderung
await extraPage.setViewportSize({ width: 1400, height: 900 });
await extraPage.click('.nav-item[data-section="diagram"]');
await extraPage.waitForTimeout(500);
const zoomWide = await extraPage.locator("#zoomLabel").textContent();
await extraPage.setViewportSize({ width: 760, height: 700 });
await extraPage.waitForTimeout(700); // Resize ist entprellt
const zoomNarrow = await extraPage.locator("#zoomLabel").textContent();
ok("5.5", parseInt(zoomNarrow, 10) < parseInt(zoomWide, 10),
  `Zoom passt sich an: ${zoomWide} → ${zoomNarrow}`);
await extraPage.close();

// --- AP9 Import vom Agent ----------------------------------------------------

const agentPage = await browser.newPage();
const agentErrors = [];
agentPage.on("pageerror", (e) => agentErrors.push("PAGEERROR: " + e.message));
agentPage.on("console", (m) => { if (m.type() === "error") agentErrors.push("CONSOLE: " + m.text()); });
await agentPage.goto(url);
await agentPage.waitForTimeout(300);
await agentPage.evaluate(() => localStorage.clear());
await agentPage.reload();
await agentPage.waitForTimeout(300);
await agentPage.click('.nav-item[data-section="agent"]');
await agentPage.waitForTimeout(250);

async function checkAgentInput(text) {
  await agentPage.fill("#agentInput", text);
  await agentPage.click("#checkAgentBtn");
  await agentPage.waitForTimeout(90);
  return {
    report: await agentPage.locator(".agent-report pre").textContent(),
    accepted: (await agentPage.locator("#importAgentBtn").count()) > 0,
  };
}

ok("9.1", (await agentPage.locator("#agentPromptText").textContent()).includes("sipoc-swimlane-studio/agent-import"),
  "Prompt mit Formatbeschreibung wird angezeigt");

// 9.2 — Prompt als Datei speichern
const [promptDownload] = await Promise.all([
  agentPage.waitForEvent("download"),
  agentPage.click("#downloadAgentPromptBtn"),
]);
const promptFile = fs.readFileSync(await promptDownload.path(), "utf8");
ok("9.2", promptDownload.suggestedFilename().endsWith(".md") && promptFile.includes("## Felder im Einzelnen"),
  "Prompt wird als Datei gespeichert (" + promptDownload.suggestedFilename() + ")");

// 9.2 — jeder Fall der Sammlung führt zum erwarteten Urteil und zur passenden Aussage
let caseFailures = [];
for (const c of agentCases) {
  const { report, accepted } = await checkAgentInput(c.input);
  const verdictMatches = accepted === c.expectOk;
  const textMatches = c.expect.some((snippet) => report.includes(snippet));
  const noFollowUp = !(c.expectNot || []).some((snippet) => report.includes(snippet));
  if (!verdictMatches || !textMatches || !noFollowUp) {
    caseFailures.push(c.name + (!verdictMatches ? " (falsches Urteil)" : !textMatches ? " (Aussage fehlt)" : " (unerwünschte Folgemeldung)"));
  }
}
ok("9.5-9.9", caseFailures.length === 0,
  caseFailures.length ? "fehlgeschlagen: " + caseFailures.join("; ") : agentCases.length + " Antwortvarianten korrekt beurteilt");

// 9.3 — das im Prompt gezeigte Beispiel muss selbst fehlerfrei durchlaufen
const promptText = await agentPage.locator("#agentPromptText").textContent();
const exampleStart = promptText.indexOf("{", promptText.indexOf("## Vollständiges Beispiel"));
const exampleEnd = promptText.indexOf("## Wenn du eine Fehlermeldung", exampleStart);
const promptExample = promptText.slice(exampleStart, exampleEnd).trim();
const exampleResult = await checkAgentInput(promptExample);
ok("9.3", exampleResult.accepted && !exampleResult.report.includes("ZU BEHEBEN"),
  "Beispiel im Prompt erfüllt die eigenen Vorgaben ohne Beanstandung");

// 9.4 — Fehlerbericht ist als Arbeitsauftrag formuliert und nennt Fundstellen
const brokenResult = await checkAgentInput(JSON.stringify({
  format: "sipoc-swimlane-studio/agent-import",
  project: { name: "Unvollständig" },
  lanes: [{ name: "Fachbereich" }],
  steps: [{ key: "a", name: "Prüfen", lane: "Einkauf", type: "aufgabe" }],
  connections: [{ from: "a", to: "b" }],
}));
ok("9.4a", !brokenResult.accepted, "fehlerhafte Antwort wird nicht zum Import freigegeben");
ok("9.4b",
  brokenResult.report.includes("ZU BEHEBEN") &&
  brokenResult.report.includes("Fundstelle") &&
  brokenResult.report.includes("Korrektur:") &&
  brokenResult.report.includes("VOLLSTÄNDIGE"),
  "Bericht nennt Fundstelle, Korrektur und fordert vollständige Neuausgabe");
ok("9.4c", brokenResult.report.includes("steps[0].lane") && brokenResult.report.includes("Definierte Akteure"),
  "unbekannter Akteur wird mit Fundstelle und Auswahlliste gemeldet");
ok("9.4d", brokenResult.report.includes('"b" kommt in steps nicht vor'),
  "unbekannter Verbindungsschlüssel wird gemeldet");

// 9.5 — gültige Antwort lässt sich als neues Projekt übernehmen
await checkAgentInput(agentGoodExample);
await agentPage.click("#importAgentBtn");
await agentPage.waitForTimeout(400);
const importedName = await agentPage.locator("#projectNameInput").inputValue();
const importedSteps = await agentPage.locator("#stepList .list-row[data-step-id]").count();
await agentPage.click('.nav-item[data-section="lanes"]');
await agentPage.waitForTimeout(150);
const importedLanes = await agentPage.locator("#laneList .list-row[data-lane-id]").count();
await agentPage.click('.nav-item[data-section="diagram"]');
await agentPage.waitForTimeout(400);
const importedSvg = await agentPage.locator("#diagramCanvasWrapper svg").count();
ok("9.5", importedName === "Reklamation bearbeiten" && importedSteps === 5 && importedLanes === 2 && importedSvg === 1,
  `übernommen als "${importedName}" mit ${importedSteps} Schritten, ${importedLanes} Akteuren, Diagramm: ${importedSvg}`);

// 9.6 — der übernommene Prozess ist vollwertig: draw.io-Export funktioniert
const [agentXml] = await Promise.all([
  agentPage.waitForEvent("download"),
  agentPage.click("#exportDrawioBtn"),
]);
const agentXmlText = fs.readFileSync(await agentXml.path(), "utf8");
ok("9.6", agentXmlText.includes("<mxfile") && agentXmlText.includes("rhombus"),
  "draw.io-Export des übernommenen Prozesses inkl. Entscheidungsraute");

// 9.10 — die vom Agenten gelieferte Artefaktkette landet in der SIPOC-Übersicht
await agentPage.click('.nav-item[data-section="sipoc"]');
await agentPage.click('.segmented-option[data-view="board"]');
await agentPage.waitForTimeout(400);
ok("9.10", (await agentPage.locator(".sipoc-chip").count()) >= 2,
  (await agentPage.locator(".sipoc-chip").count()) + " Herkunftsangaben aus der Agentenantwort übernommen");
await agentPage.click('.segmented-option[data-view="list"]');

// 9.8 — Eingabefeld leeren setzt auch das Prüfergebnis zurück
await agentPage.click('.nav-item[data-section="agent"]');
await agentPage.waitForTimeout(200);
await checkAgentInput("kein json");
await agentPage.click("#clearAgentInputBtn");
await agentPage.waitForTimeout(150);
ok("9.8", (await agentPage.locator("#agentInput").inputValue()) === "" &&
  (await agentPage.locator(".agent-placeholder").count()) === 1,
  "„Leeren“ setzt Eingabe und Ergebnis zurück");

ok("9.7", agentErrors.length === 0, agentErrors.join(" | ") || "keine JS-Fehler auf der Agent-Seite");
await agentPage.close();

// 9.9 / 5.7 — Kopieren in die Zwischenablage (braucht http-Herkunft und Berechtigung)
const clipContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const clipPage = await clipContext.newPage();
await clipPage.goto(httpUrl);
await clipPage.waitForTimeout(400);
await clipPage.click('.nav-item[data-section="agent"]');
await clipPage.waitForTimeout(250);
await clipPage.click("#copyAgentPromptBtn");
await clipPage.waitForTimeout(250);
const clippedPrompt = await clipPage.evaluate(() => navigator.clipboard.readText());
ok("9.9a", clippedPrompt.includes("sipoc-swimlane-studio/agent-import") &&
  clippedPrompt.includes("## Vollständiges Beispiel") && clippedPrompt.includes("## Inhaltliche Regeln"),
  "Prompt landet vollständig in der Zwischenablage");

await clipPage.fill("#agentInput", '{ "project": { "name": "X" } }');
await clipPage.click("#checkAgentBtn");
await clipPage.waitForTimeout(200);
await clipPage.click("#copyAgentReportBtn");
await clipPage.waitForTimeout(250);
const clippedReport = await clipPage.evaluate(() => navigator.clipboard.readText());
ok("9.9b", clippedReport.includes("ZU BEHEBEN") && clippedReport.includes("Abschnitt lanes fehlt"),
  "Fehlerbericht landet in der Zwischenablage");

await clipPage.click('.nav-item[data-section="diagram"]');
await clipPage.waitForTimeout(400);
await clipPage.click("#copyXmlBtn");
await clipPage.waitForTimeout(250);
const clippedXml = await clipPage.evaluate(() => navigator.clipboard.readText());
ok("5.7", clippedXml.includes("<mxfile") && clippedXml.includes("swimlane"),
  "draw.io-XML landet in der Zwischenablage");
await clipContext.close();

server.close();

// --- AP10 Artefaktkette und Prozesskette -------------------------------------

const chainPage = await browser.newPage();
const chainErrors = [];
chainPage.on("pageerror", (e) => chainErrors.push("PAGEERROR: " + e.message));
chainPage.on("console", (m) => { if (m.type() === "error") chainErrors.push("CONSOLE: " + m.text()); });
chainPage.on("dialog", (d) => d.accept());
await chainPage.setViewportSize({ width: 1500, height: 1000 });
await chainPage.goto(url);
await chainPage.waitForTimeout(300);
await chainPage.evaluate(() => localStorage.clear());
await chainPage.reload();
await chainPage.waitForTimeout(400);

ok("10.1", (await chainPage.locator("#projectSelect option").count()) === 3,
  "Startbestand enthält drei verkettete Prozesse");

// 10.2 — SIPOC-Übersicht mit Artefaktketten
await chainPage.click('.segmented-option[data-view="board"]');
await chainPage.waitForTimeout(400);
const boardRows = await chainPage.locator(".sipoc-row").count();
const chips = await chainPage.locator(".sipoc-chip").count();
const links = await chainPage.locator(".sipoc-link").count();
ok("10.2", boardRows === 13 && chips > 0 && links === chips,
  `Übersicht: ${boardRows} Zeilen, ${chips} Herkunftsangaben, ${links} Ketten`);

// 10.3 — Ketten sind erst auf Zuruf sichtbar, nicht dauerhaft
const restingOpacity = await chainPage.evaluate(() =>
  getComputedStyle(document.querySelector(".sipoc-link")).opacity);
await chainPage.click("#toggleChainsBtn");
await chainPage.waitForTimeout(300);
const shownOpacity = await chainPage.evaluate(() =>
  getComputedStyle(document.querySelector(".sipoc-link")).opacity);
ok("10.3", Number(restingOpacity) === 0 && Number(shownOpacity) > 0,
  `Ruhezustand ${restingOpacity}, eingeblendet ${shownOpacity}`);
await chainPage.click("#toggleChainsBtn");
await chainPage.waitForTimeout(200);

// 10.4 — Überfahren hebt die zusammenhängende Kette hervor
await chainPage.locator(".sipoc-row").nth(10).hover();
await chainPage.waitForTimeout(300);
ok("10.4", (await chainPage.locator(".sipoc-link-active").count()) > 0 &&
  (await chainPage.locator(".sipoc-row-linked").count()) > 0,
  "Hervorhebung beim Überfahren einer Zeile");

// 10.5 — Herkunft im Formular setzen und wieder entfernen
await chainPage.click('.segmented-option[data-view="list"]');
await chainPage.waitForTimeout(250);
await chainPage.locator("#stepList .list-row", { hasText: "Rechnung erfassen und digitalisieren" }).click();
await chainPage.waitForTimeout(250);
const sourceBoxes = await chainPage.locator('#panelForm input[name="inputFrom"]').count();
const checkedBefore = await chainPage.locator('#panelForm input[name="inputFrom"]:checked').count();
await chainPage.locator('#panelForm input[name="inputFrom"]').first().uncheck();
await chainPage.locator('#panelForm input[name="inputFrom"]').nth(2).check();
await chainPage.click("#panelForm button[type=submit]");
await chainPage.waitForTimeout(300);
await chainPage.locator("#stepList .list-row", { hasText: "Rechnung erfassen und digitalisieren" }).click();
await chainPage.waitForTimeout(250);
const checkedAfter = await chainPage.locator('#panelForm input[name="inputFrom"]:checked').count();
const checkedIndex = await chainPage.evaluate(() => {
  const boxes = Array.from(document.querySelectorAll('#panelForm input[name="inputFrom"]'));
  return boxes.findIndex((b) => b.checked);
});
await chainPage.click("#panelClose");
ok("10.5", sourceBoxes === 12 && checkedBefore === 1 && checkedAfter === 1 && checkedIndex === 2,
  `Auswahl ${sourceBoxes} Schritte, Herkunft geändert (Index ${checkedIndex})`);

// 10.6 — Schritt löschen entfernt die Herkunftsverweise darauf
await chainPage.click('.segmented-option[data-view="board"]');
await chainPage.waitForTimeout(300);
const chipsBeforeDelete = await chainPage.locator(".sipoc-chip").count();
await chainPage.click('.segmented-option[data-view="list"]');
await chainPage.locator("#stepList .list-row", { hasText: "Rückfrage an Lieferanten klären" }).click();
await chainPage.waitForTimeout(200);
await chainPage.click("#panelDeleteBtn");
await chainPage.waitForTimeout(400);
await chainPage.click('.segmented-option[data-view="board"]');
await chainPage.waitForTimeout(300);
const chipsAfterDelete = await chainPage.locator(".sipoc-chip").count();
ok("10.6", chipsAfterDelete < chipsBeforeDelete,
  `Herkunftsangaben ${chipsBeforeDelete} → ${chipsAfterDelete} nach dem Löschen eines Schritts`);

// 10.7 — Duplizieren führt zu einer eigenständigen Kette in der Kopie
await chainPage.click("#moreMenuBtn");
await chainPage.waitForTimeout(150);
await chainPage.click("#duplicateProjectBtn");
await chainPage.waitForTimeout(500);
await chainPage.click('.segmented-option[data-view="board"]');
await chainPage.waitForTimeout(400);
const chipsInCopy = await chainPage.locator(".sipoc-chip").count();
ok("10.7", chipsInCopy === chipsAfterDelete && chipsInCopy > 0,
  `Kopie hat eigene Herkunftsverweise (${chipsInCopy})`);

// 10.8 — Prozesskette: Landkarte und Übergabenliste
await chainPage.click('.nav-item[data-section="chain"]');
await chainPage.waitForTimeout(500);
const cards = await chainPage.locator(".chain-card").count();
const edges = await chainPage.locator(".chain-edge").count();
const linkRows = await chainPage.locator("#processLinkList .list-row[data-link-id]").count();
ok("10.8", cards === 4 && edges === 2 && linkRows === 2,
  `Landkarte: ${cards} Prozesse, ${edges} Übergaben, ${linkRows} Einträge`);

// 10.9 — Verkettung anlegen, Selbstverkettung und Duplikat verhindern
await chainPage.click("#newProcessLinkBtn");
await chainPage.waitForTimeout(300);
const projectValues = await chainPage.locator("#f_fromProject option").evaluateAll((o) => o.map((x) => x.value));
await chainPage.selectOption("#f_fromProject", projectValues[0]);
await chainPage.selectOption("#f_toProject", projectValues[0]);
await chainPage.click("#panelForm button[type=submit]");
await chainPage.waitForTimeout(250);
ok("10.9a", (await chainPage.locator("#toast").textContent()).includes("nicht mit sich selbst"),
  "Selbstverkettung wird verhindert");
await chainPage.selectOption("#f_toProject", projectValues[3]);
await chainPage.fill("#f_artifact", "Geprüfte Vergabeunterlagen");
await chainPage.click("#panelForm button[type=submit]");
await chainPage.waitForTimeout(400);
ok("10.9b", (await chainPage.locator("#processLinkList .list-row[data-link-id]").count()) === 3 &&
  (await chainPage.locator(".chain-edge").count()) === 3,
  "neue Verkettung erscheint in Liste und Landkarte");

await chainPage.click("#newProcessLinkBtn");
await chainPage.waitForTimeout(250);
await chainPage.selectOption("#f_fromProject", projectValues[0]);
await chainPage.selectOption("#f_toProject", projectValues[3]);
await chainPage.click("#panelForm button[type=submit]");
await chainPage.waitForTimeout(250);
ok("10.9c", (await chainPage.locator("#toast").textContent()).includes("existiert bereits"),
  "doppelte Verkettung wird verhindert");
await chainPage.click("#panelClose");

// 10.10 — Verkettung bearbeiten und löschen
await chainPage.locator("#processLinkList .list-row[data-link-id]").last().click();
await chainPage.waitForTimeout(250);
await chainPage.fill("#f_artifact", "Freigegebene Vergabeunterlagen");
await chainPage.click("#panelForm button[type=submit]");
await chainPage.waitForTimeout(300);
const editedBadge = await chainPage.locator("#processLinkList .list-row[data-link-id]").last().innerText();
await chainPage.locator("#processLinkList .list-row[data-link-id]").last().click();
await chainPage.waitForTimeout(250);
await chainPage.click("#panelDeleteBtn");
await chainPage.waitForTimeout(300);
ok("10.10", editedBadge.includes("Freigegebene Vergabeunterlagen") &&
  (await chainPage.locator("#processLinkList .list-row[data-link-id]").count()) === 2,
  "Verkettung bearbeitet und wieder gelöscht");

// 10.11 — Klick auf eine Prozesskarte wechselt den aktiven Prozess
const otherCard = chainPage.locator(".chain-card").first();
const otherName = (await otherCard.locator(".chain-card-name").textContent()).trim();
await otherCard.click();
await chainPage.waitForTimeout(400);
ok("10.11", (await chainPage.locator("#projectNameInput").inputValue()) === otherName,
  `Wechsel per Landkarte auf „${otherName}“`);

// 10.12 — Projekt löschen entfernt seine Verkettungen
await chainPage.click("#moreMenuBtn");
await chainPage.waitForTimeout(150);
await chainPage.click("#deleteProjectBtn");
await chainPage.waitForTimeout(500);
await chainPage.click('.nav-item[data-section="chain"]');
await chainPage.waitForTimeout(400);
ok("10.12", (await chainPage.locator("#processLinkList .list-row[data-link-id]").count()) === 1,
  "Verkettungen des gelöschten Prozesses sind entfernt");

ok("10.13", chainErrors.length === 0, chainErrors.join(" | ") || "keine JS-Fehler in den neuen Ansichten");
await chainPage.close();

// --- Auswertung -------------------------------------------------------------

console.log("\n===== Vorgangskatalog-Smoke-Test =====");
let failed = 0;
for (const [key, r] of Object.entries(results)) {
  if (!r.pass) failed++;
  console.log((r.pass ? "PASS" : "FAIL") + "  " + key + (r.note ? "  — " + r.note : ""));
}
console.log("\n===== JavaScript-Fehler in der Seite =====");
console.log(jsErrors.length ? jsErrors.join("\n") : "(keine)");

await browser.close();

if (failed > 0 || jsErrors.length > 0) {
  console.error(`\n${failed} Vorgang/Vorgänge fehlgeschlagen, ${jsErrors.length} JS-Fehler.`);
  process.exitCode = 1;
} else {
  console.log(`\nAlle ${Object.keys(results).length} geprüften Vorgänge bestanden, keine JS-Fehler.`);
}

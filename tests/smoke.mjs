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
import { fileURLToPath } from "url";

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
await page.click("#duplicateProjectBtn");
await page.waitForTimeout(150);
ok("1.5", (await page.locator("#projectSelect option").count()) === projCountBefore + 1, "Projekt duplizieren");

const firstVal = await page.locator("#projectSelect option").first().getAttribute("value");
await page.selectOption("#projectSelect", firstVal);
await page.waitForTimeout(150);
ok("1.8", true, "Projekt wechseln ohne Fehler");

const beforeDel = await page.locator("#projectSelect option").count();
await page.click("#deleteProjectBtn");
await page.waitForTimeout(200);
ok("1.6", (await page.locator("#projectSelect option").count()) === beforeDel - 1, "Projekt löschen");

while ((await page.locator("#projectSelect option").count()) > 1) {
  await page.click("#deleteProjectBtn");
  await page.waitForTimeout(150);
}
await page.click("#deleteProjectBtn");
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

const [jsonDownload] = await Promise.all([page.waitForEvent("download"), page.click("#exportJsonBtn")]);
const jsonPath = await jsonDownload.path();
const projCountBeforeImport = await page.locator("#projectSelect option").count();
await page.click("#importJsonBtn");
await page.setInputFiles("#importFileInput", jsonPath);
await page.waitForTimeout(300);
ok("6.4_6.5", (await page.locator("#projectSelect option").count()) === projCountBeforeImport + 1, "Export/Import-Rundlauf Einzelprojekt");

const multiStore = { projects: [{ id: "proj-smoke-extra", name: "Import-Test A", lanes: [], steps: [], connections: [] }], currentProjectId: "proj-smoke-extra" };
fs.writeFileSync("/tmp/sipoc-smoke-multi-import.json", JSON.stringify(multiStore));
const beforeMulti = await page.locator("#projectSelect option").count();
await page.click("#importJsonBtn");
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

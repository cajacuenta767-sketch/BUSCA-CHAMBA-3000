"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Scanner } = require("../src/services/scanner");
const { EventBus } = require("../src/services/event-bus");
const { SqliteStore } = require("../src/infra/storage/sqlite-store");
const { DemoGenerator } = require("../src/services/demo");
const { fastSettings, FakeRunner, CSV_HEADER, csvRow, waitFor, wait, fastTimers } = require("./helpers");

const AREA_1_CELL = [-12.005, -77.005, -12.000, -77.000]; // < 1 km → una sola celda
const AREA_4_CELLS = [-12.015, -77.015, -12.000, -77.000];

function makeScanner({ runner, settings, store, timers } = {}) {
  store = store || new SqliteStore({ file: ":memory:" });
  const bus = new EventBus({ pingMs: 60000 });
  const events = [];
  bus.on("*", (type, data) => events.push({ type, data }));
  const notified = [];
  const scanner = new Scanner({
    store, bus, settings: settings || fastSettings(), runner: runner || new FakeRunner(),
    proxies: { backendProxies: () => [], anyAlive: async () => false },
    notifier: { notifyLead: (l) => notified.push(l), scanFinished: () => {} },
    log: () => {}, demo: new DemoGenerator(), timers,
  });
  return { scanner, store, bus, events, notified };
}

test("start: valida área, rechaza doble inicio y calcula celdas", async () => {
  const { scanner, store } = makeScanner();
  assert.ok((await scanner.start({})).error);
  const r = await scanner.start({ area: AREA_4_CELLS, cellKm: 1, demo: true });
  assert.equal(r.ok, true);
  assert.equal(r.cells, 4);
  assert.ok((await scanner.start({ area: AREA_4_CELLS, demo: true })).error, "no permite dos escaneos");
  assert.equal(store.getActiveScan().running, true);
  scanner.close();
});

test("demo: recorre todas las celdas, guarda leads, historial y celdas barridas", async () => {
  const { scanner, store, events } = makeScanner();
  await scanner.start({ area: AREA_4_CELLS, cellKm: 1, demo: true });
  await waitFor(() => !scanner.running, { timeout: 8000 });
  const st = scanner.status();
  assert.equal(st.cellsDone, 4);
  assert.ok(st.found >= 4);
  assert.equal(store.countLeads(), st.found);
  assert.equal(store.countScanned(), 4);
  assert.equal(store.history().length, 1);
  assert.equal(store.getActiveScan(), null);
  assert.ok(events.some((e) => e.type === "done"));
  assert.ok(events.some((e) => e.type === "lead"));
  scanner.close();
});

test("runner real (simulado): ingiere el CSV, dedupe y no reescanea celdas ya barridas", async () => {
  const runner = new FakeRunner({ csvByCell: () => CSV_HEADER + csvRow(1) + csvRow(2) + csvRow(1) });
  const { scanner, store, notified } = makeScanner({ runner });
  await scanner.start({ area: AREA_1_CELL, cellKm: 1 });
  await waitFor(() => !scanner.running);
  assert.equal(runner.jobs.length, 1);
  assert.equal(runner.jobs[0].concurrency, 4, "conc=1 por defecto → mínimo 4");
  assert.equal(runner.jobs[0].depth, 3);
  assert.equal(store.countLeads(), 2, "la fila repetida no se duplica");
  assert.equal(notified.length, 2);
  assert.equal(store.countScanned(), 1);
  // Segundo intento sobre la misma zona: todo ya está en verde
  const again = await scanner.start({ area: AREA_1_CELL, cellKm: 1 });
  assert.match(again.error, /ya fue revisada/);
  scanner.close();
});

test("exclusión por nombre y tope de leads con auto-pausa", async () => {
  const runner = new FakeRunner({ csvByCell: () => CSV_HEADER + csvRow(1, { title: "Casino Royal" }) + csvRow(2) + csvRow(3) + csvRow(4) });
  const { scanner, store } = makeScanner({ runner });
  await scanner.start({ area: AREA_1_CELL, cellKm: 1, exclude: "casino", maxLeads: 2 });
  await waitFor(() => scanner.status().paused);
  // El tope es "blando": pausa el escaneo, pero la celda en curso termina de ingerir sus filas.
  assert.ok(store.countLeads() >= 2 && store.countLeads() <= 3);
  assert.ok(!store.listLeads().some((l) => /casino/i.test(l.title)));
  scanner.close();
});

test("bloqueo detectado: la celda se reintenta y queda en error si persiste", async () => {
  const runner = new FakeRunner({ stderr: "net::ERR_TUNNEL_CONNECTION_FAILED 403" });
  const settings = fastSettings({ retryFailed: false });
  const { scanner, events } = makeScanner({ runner, settings, timers: fastTimers() });
  await scanner.start({ area: AREA_1_CELL, cellKm: 1 });
  await waitFor(() => !scanner.running, { timeout: 5000 });
  assert.equal(runner.jobs.length, 3, "1 intento + 2 reintentos en modo directo");
  const last = events.filter((e) => e.type === "cell").pop();
  assert.equal(last.data.state, "error");
  scanner.close();
});

test("pausar y reanudar con una celda en curso no lanza un segundo scraper", async () => {
  const runner = new FakeRunner({ exitAfterMs: 150, csvByCell: () => CSV_HEADER + csvRow(1) });
  const { scanner } = makeScanner({ runner });
  await scanner.start({ area: AREA_1_CELL, cellKm: 1 });
  scanner.pause();
  scanner.resume();
  scanner.resume();
  await wait(60);
  assert.equal(runner.jobs.length, 1);
  await waitFor(() => !scanner.running);
  assert.equal(runner.jobs.length, 1);
  scanner.close();
});

test("stop mata el proceso hijo y limpia el escaneo activo", async () => {
  const runner = new FakeRunner({ exitAfterMs: 5000 });
  const { scanner, store } = makeScanner({ runner });
  await scanner.start({ area: AREA_1_CELL, cellKm: 1 });
  scanner.stop();
  assert.equal(runner.killed, 1);
  assert.equal(scanner.running, false);
  assert.equal(store.getActiveScan(), null);
  scanner.close();
});

test("sin binario del scraper: error visible y sin auto-reanudación en bucle", async () => {
  const runner = { start: () => ({ error: "No encuentro 'gms'." }), readCellCsv: () => "", kill() {} };
  const { scanner, store, events } = makeScanner({ runner });
  await scanner.start({ area: AREA_1_CELL, cellKm: 1 });
  assert.equal(scanner.running, false);
  assert.ok(events.some((e) => e.type === "error"));
  assert.equal(store.getActiveScan(), null, "no quedaría un escaneo fantasma que se reintente en cada arranque");
  scanner.close();
});

test("workers=2: dos celdas a la vez, slots distintos y mismo resultado final", async () => {
  const runner = new FakeRunner({ exitAfterMs: 120, csvByCell: (job) => CSV_HEADER + csvRow(Math.round(job.bbox[0] * 1000) + Math.round(job.bbox[1] * 1000) * 7) });
  const settings = fastSettings({ workers: 2 });
  const { scanner, store } = makeScanner({ runner, settings, timers: fastTimers(10) });
  await scanner.start({ area: AREA_4_CELLS, cellKm: 1 });
  await waitFor(() => runner.active === 2, { timeout: 2000 });
  assert.equal(scanner.status().activeCells, 2);
  assert.equal(scanner.status().workers, 2);
  await waitFor(() => !scanner.running, { timeout: 8000 });
  assert.equal(runner.maxActive, 2, "nunca más de 2 scrapers a la vez");
  assert.equal(runner.jobs.length, 4);
  assert.deepEqual([...new Set(runner.jobs.map((j) => j.slot))].sort(), [0, 1]);
  assert.equal(store.countScanned(), 4);
  assert.equal(store.history().length, 1);
  scanner.close();
});

test("workers=1 (defecto): nunca hay dos scrapers a la vez", async () => {
  const runner = new FakeRunner({ exitAfterMs: 40 });
  const { scanner } = makeScanner({ runner, timers: fastTimers(10) });
  await scanner.start({ area: AREA_4_CELLS, cellKm: 1 });
  await waitFor(() => !scanner.running, { timeout: 8000 });
  assert.equal(runner.maxActive, 1);
  assert.equal(runner.jobs.length, 4);
  scanner.close();
});

test("ingesta incremental: un CSV que crece se lee por trozos, sin duplicar ni perder filas partidas", async () => {
  let calls = 0;
  const full = CSV_HEADER + csvRow(1) + csvRow(2, { address: "Av. Multi\nlínea 2" }) + csvRow(3) + "Negocio 4,Farm";
  const runner = new FakeRunner({ exitAfterMs: 10000, csvByCell: () => { calls++; return full.slice(0, Math.min(full.length, calls * 90)); } });
  const { scanner, store } = makeScanner({ runner });
  await scanner.start({ area: AREA_1_CELL, cellKm: 1 });
  await waitFor(() => store.countLeads() === 3, { timeout: 4000 });
  assert.equal(store.getLead("pid2").address, "Av. Multi\nlínea 2", "fila con salto de línea entrecomillado");
  scanner.stop();
  assert.equal(store.countLeads(), 3, "la fila incompleta del final no se guarda");
  scanner.close();
});

test("autoResume retoma un escaneo que quedó activo", async () => {
  const store = new SqliteStore({ file: ":memory:" });
  store.setActiveScan({ running: true, area: AREA_1_CELL, mode: "all", cellKm: 1, email: false, demo: true });
  const { scanner } = makeScanner({ store });
  assert.equal(scanner.autoResume(), true);
  await waitFor(() => scanner.running, { timeout: 4000 });
  await waitFor(() => !scanner.running, { timeout: 4000 });
  assert.ok(store.countLeads() > 0);
  scanner.close();
});

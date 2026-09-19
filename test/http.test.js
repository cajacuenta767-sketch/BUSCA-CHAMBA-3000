"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { SqliteStore } = require("../src/infra/storage/sqlite-store");
const { testEnv, fastSettings, FakeRunner, CSV_HEADER, csvRow, waitFor } = require("./helpers");

async function boot(envOverrides = {}, runner) {
  const env = testEnv(envOverrides);
  const app = createApp({ env, overrides: { store: new SqliteStore({ file: ":memory:" }), settings: fastSettings(), runner: runner || new FakeRunner({ csvByCell: () => CSV_HEADER + csvRow(1) + csvRow(2) }) } });
  const addr = await app.start(0, "127.0.0.1");
  const base = `http://127.0.0.1:${addr.port}`;
  const api = async (path, opts = {}) => {
    const r = await fetch(base + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts, opts.body && typeof opts.body !== "string" ? { body: JSON.stringify(opts.body) } : {}));
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* texto */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  return { app, base, api };
}

test("GET / sirve el panel sin caché; rutas desconocidas → 404 JSON; método incorrecto → 405", async (t) => {
  const { app, api } = await boot();
  t.after(() => app.stop());
  const home = await api("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(home.headers.get("cache-control"), /no-store/);
  assert.equal((await api("/nada")).status, 404);
  assert.equal((await api("/api/scan/start")).status, 405);
  assert.equal((await fetch(app.server.address() && `http://127.0.0.1:${app.server.address().port}/api/status`, { method: "OPTIONS" })).status, 204);
});

test("BASIC_AUTH protege todo el servidor", async (t) => {
  const { app, api } = await boot({ BASIC_AUTH: "bryan:secreto" });
  t.after(() => app.stop());
  assert.equal((await api("/api/status")).status, 401);
  assert.equal((await api("/api/status", { headers: { Authorization: "Basic " + Buffer.from("bryan:mal").toString("base64") } })).status, 401);
  assert.equal((await api("/api/status", { headers: { Authorization: "Basic " + Buffer.from("bryan:secreto").toString("base64") } })).status, 200);
});

test("flujo completo por API: escanear, listar (paginado), actualizar meta, reset", async (t) => {
  const { app, api } = await boot();
  t.after(() => app.stop());
  const start = await api("/api/scan/start", { method: "POST", body: { area: [-12.005, -77.005, -12.0, -77.0], cellKm: 1 } });
  assert.equal(start.json.ok, true);
  await waitFor(() => !app.scanner.running);
  const all = await api("/api/leads");
  assert.equal(all.json.total, 2);
  assert.equal(all.json.leads.length, 2);
  assert.ok(Array.isArray(all.json.categories) && all.json.categories.length > 10);
  assert.equal(all.json.history.length, 1);
  const page = await api("/api/leads?limit=1&offset=1");
  assert.equal(page.json.leads.length, 1);
  assert.equal(page.json.leads[0].title, "Negocio 2");
  const upd = await api("/api/lead/update", { method: "POST", body: { id: "pid1", patch: { state: "contactado" } } });
  assert.equal(upd.json.ok, true);
  assert.equal((await api("/api/lead/update", { method: "POST", body: { id: "zzz", patch: {} } })).json.error, "no existe");
  assert.deepEqual((await api("/api/leads")).json.leads[0]._meta, { state: "contactado" });
  assert.equal((await api("/api/reset", { method: "POST" })).json.ok, true);
  assert.equal((await api("/api/leads")).json.total, 0);
  assert.equal((await api("/api/leads")).json.history.length, 1, "el historial sobrevive al reset");
  assert.equal((await api("/api/health")).json.leads, 0);
});

test("config: guarda claves válidas, ignora inválidas y nunca expone el token", async (t) => {
  const { app, api } = await boot();
  t.after(() => app.stop());
  await api("/api/config", { method: "POST", body: { telegramToken: "123:abc", pauseMin: -5, conc: 3, notify: true, desconocida: 1 } });
  const c = (await api("/api/config")).json;
  assert.equal(c.hasToken, true);
  assert.equal(c.telegramToken, undefined);
  assert.equal(c.conc, 3);
  assert.equal(c.notify, true);
  assert.equal(c.pauseMin, 0.05, "un negativo no pisa el valor anterior");
});

test("cuerpo demasiado grande → 413; JSON inválido → se trata como {}", async (t) => {
  const { app, api } = await boot({ MAX_BODY_BYTES: 100 });
  t.after(() => app.stop());
  const big = await api("/api/config", { method: "POST", body: "x".repeat(500) });
  assert.equal(big.status, 413);
  const bad = await api("/api/scan/start", { method: "POST", body: "{no es json" });
  assert.equal(bad.status, 200);
  assert.match(bad.json.error, /Falta el área/);
});

test("SSE: /api/stream envía el estado inicial y los eventos del escaneo", async (t) => {
  const { app, base } = await boot();
  t.after(() => app.stop());
  const ctrl = new AbortController();
  const res = await fetch(base + "/api/stream", { signal: ctrl.signal });
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const reader = res.body.getReader();
  let buf = "";
  const read = async () => { const { value } = await reader.read(); buf += Buffer.from(value).toString(); };
  await read();
  assert.match(buf, /event: status/);
  await fetch(base + "/api/scan/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ area: [-12.005, -77.005, -12.0, -77.0], cellKm: 1 }) });
  await waitFor(() => !app.scanner.running);
  while (!/event: done/.test(buf)) await read();
  assert.match(buf, /event: lead/);
  assert.match(buf, /event: cell/);
  ctrl.abort();
});

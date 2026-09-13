#!/usr/bin/env node
"use strict";
/*
 * BUSCA-CHAMBA-3000 — servidor local
 * Sirve el panel, lanza el scraper de Google Maps y transmite los leads en vivo (SSE).
 * Sin dependencias externas: solo Node.
 *
 * Uso:   node server.js      (abre http://localhost:8090)
 * Config por variables de entorno:
 *   PORT           puerto (default 8090)
 *   SCRAPER_BIN    ruta al binario gms (default: ./gms o ../google-maps-scraper/gms)
 *   SCRAPER_MODE   "docker" para usar la imagen gosom/google-maps-scraper
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
const DB_FILE = path.join(DATA, "db.json");
const LIVE_CSV = path.join(DATA, "live.csv");
const QUERIES_RUN = path.join(DATA, "queries.run.txt");

// ---------- DB (persistencia simple en JSON) ----------
let db = load();
function load() { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) { return { leads: {}, order: [] }; } }
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {} }, 250); }
function idOf(l) { return l.link || (l.title + "|" + l.address); }

// ---------- SSE ----------
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) {} }
}
setInterval(() => { for (const res of clients) { try { res.write(": ping\n\n"); } catch (e) {} } }, 25000);

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { row.push(field); field = ""; } else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; } else if (c !== "\r") field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function emails(s) { if (!s) return []; const m = s.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []; return [...new Set(m.map(x => x.toLowerCase()))]; }
function rowToLead(H, r) {
  const gi = n => H.indexOf(n); const g = n => { const i = gi(n); return i >= 0 ? (r[i] || "").trim() : ""; };
  const title = g("title"); if (!title) return null;
  return {
    title, category: g("category"), address: g("complete_address") || g("address"),
    phone: g("phone"), website: g("website"), emails: emails(g("emails")),
    rating: parseFloat(g("review_rating")) || 0, reviews: parseInt((g("review_count") || "").replace(/\D/g, "")) || 0,
    lat: parseFloat(g("latitude")) || 0, lon: parseFloat(g("longitude")) || 0,
    link: g("link"), thumb: g("thumbnail")
  };
}

// ---------- Escaneo ----------
let child = null, pollT = null, demoT = null, emitted = 0;
let status = { running: false, mode: null, found: 0, started: null };

function addLead(lead) {
  const id = idOf(lead);
  if (!db.leads[id]) { db.leads[id] = lead; db.order.push(id); }
  else db.leads[id] = Object.assign({}, lead, { _meta: db.leads[id]._meta }); // conserva estado/notas
  status.found++;
  broadcast("lead", db.leads[id]); save();
}
function ingest() {
  let text; try { text = fs.readFileSync(LIVE_CSV, "utf8"); } catch (e) { return; }
  if (!text) return;
  const endsNL = /\n$/.test(text);
  let rows = parseCSV(text);
  if (!endsNL && rows.length) rows = rows.slice(0, -1);
  if (rows.length < 2) return;
  const H = rows[0].map(h => h.trim().toLowerCase());
  for (let i = 1 + emitted; i < rows.length; i++) {
    const lead = rowToLead(H, rows[i]); if (lead) addLead(lead);
  }
  emitted = rows.length - 1;
}
function findBin() {
  if (process.env.SCRAPER_BIN && fs.existsSync(process.env.SCRAPER_BIN)) return process.env.SCRAPER_BIN;
  for (const p of [path.join(ROOT, "gms"), path.join(ROOT, "..", "google-maps-scraper", "gms")]) if (fs.existsSync(p)) return p;
  return null;
}
function buildCmd(o) {
  const grid = o.gridBbox ? ["-grid-bbox", o.gridBbox, "-grid-cell", String(o.gridCell || 1), "-zoom", String(o.zoom || 15)] : [];
  const extra = []; if (o.email) extra.push("-email"); if (o.depth) extra.push("-depth", String(o.depth));
  if (process.env.SCRAPER_MODE === "docker") {
    const a = ["run", "--rm", "-v", `${DATA}:/out`, "-v", `${QUERIES_RUN}:/queries.txt:ro`,
      "gosom/google-maps-scraper", "-input", "/queries.txt", "-results", "/out/live.csv",
      "-lang", "es", "-exit-on-inactivity", "3m", ...extra];
    if (o.gridBbox) a.push("-grid-bbox", o.gridBbox, "-grid-cell", String(o.gridCell || 1), "-zoom", String(o.zoom || 15));
    return { cmd: "docker", args: a };
  }
  const bin = findBin();
  if (!bin) return { error: "No encuentro el binario 'gms'. Compílalo (go build) y ponlo aquí, define SCRAPER_BIN, o usa SCRAPER_MODE=docker." };
  return { cmd: bin, args: ["-input", QUERIES_RUN, "-results", LIVE_CSV, "-lang", "es", "-exit-on-inactivity", "3m", ...extra, ...grid] };
}
function start(o) {
  if (status.running) return { error: "Ya hay un escaneo en curso." };
  try { fs.writeFileSync(LIVE_CSV, ""); } catch (e) {}
  fs.writeFileSync(QUERIES_RUN, ((o.queries || "").trim()) + "\n");
  emitted = 0; status = { running: true, mode: o.demo ? "demo" : "scrape", found: 0, started: Date.now() };
  broadcast("status", status);
  if (o.demo) { startDemo(); return { ok: true, demo: true }; }
  const c = buildCmd(o);
  if (c.error) { status.running = false; broadcast("status", status); return { error: c.error }; }
  try { child = spawn(c.cmd, c.args, { cwd: ROOT }); }
  catch (e) { status.running = false; broadcast("status", status); return { error: String(e) }; }
  child.stderr.on("data", d => { const s = d.toString(); if (/error|blocked|failed/i.test(s)) broadcast("log", { line: s.slice(0, 300) }); });
  pollT = setInterval(ingest, 800);
  child.on("exit", code => { clearInterval(pollT); ingest(); status.running = false; broadcast("status", status); broadcast("done", { code, found: status.found }); child = null; });
  child.on("error", e => { clearInterval(pollT); status.running = false; broadcast("status", status); broadcast("error", { message: String(e) }); child = null; });
  return { ok: true, cmd: c.cmd };
}
function stop() {
  if (demoT) { clearInterval(demoT); demoT = null; }
  if (pollT) { clearInterval(pollT); pollT = null; }
  if (child) { try { child.kill("SIGTERM"); } catch (e) {} child = null; }
  status.running = false; broadcast("status", status); broadcast("done", { found: status.found });
  return { ok: true };
}
const DEMO = [
  { title: "Botica San Martín", category: "Farmacia", address: "Calle Mercaderes 210, Arequipa", phone: "054 234567", website: "", emails: [], rating: 4.2, reviews: 88, lat: -16.3985, lon: -71.5370, link: "https://maps.google.com", thumb: "" },
  { title: "TecniCell Reparaciones", category: "Servicio técnico de celulares", address: "Av. Larco 345, Trujillo", phone: "+51 987 654 321", website: "", emails: ["ventas@tecnicell.com"], rating: 4.1, reviews: 57, lat: -8.1120, lon: -79.0280, link: "https://maps.google.com", thumb: "" },
  { title: "Dentalia Clínica Dental", category: "Clínica dental", address: "Av. Ejército 710, Arequipa", phone: "+51 954 123 456", website: "https://dentalia.pe", emails: ["contacto@dentalia.pe"], rating: 4.6, reviews: 132, lat: -16.3989, lon: -71.5350, link: "https://maps.google.com", thumb: "" },
  { title: "Sabores del Sur", category: "Restaurante", address: "Calle Santa Catalina 120, Arequipa", phone: "+51 999 888 777", website: "", emails: [], rating: 4.3, reviews: 489, lat: -16.3960, lon: -71.5375, link: "https://maps.google.com", thumb: "" },
  { title: "FitZone Gym", category: "Gimnasio", address: "Jr. de la Unión 800, Lima", phone: "01 4567890", website: "https://fitzone.pe", emails: [], rating: 4.8, reviews: 921, lat: -12.0500, lon: -77.0330, link: "https://maps.google.com", thumb: "" },
  { title: "Bodega Doña Rosa", category: "Bodega", address: "Av. Brasil 1200, Lima", phone: "", website: "", emails: [], rating: 4.0, reviews: 23, lat: -12.0720, lon: -77.0530, link: "https://maps.google.com", thumb: "" },
  { title: "Ferretería El Tornillo", category: "Ferretería", address: "Av. Aviación 2100, Lima", phone: "01 3345566", website: "", emails: [], rating: 4.4, reviews: 76, lat: -12.0850, lon: -77.0000, link: "https://maps.google.com", thumb: "" },
  { title: "Barbería Don Pepe", category: "Barbería", address: "Calle Lima 45, Cusco", phone: "+51 984 112 233", website: "", emails: [], rating: 4.7, reviews: 210, lat: -13.5170, lon: -71.9780, link: "https://maps.google.com", thumb: "" }
];
function startDemo() {
  let i = 0;
  demoT = setInterval(() => {
    if (i >= DEMO.length) { clearInterval(demoT); demoT = null; status.running = false; broadcast("status", status); broadcast("done", { found: status.found }); return; }
    addLead(DEMO[i++]);
  }, 1000);
}

// ---------- Update lead (pipeline / notas / contactado) ----------
function updateLead(id, patch) {
  const l = db.leads[id]; if (!l) return { error: "no existe" };
  l._meta = Object.assign({}, l._meta, patch); save();
  broadcast("update", { id, meta: l._meta });
  return { ok: true };
}

// ---------- HTTP ----------
function body(req) { return new Promise(res => { let b = ""; req.on("data", d => b += d); req.on("end", () => { try { res(JSON.parse(b || "{}")); } catch (e) { res({}); } }); }); }
function json(res, obj, code = 200) { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" }); return res.end(); }

  if (p === "/" || p === "/dashboard.html") {
    let html; try { html = fs.readFileSync(path.join(ROOT, "dashboard.html")); } catch (e) { res.writeHead(404); return res.end("dashboard.html no encontrado"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(html);
  }
  if (p === "/api/status") return json(res, status);
  if (p === "/api/leads") return json(res, { status, leads: db.order.map(id => db.leads[id]).filter(Boolean) });
  if (p === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });
    res.write("retry: 3000\n\n"); res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
    clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (p === "/api/scrape/start" && req.method === "POST") return json(res, start(await body(req)));
  if (p === "/api/scrape/stop" && req.method === "POST") return json(res, stop());
  if (p === "/api/lead/update" && req.method === "POST") { const b = await body(req); return json(res, updateLead(b.id, b.patch || {})); }
  if (p === "/api/reset" && req.method === "POST") { db = { leads: {}, order: [] }; save(); broadcast("reset", {}); return json(res, { ok: true }); }

  res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("not found");
});
server.listen(PORT, () => console.log(`BUSCA-CHAMBA-3000 → http://localhost:${PORT}  (${db.order.length} leads guardados)`));

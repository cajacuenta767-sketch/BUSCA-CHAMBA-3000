#!/usr/bin/env node
"use strict";
/*
 * BUSCA-CHAMBA-3000 — servidor local (sin dependencias)
 * Orquesta el escaneo por CUADRÍCULA (celda por celda, mapa en vivo), transmite leads (SSE),
 * y opcionalmente los reenvía a Telegram / webhook.
 *
 * Uso:  node server.js            → http://localhost:8090
 * Env:  PORT, SCRAPER_BIN, SCRAPER_MODE=docker, BASIC_AUTH="usuario:clave"
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 8090;
const AUTH = process.env.BASIC_AUTH || "";
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
const DB_FILE = path.join(DATA, "db.json");
const CFG_FILE = path.join(DATA, "config.json");
const Q_FILE = path.join(DATA, "q.txt");
const CELL_CSV = path.join(DATA, "cell.csv");

const CATEGORIES = ["farmacia", "restaurante", "bodega", "ferretería", "gimnasio", "clínica dental",
  "peluquería", "barbería", "hotel", "panadería", "librería", "veterinaria", "taller de celulares",
  "estudio contable", "estudio jurídico", "inmobiliaria", "cevichería", "pollería", "chifa",
  "tienda de ropa", "zapatería", "juguería", "cafetería", "óptica", "imprenta", "lavandería",
  "cerrajería", "florería", "minimarket", "consultorio médico"];

// ---------- DB & Config ----------
let db = load(DB_FILE, { leads: {}, order: [], history: [] });
let cfg = load(CFG_FILE, { telegramToken: "", telegramChat: "", webhookUrl: "", proxies: "", leadsdbKey: "", notify: false, safeMode: true, pauseMin: 3, pauseMax: 8, depth: 0, maxBlocks: 4 });
function load(f, d) { try { return Object.assign({}, d, JSON.parse(fs.readFileSync(f, "utf8"))); } catch (e) { return d; } }
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {} }, 250); }
function saveCfg() { try { fs.writeFileSync(CFG_FILE, JSON.stringify(cfg)); } catch (e) {} }

// ---------- Logs ----------
const logs = [];
function log(s) { logs.push(new Date().toISOString().slice(11, 19) + " " + s); if (logs.length > 400) logs.shift(); }

// ---------- SSE ----------
const clients = new Set();
function broadcast(type, data) { const m = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of clients) { try { r.write(m); } catch (e) {} } }
setInterval(() => { for (const r of clients) { try { r.write(": ping\n\n"); } catch (e) {} } }, 25000);

// ---------- Telegram / Webhook ----------
function httpsPost(url, obj) {
  return new Promise(res => {
    try {
      const u = new URL(url), data = JSON.stringify(obj);
      const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: 9000 },
        r => { let b = ""; r.on("data", d => b += d); r.on("end", () => res({ status: r.statusCode, body: b.slice(0, 300) })); });
      req.on("error", e => res({ error: String(e) })); req.on("timeout", () => { req.destroy(); res({ error: "timeout" }); });
      req.write(data); req.end();
    } catch (e) { res({ error: String(e) }); }
  });
}
const escH = s => (s || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function tgSend(text) { if (!cfg.telegramToken || !cfg.telegramChat) return Promise.resolve({ error: "Falta token o chat_id de Telegram." }); return httpsPost(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, { chat_id: cfg.telegramChat, text, parse_mode: "HTML", disable_web_page_preview: true }); }
let tgQueue = [], tgBusy = false;
function notifyLead(l) {
  if (cfg.notify && cfg.telegramToken && cfg.telegramChat) { tgQueue.push(l); pumpTg(); }
  if (cfg.webhookUrl && /^https:/.test(cfg.webhookUrl)) httpsPost(cfg.webhookUrl, l);
}
function pumpTg() {
  if (tgBusy || !tgQueue.length) return; tgBusy = true; const l = tgQueue.shift();
  const txt = `🆕 <b>${escH(l.title)}</b>\n${escH(l.category || "")}${l.website ? "" : " · 🔥 SIN WEB"}\n${l.phone ? "📞 " + escH(l.phone) : "(sin teléfono)"}\n📍 ${escH(l.address || "")}\n${l.link || ""}`;
  tgSend(txt).then(() => setTimeout(() => { tgBusy = false; pumpTg(); }, 1300));
}

// ---------- CSV ----------
function parseCSV(t) { const rows = []; let row = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else { if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c; } } if (f.length || row.length) { row.push(f); rows.push(row); } return rows; }
function emails(s) { if (!s) return []; const m = ("" + s).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []; return [...new Set(m.map(x => x.toLowerCase()))]; }
function cleanDesc(s) { s = ("" + (s || "")).trim(); return /^[\[{]/.test(s) ? "" : s; } // descarta about en JSON
function rowToLead(H, r) { const gi = n => H.indexOf(n), g = n => { const i = gi(n); return i >= 0 ? (r[i] || "").trim() : ""; }; const t = g("title"); if (!t) return null; return { title: t, category: g("category"), address: g("complete_address") || g("address"), phone: g("phone"), website: g("website"), emails: emails(g("emails")), rating: parseFloat(g("review_rating")) || 0, reviews: parseInt((g("review_count") || "").replace(/\D/g, "")) || 0, lat: parseFloat(g("latitude")) || 0, lon: parseFloat(g("longitude")) || 0, link: g("link"), thumb: g("thumbnail"), about: cleanDesc(g("descriptions") || g("about")), images: (g("images") || "").split(/[|;,\s]+/).filter(u => /^https?:/.test(u)).slice(0, 6) }; }
function idOf(l) { const ph = (l.phone || "").replace(/\D/g, ""); return l.link || (ph ? "tel:" + ph : (l.title + "|" + l.address)); }
function addLead(l) { const id = idOf(l); if (!db.leads[id]) { db.leads[id] = l; db.order.push(id); if (scan) scan.found++; if (curCell) curCell.found++; broadcast("lead", l); notifyLead(l); save(); return true; } else { const meta = db.leads[id]._meta; db.leads[id] = Object.assign(l, { _meta: meta }); return false; } }

// ---------- Escaneo por cuadrícula ----------
let scan = null, child = null, pollT = null, demoT = null, nextT = null, curCell = null, curEmitted = 0, lastLogB = 0;
const BLOCK_RE = /ERR_TUNNEL|\b429\b|\b403\b|captcha|unusual traffic|too many requests|rate.?limit|sorry\/index/i;
function statusObj() { if (!scan) return { running: false }; const done = scan.cells.filter(c => ["done", "empty", "error"].includes(c.state)).length; return { running: scan.running, paused: scan.paused, mode: scan.mode, cellsTotal: scan.cells.length, cellsDone: done, found: scan.found }; }
function computeCells(area, cellKm) { const [s, w, n, e] = area, latC = (s + n) / 2, dLat = cellKm / 111, dLon = cellKm / (111 * Math.cos(latC * Math.PI / 180)), cells = []; for (let lat = s; lat < n; lat += dLat) for (let lon = w; lon < e; lon += dLon) { const top = Math.min(lat + dLat, n), right = Math.min(lon + dLon, e); cells.push({ key: lat.toFixed(4) + "_" + lon.toFixed(4), bbox: [lat, lon, top, right], state: "pending", found: 0 }); } return cells; }
function startScan(cfgIn) {
  if (scan && scan.running) return { error: "Ya hay un escaneo en curso." };
  const area = cfgIn.area; if (!area || area.length !== 4) return { error: "Falta el área a escanear." };
  const cellKm = Math.max(0.2, cfgIn.cellKm || 1);
  const cells = computeCells(area, cellKm);
  if (!cells.length) return { error: "El área es muy pequeña." };
  if (cells.length > 600) return { error: "Demasiadas celdas (" + cells.length + "). Sube el tamaño de celda o achica el área." };
  const queries = (cfgIn.mode === "rubros" && Array.isArray(cfgIn.rubros) && cfgIn.rubros.length) ? cfgIn.rubros : CATEGORIES;
  scan = { mode: cfgIn.mode === "rubros" ? "rubros" : "all", demo: !!cfgIn.demo, cells, idx: 0, cellKm, queries, email: !!cfgIn.email, proxies: cfgIn.proxies || cfg.proxies || "", running: true, paused: false, found: 0, area, consecBlocks: 0 };
  log(`Inicio ${scan.mode} · ${cells.length} celdas · celda ${cellKm}km${scan.demo ? " (demo)" : ""}`);
  broadcast("cells", { cells: cells.map(c => ({ key: c.key, bbox: c.bbox, state: c.state })), area, total: cells.length });
  broadcast("status", statusObj());
  processNext();
  return { ok: true, cells: cells.length, mode: scan.mode };
}
function processNext() { if (!scan || !scan.running || scan.paused) return; const cell = scan.cells[scan.idx]; if (!cell) return finish(); cell.state = "scanning"; broadcast("cell", { key: cell.key, state: "scanning", found: 0 }); broadcast("status", statusObj()); if (scan.demo) return demoCell(cell); runCell(cell); }
function scheduleNext() { if (!scan || !scan.running || scan.paused) return; let lo = cfg.safeMode ? (cfg.pauseMin || 3) : 0, hi = cfg.safeMode ? (cfg.pauseMax || 8) : 0; if (hi < lo) hi = lo; if (scan.consecBlocks > 0) { lo = Math.max(lo, 12 * scan.consecBlocks); hi = Math.max(hi, 25 * scan.consecBlocks); } const ms = scan.demo ? 250 : Math.round((lo + Math.random() * (hi - lo)) * 1000); nextT = setTimeout(processNext, ms); }
function advance() { if (!scan) return; scan.idx++; broadcast("progress", { cellsDone: scan.idx, cellsTotal: scan.cells.length, found: scan.found }); scheduleNext(); }
function nextCell() { advance(); }
function finishCell(cell) {
  cell.state = cell.found > 0 ? "done" : (cell._blocked ? "error" : "empty");
  broadcast("cell", { key: cell.key, state: cell.state, found: cell.found });
  if (cell._blocked) scan.consecBlocks = (scan.consecBlocks || 0) + 1; else if (cell.found > 0) scan.consecBlocks = 0;
  if (cfg.safeMode && scan.consecBlocks >= (cfg.maxBlocks || 4)) { log("Auto-pausa anti-baneo tras " + scan.consecBlocks + " celdas con posible bloqueo"); broadcast("blocked", { consec: scan.consecBlocks }); scan.paused = true; scan.idx++; broadcast("progress", { cellsDone: scan.idx, cellsTotal: scan.cells.length, found: scan.found }); broadcast("status", statusObj()); return; }
  advance();
}
function runCell(cell) {
  fs.writeFileSync(Q_FILE, scan.queries.join("\n") + "\n"); try { fs.writeFileSync(CELL_CSV, ""); } catch (e) {}
  curCell = cell; curEmitted = 0;
  const bb = cell.bbox.map(x => x.toFixed(5)).join(",");
  const cmd = buildCmd(bb);
  if (cmd.error) { log("ERROR: " + cmd.error); broadcast("error", { message: cmd.error }); scan.running = false; broadcast("status", statusObj()); return; }
  try { child = spawn(cmd.cmd, cmd.args, { cwd: ROOT }); }
  catch (e) { cell.state = "error"; broadcast("cell", { key: cell.key, state: "error" }); return nextCell(); }
  child.stderr.on("data", d => { const s = d.toString().trim(); if (!s) return; log(s.slice(0, 200)); if (BLOCK_RE.test(s)) cell._blocked = true; const now = Date.now(); if (/panic|cannot|refused|no such|not found|forbidden|blocked|denied|ERR_/i.test(s) && now - lastLogB > 4000) { lastLogB = now; broadcast("log", { line: s.slice(0, 150) }); } });
  pollT = setInterval(() => ingestCell(), 700);
  child.on("exit", () => { clearInterval(pollT); ingestCell(); child = null; finishCell(cell); });
  child.on("error", () => { clearInterval(pollT); child = null; cell.state = "error"; broadcast("cell", { key: cell.key, state: "error" }); nextCell(); });
}
function ingestCell() { let text; try { text = fs.readFileSync(CELL_CSV, "utf8"); } catch (e) { return; } if (!text) return; const endsNL = /\n$/.test(text); let rows = parseCSV(text); if (!endsNL && rows.length) rows = rows.slice(0, -1); if (rows.length < 2) return; const H = rows[0].map(h => h.trim().toLowerCase()); for (let i = 1 + curEmitted; i < rows.length; i++) { const l = rowToLead(H, rows[i]); if (l) addLead(l); } curEmitted = rows.length - 1; }
function findBin() { if (process.env.SCRAPER_BIN && fs.existsSync(process.env.SCRAPER_BIN)) return process.env.SCRAPER_BIN; for (const p of [path.join(ROOT, "gms"), path.join(ROOT, "..", "google-maps-scraper", "gms")]) if (fs.existsSync(p)) return p; return null; }
function buildCmd(bb) {
  const grid = ["-grid-bbox", bb, "-grid-cell", String(scan.cellKm), "-zoom", "15"];
  const extra = ["-c", "1"]; if (scan.email) extra.push("-email"); const px = (scan.proxies || "").split(/[\n,]+/).map(s => s.trim()).filter(Boolean); if (px.length) extra.push("-proxies", px.join(",")); if (cfg.leadsdbKey) extra.push("-leadsdb-api-key", cfg.leadsdbKey); if (cfg.depth > 0) extra.push("-depth", String(cfg.depth));
  if (process.env.SCRAPER_MODE === "docker") {
    const a = ["run", "--rm", "-v", `${DATA}:/out`, "-v", `${Q_FILE}:/queries.txt:ro`, "gosom/google-maps-scraper", "-input", "/queries.txt", "-results", "/out/cell.csv", "-lang", "es", "-exit-on-inactivity", "20s", ...extra, ...grid];
    return { cmd: "docker", args: a };
  }
  const bin = findBin(); if (!bin) return { error: "No encuentro 'gms'. Compílalo (go build), define SCRAPER_BIN o usa SCRAPER_MODE=docker." };
  return { cmd: bin, args: ["-input", Q_FILE, "-results", CELL_CSV, "-lang", "es", "-exit-on-inactivity", "20s", ...extra, ...grid] };
}
function finish() { if (!scan) return; scan.running = false; db.history.unshift({ ts: Date.now(), found: scan.found, cells: scan.cells.length, mode: scan.mode, area: scan.area }); db.history = db.history.slice(0, 50); save(); broadcast("status", statusObj()); broadcast("done", { found: scan.found, cells: scan.cells.length }); log(`Fin · ${scan.found} negocios`); }
function pause() { if (scan) { scan.paused = true; broadcast("status", statusObj()); } return { ok: true }; }
function resume() { if (scan) { scan.paused = false; scan.consecBlocks = 0; broadcast("status", statusObj()); processNext(); } return { ok: true }; }
function stop() { if (demoT) { clearTimeout(demoT); demoT = null; } if (nextT) { clearTimeout(nextT); nextT = null; } if (pollT) { clearInterval(pollT); pollT = null; } if (child) { try { child.kill("SIGTERM"); } catch (e) {} child = null; } if (scan) { scan.running = false; broadcast("status", statusObj()); broadcast("done", { found: scan.found, cells: scan.cells.length }); } return { ok: true }; }

const DNAMES = [["Botica ", "Farmacia", 0], ["Restaurante ", "Restaurante", 1], ["Barbería ", "Barbería", 0], ["Ferretería ", "Ferretería", 0], ["Gimnasio ", "Gimnasio", 1], ["Bodega ", "Bodega", 0], ["Dental ", "Clínica dental", 1], ["TecniCell ", "Taller de celulares", 0]];
const SUF = ["San Martín", "Central", "Los Andes", "El Sol", "Perú", "Miraflores", "Norte", "Express"];
let demoN = 0;
function demoCell(cell) {
  demoT = setTimeout(() => {
    curCell = cell; const k = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < k; i++) { const [pre, cat, web] = DNAMES[demoN % DNAMES.length]; const lat = cell.bbox[0] + Math.random() * (cell.bbox[2] - cell.bbox[0]); const lon = cell.bbox[1] + Math.random() * (cell.bbox[3] - cell.bbox[1]); demoN++;
      addLead({ title: pre + SUF[demoN % SUF.length], category: cat, address: "Calle Demo " + (100 + demoN) + ", Lima", phone: "+51 9" + (10000000 + demoN * 137 % 89999999), website: web ? "https://demo" + demoN + ".pe" : "", emails: web ? ["demo" + demoN + "@mail.com"] : [], rating: (3.8 + Math.random() * 1.2), reviews: 10 + (demoN * 37 % 900), lat, lon, link: "https://maps.google.com/demo/" + demoN, thumb: "", about: "Negocio de ejemplo para probar el panel.", images: [] });
    }
    finishCell(cell);
  }, 500);
}
function updateLead(id, patch) { const l = db.leads[id]; if (!l) return { error: "no existe" }; l._meta = Object.assign({}, l._meta, patch); save(); broadcast("update", { id, meta: l._meta }); return { ok: true }; }

// ---------- HTTP ----------
function body(req) { return new Promise(r => { let b = ""; req.on("data", d => b += d); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch (e) { r({}); } }); }); }
function json(res, o, code = 200) { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(o)); }
function authed(req, res) { if (!AUTH) return true; const h = req.headers.authorization || ""; const ok = h.startsWith("Basic ") && Buffer.from(h.slice(6), "base64").toString() === AUTH; if (!ok) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="BUSCA-CHAMBA-3000"' }); res.end("Autenticación requerida"); return false; } return true; }
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" }); return res.end(); }
  if (!authed(req, res)) return;
  if (p === "/" || p === "/dashboard.html") { let h; try { h = fs.readFileSync(path.join(ROOT, "dashboard.html")); } catch (e) { res.writeHead(404); return res.end("dashboard.html no encontrado"); } res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(h); }
  if (p === "/api/status") return json(res, statusObj());
  if (p === "/api/leads") return json(res, { status: statusObj(), leads: db.order.map(id => db.leads[id]).filter(Boolean), cells: scan ? scan.cells.map(c => ({ key: c.key, bbox: c.bbox, state: c.state, found: c.found })) : [], categories: CATEGORIES, history: db.history || [] });
  if (p === "/api/stream") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" }); res.write("retry: 3000\n\n"); res.write(`event: status\ndata: ${JSON.stringify(statusObj())}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return; }
  if (p === "/api/scan/start" && req.method === "POST") return json(res, startScan(await body(req)));
  if (p === "/api/scan/pause" && req.method === "POST") return json(res, pause());
  if (p === "/api/scan/resume" && req.method === "POST") return json(res, resume());
  if (p === "/api/scan/stop" && req.method === "POST") return json(res, stop());
  if (p === "/api/lead/update" && req.method === "POST") { const b = await body(req); return json(res, updateLead(b.id, b.patch || {})); }
  if (p === "/api/config" && req.method === "GET") return json(res, { telegramChat: cfg.telegramChat, hasToken: !!cfg.telegramToken, webhookUrl: cfg.webhookUrl, proxies: cfg.proxies, notify: !!cfg.notify, leadsdb: !!cfg.leadsdbKey, safeMode: cfg.safeMode !== false, pauseMin: cfg.pauseMin, pauseMax: cfg.pauseMax });
  if (p === "/api/config" && req.method === "POST") { const b = await body(req); ["telegramToken", "telegramChat", "webhookUrl", "proxies", "leadsdbKey"].forEach(k => { if (typeof b[k] === "string") cfg[k] = b[k]; }); ["pauseMin", "pauseMax", "depth", "maxBlocks"].forEach(k => { if (typeof b[k] === "number" && b[k] >= 0) cfg[k] = b[k]; }); if (b.notify !== undefined) cfg.notify = !!b.notify; if (b.safeMode !== undefined) cfg.safeMode = !!b.safeMode; saveCfg(); return json(res, { ok: true }); }
  if (p === "/api/test-telegram" && req.method === "POST") { const b = await body(req); if (b && typeof b.telegramToken === "string" && b.telegramToken) { cfg.telegramToken = b.telegramToken; cfg.telegramChat = b.telegramChat || cfg.telegramChat; saveCfg(); } return json(res, await tgSend("✅ BUSCA-CHAMBA-3000 conectado. Aquí te llegarán los leads nuevos.")); }
  if (p === "/api/logs") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }); return res.end(logs.join("\n") || "(sin logs)"); }
  if (p === "/api/reset" && req.method === "POST") { db = { leads: {}, order: [], history: db.history || [] }; scan = null; save(); broadcast("reset", {}); return json(res, { ok: true }); }
  res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("not found");
});
server.listen(PORT, () => console.log(`BUSCA-CHAMBA-3000 → http://localhost:${PORT}  (${db.order.length} leads${AUTH ? ", con login" : ""})`));

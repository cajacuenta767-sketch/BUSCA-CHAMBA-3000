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

// Rubros agrupados en "grupos selectos" (limpio, sin repetidos ni nombres sueltos).
// El frontend usa los mismos grupos; aquí se aplanan para el modo "Todo el área".
const CATEGORY_GROUPS = [
  { name: "Comida y bebida", items: ["restaurante", "pollería", "chifa", "cevichería", "cafetería", "juguería", "panadería", "pizzería"] },
  { name: "Salud", items: ["farmacia", "botica", "clínica dental", "consultorio médico", "veterinaria", "óptica"] },
  { name: "Belleza y cuidado", items: ["peluquería", "barbería", "spa", "gimnasio"] },
  { name: "Tiendas y comercio", items: ["bodega", "minimarket", "tienda de ropa", "zapatería", "librería", "ferretería", "florería", "juguetería"] },
  { name: "Servicios técnicos", items: ["taller de celulares", "cerrajería", "lavandería", "imprenta", "taller mecánico"] },
  { name: "Profesionales", items: ["estudio contable", "estudio jurídico", "inmobiliaria", "agencia de viajes"] },
  { name: "Hospedaje", items: ["hotel", "hostal"] },
];
const CATEGORIES = [...new Set(CATEGORY_GROUPS.flatMap(g => g.items))];

// ---------- DB & Config ----------
let db = load(DB_FILE, { leads: {}, order: [], history: [], scanned: [] });
let cfg = load(CFG_FILE, { telegramToken: "", telegramChat: "", webhookUrl: "", proxies: "", leadsdbKey: "", notify: false, safeMode: true, pauseMin: 3, pauseMax: 8, depth: 0, maxBlocks: 4, subdivide: true, subdivideAt: 90, exclude: "", maxLeads: 0, retryFailed: true });
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

// ---------- Proxies públicas (opcional; ver riesgos en README) ----------
const PROXY_SOURCES = [
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
  "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
  "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=8000&country=all&ssl=all&anonymity=all",
  "https://www.proxy-list.download/api/v1/get?type=http",
  "https://openproxylist.xyz/http.txt"
];
function httpGet(url) { return new Promise(res => { try { const u = new URL(url); const lib = u.protocol === "http:" ? http : https; const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method: "GET", timeout: 12000, headers: { "User-Agent": "Mozilla/5.0" } }, r => { let b = ""; r.on("data", d => b += d); r.on("end", () => res(b)); }); req.on("error", () => res("")); req.on("timeout", () => { req.destroy(); res(""); }); req.end(); } catch (e) { res(""); } }); }
async function fetchProxyList() { const set = new Set(); await Promise.all(PROXY_SOURCES.map(async s => { const t = await httpGet(s); (t.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}\b/g) || []).forEach(p => set.add(p)); })); return [...set].slice(0, 12000); }
function testProxy(pxy) { return new Promise(res => { const m = pxy.replace(/^https?:\/\//, "").split(":"), host = m[0], port = +m[1] || 8080; let done = false; const fin = ok => { if (!done) { done = true; res(ok); } }; try { const req = http.request({ host, port, method: "GET", path: "http://www.google.com/generate_204", headers: { Host: "www.google.com" }, timeout: 5000 }, r => { r.destroy(); fin(true); }); req.on("error", () => fin(false)); req.on("timeout", () => { req.destroy(); fin(false); }); req.end(); } catch (e) { fin(false); } }); }
async function fetchAndTestProxies() { const list = await fetchProxyList(); const working = []; const batch = 50; const deadline = Date.now() + 75000; for (let i = 0; i < list.length && working.length < 250 && Date.now() < deadline; i += batch) { const chunk = list.slice(i, i + batch); const ok = await Promise.all(chunk.map(testProxy)); chunk.forEach((p, j) => { if (ok[j]) working.push("http://" + p); }); } log(`Proxies: ${working.length} vivas de ${list.length} candidatas`); return { total: list.length, working }; }

function normalizeProxy(s) { s = ("" + s).trim(); if (!s) return ""; if (/^(https?|socks5h?):\/\//i.test(s)) return s; const p = s.split(":"); if (p.length === 4) return `http://${p[2]}:${p[3]}@${p[0]}:${p[1]}`; if (p.length === 2) return `http://${p[0]}:${p[1]}`; if (s.includes("@")) return "http://" + s; return "http://" + s; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- CSV ----------
function parseCSV(t) { const rows = []; let row = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else { if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c; } } if (f.length || row.length) { row.push(f); rows.push(row); } return rows; }
function emails(s) { if (!s) return []; const m = ("" + s).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []; return [...new Set(m.map(x => x.toLowerCase()))]; }
// Descripción: si es texto, se deja; si es el JSON de atributos de Google
// (lo que ofrece el negocio), se convierte en texto legible en vez de descartarlo.
function descFrom(s) {
  s = ("" + (s == null ? "" : s)).trim();
  if (!s) return "";
  if (!/^[\[{]/.test(s)) return s;
  try {
    const o = JSON.parse(s), arr = Array.isArray(o) ? o : [o], out = [];
    for (const gg of arr) {
      if (gg == null) continue;
      if (typeof gg === "string") { out.push(gg); continue; }
      const opts = gg.options || gg.Options;
      if (Array.isArray(opts)) for (const op of opts) {
        if (typeof op === "string") out.push(op);
        else if (op && typeof op === "object") { if (op.enabled === false || op.Enabled === false) continue; const nm = op.name || op.Name; if (nm) out.push(nm); }
      }
    }
    const uniq = [...new Set(out.map(x => ("" + x).trim()).filter(x => x.length > 1 && !/^\d+$/.test(x)))];
    return uniq.slice(0, 14).join(" · ").slice(0, 240);
  } catch (e) { return ""; }
}
function jsonAddr(str) { try { let o = JSON.parse(str); if (Array.isArray(o)) o = o[0] || {}; if (!o || typeof o !== "object") return null; const street = ("" + (o.street || "")).replace(/^[A-Z0-9]{4,}\+[A-Z0-9]+,?\s*/, "").trim(); const a = [street, o.borough, o.city, o.state, o.country].map(x => ("" + (x || "")).trim()).filter(Boolean).join(", "); return { address: a, city: ("" + (o.city || "")).trim() }; } catch (e) { return null; } }
function parseAddr(g) { const plain = (g("address") || "").trim(), comp = (g("complete_address") || "").trim(); const j = /^[\[{]/.test(comp) ? comp : (/^[\[{]/.test(plain) ? plain : ""); if (j) { const r = jsonAddr(j); if (r) return r; } const a = plain && !/^[\[{]/.test(plain) ? plain : (comp && !/^[\[{]/.test(comp) ? comp : ""); const p = a.split(",").map(s => s.trim()).filter(Boolean); return { address: a, city: p[p.length - 1] || "" }; }
function rowToLead(H, r) { const gi = n => H.indexOf(n), g = n => { const i = gi(n); return i >= 0 ? (r[i] || "").trim() : ""; }; const t = g("title"); if (!t) return null; const pa = parseAddr(g); return { title: t, category: g("category"), address: pa.address, city: pa.city, phone: g("phone"), website: g("website"), emails: emails(g("emails")), rating: parseFloat(g("review_rating")) || 0, reviews: parseInt((g("review_count") || "").replace(/\D/g, "")) || 0, lat: parseFloat(g("latitude")) || 0, lon: parseFloat(g("longitude")) || 0, link: g("link"), place_id: g("place_id") || g("cid"), thumb: g("thumbnail"), about: descFrom(g("descriptions") || g("about")), images: (g("images") || "").split(/[|;,\s]+/).filter(u => /^https?:/.test(u)).slice(0, 6) }; }
function idOf(l) { const ph = (l.phone || "").replace(/\D/g, ""); return l.place_id || l.link || (ph ? "tel:" + ph : (l.title + "|" + l.address)); }
function addLead(l) {
  if (scan && scan.exclude && scan.exclude.length) { const t = (l.title || "").toLowerCase(); if (scan.exclude.some(x => t.includes(x))) return false; }
  const id = idOf(l);
  if (!db.leads[id]) {
    db.leads[id] = l; db.order.push(id); if (scan) scan.found++; if (curCell) curCell.found++; broadcast("lead", l); notifyLead(l); save();
    if (scan && scan.maxLeads && scan.found >= scan.maxLeads && scan.running && !scan.paused) { scan.paused = true; log("Auto-pausa: tope de " + scan.maxLeads + " leads"); broadcast("notice", { msg: "Alcanzaste el tope de " + scan.maxLeads + " leads — escaneo en pausa." }); broadcast("status", statusObj()); }
    return true;
  } else { const meta = db.leads[id]._meta; db.leads[id] = Object.assign(l, { _meta: meta }); return false; }
}

// ---------- Escaneo por cuadrícula ----------
let scan = null, child = null, pollT = null, demoT = null, nextT = null, curCell = null, curEmitted = 0, lastLogB = 0;
const BLOCK_RE = /ERR_TUNNEL|\b429\b|\b403\b|captcha|unusual traffic|too many requests|rate.?limit|sorry\/index/i;
function statusObj() { if (!scan) return { running: false }; const done = scan.cells.filter(c => ["done", "empty", "error"].includes(c.state)).length; return { running: scan.running, paused: scan.paused, mode: scan.mode, cellsTotal: scan.cells.length, cellsDone: done, found: scan.found }; }
function computeCells(area, cellKm) { const [s, w, n, e] = area, latC = (s + n) / 2, dLat = cellKm / 111, dLon = cellKm / (111 * Math.cos(latC * Math.PI / 180)), cells = []; for (let lat = s; lat < n; lat += dLat) for (let lon = w; lon < e; lon += dLon) { const top = Math.min(lat + dLat, n), right = Math.min(lon + dLon, e); cells.push({ key: lat.toFixed(4) + "_" + lon.toFixed(4), bbox: [lat, lon, top, right], state: "pending", found: 0, km: cellKm, depth: 0 }); } return cells; }
function splitCell(c) { const [s, w, n, e] = c.bbox, mLat = (s + n) / 2, mLon = (w + e) / 2, km = (c.km || 1) / 2, d = (c.depth || 0) + 1; return [[s, w, mLat, mLon], [s, mLon, mLat, e], [mLat, w, n, mLon], [mLat, mLon, n, e]].map((bb, i) => ({ key: c.key + "s" + i, bbox: bb, state: "pending", found: 0, km, depth: d })); }
function startScan(cfgIn) {
  if (scan && scan.running) return { error: "Ya hay un escaneo en curso." };
  const area = cfgIn.area; if (!area || area.length !== 4) return { error: "Falta el área a escanear." };
  let cellKm = Math.max(0.2, cfgIn.cellKm || 1);
  let cells = computeCells(area, cellKm);
  if (!cells.length) return { error: "El área es muy pequeña." };
  // Área grande: en vez de bloquear con "demasiadas celdas", subimos solos el
  // tamaño de celda hasta que el área entre. Así siempre se puede escanear.
  const CAP = 550; const askedKm = cellKm; let adjusted = false;
  while (cells.length > CAP && cellKm < 25) { cellKm = Math.round((cellKm + (cellKm < 3 ? 0.3 : 1)) * 10) / 10; cells = computeCells(area, cellKm); adjusted = true; }
  if (cells.length > CAP) return { error: "Esa área es enorme. Elige una ciudad o zona más específica." };
  const cLat = (area[0] + area[2]) / 2, cLon = (area[1] + area[3]) / 2;
  cells.sort((a, b) => Math.hypot((a.bbox[0] + a.bbox[2]) / 2 - cLat, (a.bbox[1] + a.bbox[3]) / 2 - cLon) - Math.hypot((b.bbox[0] + b.bbox[2]) / 2 - cLat, (b.bbox[1] + b.bbox[3]) / 2 - cLon)); // espiral: del centro hacia afuera
  if (cfgIn.skipScanned && Array.isArray(db.scanned) && db.scanned.length) { const done = new Set(db.scanned); cells = cells.filter(c => !done.has(c.key)); }
  if (!cells.length) return { error: "Toda esa zona ya fue escaneada (desmarca 'solo lo nuevo')." };
  const queries = (cfgIn.mode === "rubros" && Array.isArray(cfgIn.rubros) && cfgIn.rubros.length) ? cfgIn.rubros : CATEGORIES;
  const proxyList = shuffle(String(cfgIn.proxies || cfg.proxies || "").split(/[\n,]+/).map(s => normalizeProxy(s)).filter(Boolean));
  const exclude = (Array.isArray(cfgIn.exclude) ? cfgIn.exclude : String(cfgIn.exclude != null ? cfgIn.exclude : (cfg.exclude || "")).split(",")).map(s => ("" + s).trim().toLowerCase()).filter(Boolean);
  scan = { mode: cfgIn.mode === "rubros" ? "rubros" : "all", demo: !!cfgIn.demo, cells, idx: 0, cellKm, queries, email: !!cfgIn.email, proxyList, proxyIdx: 0, exclude, maxLeads: +cfgIn.maxLeads || +cfg.maxLeads || 0, running: true, paused: false, found: 0, area, consecBlocks: 0, retried: false, curProxy: null };
  log(`Inicio ${scan.mode} · ${cells.length} celdas · celda ${cellKm}km${scan.demo ? " (demo)" : ""}`);
  if (adjusted) { const m = `Área grande: ajusté la celda de ${askedKm} a ${cellKm} km para cubrirla en ${cells.length} celdas.`; log(m); broadcast("notice", { msg: m }); }
  broadcast("cells", { cells: cells.map(c => ({ key: c.key, bbox: c.bbox, state: c.state })), area, total: cells.length });
  broadcast("status", statusObj());
  processNext();
  return { ok: true, cells: cells.length, mode: scan.mode, cellKm, adjusted, askedKm };
}
function processNext() { if (!scan || !scan.running || scan.paused) return; const cell = scan.cells[scan.idx]; if (!cell) return finish(); cell.state = "scanning"; broadcast("cell", { key: cell.key, state: "scanning", found: 0 }); broadcast("status", statusObj()); if (scan.demo) return demoCell(cell); runCell(cell); }
function scheduleNext() { if (!scan || !scan.running || scan.paused) return; let lo = cfg.safeMode ? (cfg.pauseMin || 3) : 0, hi = cfg.safeMode ? (cfg.pauseMax || 8) : 0; if (hi < lo) hi = lo; if (scan.consecBlocks > 0) { lo = Math.max(lo, 12 * scan.consecBlocks); hi = Math.max(hi, 25 * scan.consecBlocks); } const ms = scan.demo ? 250 : Math.round((lo + Math.random() * (hi - lo)) * 1000); nextT = setTimeout(processNext, ms); }
function advance() { if (!scan) return; scan.idx++; broadcast("progress", { cellsDone: scan.idx, cellsTotal: scan.cells.length, found: scan.found }); scheduleNext(); }
function nextCell() { advance(); }
function finishCell(cell) {
  // Iterar entre proxies: si una celda se bloquea, reintentar con otra proxy (no perder la celda)
  if (cell._blocked && scan.proxyList && scan.proxyList.length > 0 && (cell._tries || 0) < 3 && !scan.paused && !scan.demo) {
    cell._tries = (cell._tries || 0) + 1; cell._blocked = false; cell.found = 0;
    log("Reintento de celda con otra proxy (intento " + cell._tries + ")");
    broadcast("cell", { key: cell.key, state: "scanning" });
    nextT = setTimeout(() => runCell(cell), 800); return;
  }
  cell.state = cell.found > 0 ? "done" : (cell._blocked ? "error" : "empty");
  broadcast("cell", { key: cell.key, state: cell.state, found: cell.found });
  if (cell._blocked) scan.consecBlocks = (scan.consecBlocks || 0) + 1; else if (cell.found > 0) scan.consecBlocks = 0;
  if (cfg.safeMode && scan.consecBlocks >= (cfg.maxBlocks || 4)) { log("Auto-pausa anti-baneo tras " + scan.consecBlocks + " celdas con posible bloqueo"); broadcast("blocked", { consec: scan.consecBlocks }); scan.paused = true; scan.idx++; broadcast("progress", { cellsDone: scan.idx, cellsTotal: scan.cells.length, found: scan.found }); broadcast("status", statusObj()); return; }
  if (!scan.demo && cfg.subdivide !== false && cell.found >= (cfg.subdivideAt || 90) && ((cell.km || scan.cellKm) > 0.35) && (cell.depth || 0) < 2) { const subs = splitCell(cell); scan.cells.splice(scan.idx + 1, 0, ...subs); broadcast("cellsadd", { cells: subs.map(c => ({ key: c.key, bbox: c.bbox, state: "pending" })) }); log("Celda densa subdividida en 4 (" + cell.found + " negocios)"); }
  advance();
}
function runCell(cell) {
  if (scan.proxyList && scan.proxyList.length) { if (scan.proxyIdx >= scan.proxyList.length) { shuffle(scan.proxyList); scan.proxyIdx = 0; } scan.curProxy = scan.proxyList[scan.proxyIdx]; scan.proxyIdx++; log("Celda " + cell.key + " → proxy " + scan.curProxy.replace(/\/\/.*@/, "//***@")); }
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
  const grid = ["-grid-bbox", bb, "-grid-cell", String((curCell && curCell.km) || scan.cellKm), "-zoom", "15"];
  const extra = ["-c", "1"]; if (scan.email) extra.push("-email"); if (scan.curProxy) extra.push("-proxies", scan.curProxy); if (cfg.leadsdbKey) extra.push("-leadsdb-api-key", cfg.leadsdbKey); if (cfg.depth > 0) extra.push("-depth", String(cfg.depth));
  if (process.env.SCRAPER_MODE === "docker") {
    const a = ["run", "--rm", "-v", `${DATA}:/out`, "-v", `${Q_FILE}:/queries.txt:ro`, "gosom/google-maps-scraper", "-input", "/queries.txt", "-results", "/out/cell.csv", "-lang", "es", "-exit-on-inactivity", "20s", ...extra, ...grid];
    return { cmd: "docker", args: a };
  }
  const bin = findBin(); if (!bin) return { error: "No encuentro 'gms'. Compílalo (go build), define SCRAPER_BIN o usa SCRAPER_MODE=docker." };
  return { cmd: bin, args: ["-input", Q_FILE, "-results", CELL_CSV, "-lang", "es", "-exit-on-inactivity", "20s", ...extra, ...grid] };
}
function finish() {
  if (!scan) return;
  const errs = scan.cells.filter(c => c.state === "error");
  if (cfg.retryFailed !== false && !scan.retried && errs.length && !scan.paused) { scan.retried = true; scan.idx = scan.cells.length; errs.forEach(c => scan.cells.push(Object.assign({}, c, { state: "pending", _blocked: false }))); log("Reintentando " + errs.length + " celdas con error"); broadcast("status", statusObj()); return scheduleNext(); }
  scan.running = false;
  db.scanned = [...new Set((db.scanned || []).concat(scan.cells.filter(c => c.state === "done" || c.state === "empty").map(c => c.key)))].slice(-5000);
  db.history.unshift({ ts: Date.now(), found: scan.found, cells: scan.cells.length, mode: scan.mode, area: scan.area }); db.history = db.history.slice(0, 50); save();
  broadcast("status", statusObj()); broadcast("done", { found: scan.found, cells: scan.cells.length }); log(`Fin · ${scan.found} negocios`);
  if (cfg.notify && cfg.telegramToken && cfg.telegramChat) tgSend("✅ Escaneo terminado: <b>" + scan.found + "</b> negocios en " + scan.cells.length + " celdas.");
}
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
  if (p === "/api/config" && req.method === "GET") return json(res, { telegramChat: cfg.telegramChat, hasToken: !!cfg.telegramToken, webhookUrl: cfg.webhookUrl, proxies: cfg.proxies, notify: !!cfg.notify, leadsdb: !!cfg.leadsdbKey, safeMode: cfg.safeMode !== false, pauseMin: cfg.pauseMin, pauseMax: cfg.pauseMax, exclude: cfg.exclude || "", maxLeads: cfg.maxLeads || 0, retryFailed: cfg.retryFailed !== false });
  if (p === "/api/config" && req.method === "POST") { const b = await body(req); ["telegramToken", "telegramChat", "webhookUrl", "proxies", "leadsdbKey", "exclude"].forEach(k => { if (typeof b[k] === "string") cfg[k] = b[k]; }); ["pauseMin", "pauseMax", "depth", "maxBlocks", "subdivideAt", "maxLeads"].forEach(k => { if (typeof b[k] === "number" && b[k] >= 0) cfg[k] = b[k]; }); if (b.notify !== undefined) cfg.notify = !!b.notify; if (b.safeMode !== undefined) cfg.safeMode = !!b.safeMode; if (b.subdivide !== undefined) cfg.subdivide = !!b.subdivide; if (b.retryFailed !== undefined) cfg.retryFailed = !!b.retryFailed; saveCfg(); return json(res, { ok: true }); }
  if (p === "/api/test-telegram" && req.method === "POST") { const b = await body(req); if (b && typeof b.telegramToken === "string" && b.telegramToken) { cfg.telegramToken = b.telegramToken; cfg.telegramChat = b.telegramChat || cfg.telegramChat; saveCfg(); } return json(res, await tgSend("✅ BUSCA-CHAMBA-3000 conectado. Aquí te llegarán los leads nuevos.")); }
  if (p === "/api/logs") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }); return res.end(logs.join("\n") || "(sin logs)"); }
  if (p === "/api/proxies/fetch" && req.method === "POST") { const r = await fetchAndTestProxies(); if (r.working.length) { cfg.proxies = r.working.join("\n"); saveCfg(); } return json(res, { total: r.total, working: r.working.length, proxies: r.working.join("\n") }); }
  if (p === "/api/reset" && req.method === "POST") { db = { leads: {}, order: [], history: db.history || [], scanned: db.scanned || [] }; scan = null; save(); broadcast("reset", {}); return json(res, { ok: true }); }
  res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("not found");
});
// Proxies desde el backend (sin pegarlas en el frontend). Prioridad: env PROXIES,
// luego proxies.txt (una por línea). proxies.txt está en .gitignore → tus
// credenciales de pago NUNCA se suben a GitHub. Solo siembra si config está vacía.
function seedProxies() {
  if (cfg.proxies && cfg.proxies.trim()) return;
  let seed = "";
  if (process.env.PROXIES && process.env.PROXIES.trim()) seed = process.env.PROXIES.replace(/[;,]+/g, "\n");
  else { try { const f = path.join(ROOT, "proxies.txt"); if (fs.existsSync(f)) seed = fs.readFileSync(f, "utf8"); } catch (e) {} }
  seed = (seed || "").split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#")).join("\n");
  if (seed) { cfg.proxies = seed; saveCfg(); log("Proxies cargadas del backend (" + seed.split("\n").length + ") desde " + (process.env.PROXIES ? "env PROXIES" : "proxies.txt")); }
}
seedProxies();
server.listen(PORT, () => console.log(`BUSCA-CHAMBA-3000 → http://localhost:${PORT}  (${db.order.length} leads${AUTH ? ", con login" : ""})`));

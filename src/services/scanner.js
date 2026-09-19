"use strict";
/**
 * Orquestador del escaneo por cuadrícula: una celda = un trabajo del scraper.
 * Máquina de estados: idle → running (scanning cell → done/empty/error → pausa aleatoria → siguiente) → finished.
 * Incluye antibaneo (detección de bloqueos, backoff, rotación de proxies, enfriamiento),
 * subdivisión de celdas densas, reintento de celdas con error, watchdog y "continuar donde se quedó".
 *
 * Emite por el bus: status, cells, cell, cellsadd, progress, lead, notice, log, error, done.
 */
const { parseCSV } = require("../domain/csv");
const { rowToLead, leadId } = require("../domain/lead");
const { fitCells, sortFromCenter, markScanned, splitCell, countFinished } = require("../domain/grid");
const { parseProxyList, shuffle } = require("../domain/proxy");
const { CORE_ALL_CATEGORIES } = require("../config/categories");

const BLOCK_RE = /ERR_TUNNEL|\b429\b|\b403\b|captcha|unusual traffic|too many requests|rate.?limit|sorry\/index|connection reset/i;
const QUOTA_RE = /402 Payment Required|bandwidthlimit|net::ERR_PROXY_AUTH_UNSUPPORTED/i;
const NOISY_RE = /panic|cannot|refused|no such|not found|forbidden|blocked|denied|ERR_/i;
const MAX_CELLS = 550;
const WATCHDOG_MS = 100000; // ninguna celda queda colgada más de 100 s
const POLL_MS = 300;

class Scanner {
  constructor({ store, bus, settings, runner, proxies, notifier, log, demo, timers }) {
    this.store = store; this.bus = bus; this.settings = settings; this.runner = runner;
    this.proxies = proxies; this.notifier = notifier; this.log = log || (() => {});
    this.demo = demo; this.t = timers || { setTimeout, clearTimeout, setInterval, clearInterval };
    this.scan = null; this.child = null; this.curCell = null; this.curEmitted = 0;
    this.cellStart = 0; this.lastLogBroadcast = 0;
    this.nextT = null; this.pollT = null; this.cellTimer = null; this.demoT = null;
    this.watchdog = this.t.setInterval(() => this._watchdog(), 8000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  get running() { return !!(this.scan && this.scan.running); }

  /** Vista de estado que consume el panel (misma forma en reposo y en marcha). */
  status() {
    const s = this.scan;
    if (!s) return { running: false, backendProxies: this.proxies.backendProxies().length, totalDbLeads: this.store.countLeads(), dbScannedCount: this.store.countScanned() };
    const done = countFinished(s.cells);
    return {
      running: s.running, paused: s.paused, mode: s.mode,
      cellsTotal: s.cells.length, cellsDone: done, overallTotal: s.cells.length, overallDone: done,
      skipped: s.alreadyDoneCount || 0, found: s.found, sessionSeen: s.sessionSeen || 0,
      totalDbLeads: this.store.countLeads(),
      cellIdx: Math.min(s.idx + 1, s.cells.length),
      cellFound: this.curCell ? (this.curCell.found || 0) : 0,
      cellSecs: (s.running && !s.paused && this.cellStart) ? Math.round((Date.now() - this.cellStart) / 1000) : 0,
      scanSecs: s.startTime ? Math.round((Date.now() - s.startTime) / 1000) : 0,
      lastLeadSecs: s.lastLeadTime ? Math.round((Date.now() - s.lastLeadTime) / 1000) : null,
      queries: (s.queries || []).length,
      backendProxies: s.proxyList ? s.proxyList.length : this.proxies.backendProxies().length,
    };
  }

  cellsView() { return this.scan ? this.scan.cells.map((c) => ({ key: c.key, bbox: c.bbox, state: c.state, found: c.found })) : []; }

  _status() { this.bus.broadcast("status", this.status()); }
  _notice(msg) { this.bus.broadcast("notice", { msg }); }

  // ---------------------------------------------------------------- inicio
  async start(cfgIn = {}) {
    if (this.running) return { error: "Ya hay un escaneo en curso." };
    const area = cfgIn.area;
    if (!area || area.length !== 4) return { error: "Falta el área a escanear." };

    const fit = fitCells(area, cfgIn.cellKm, MAX_CELLS);
    if (!fit.cells.length) return { error: "El área es muy pequeña." };
    if (fit.tooBig) return { error: "Esa área es enorme. Elige una ciudad o zona más específica." };
    const { cells, cellKm, adjusted, askedKm } = fit;
    sortFromCenter(cells, area);

    // Continuar donde se quedó: celdas ya terminadas se pintan en verde y se saltan.
    const alreadyDoneCount = cfgIn.skipScanned !== false ? markScanned(cells, this.store.scannedKeys(), cellKm, area) : 0;
    const pendingCount = cells.filter((c) => c.state === "pending").length;
    if (pendingCount === 0) return { error: `Toda esa zona (${cells.length} celdas) ya fue revisada previamente. Si deseas volver a escanearla desde cero, desmarca "Continuar donde se quedó".` };
    const startIdx = Math.max(0, cells.findIndex((c) => c.state === "pending"));

    const queries = (cfgIn.mode === "rubros" && Array.isArray(cfgIn.rubros) && cfgIn.rubros.length) ? cfgIn.rubros : [...CORE_ALL_CATEGORIES];

    // Proxies: las del panel o las del backend; se prueba una muestra antes de iniciar.
    let candidates = parseProxyList(cfgIn.proxies);
    if (!candidates.length) candidates = this.proxies.backendProxies();
    let proxyList = [];
    if (candidates.length) {
      if (await this.proxies.anyAlive(candidates)) proxyList = shuffle([...new Set(candidates)]);
      else {
        this.log("⚠️ Las proxies configuradas no responden o agotaron su saldo (402 Payment Required / límite de saldo).");
        this.log("🛡️ Activando automáticamente MODO DIRECTO SEGURO (sin proxies, con pausas antibaneo para que el escáner NUNCA se detenga).");
        this._notice("Proxies sin saldo. El escáner continuará en Modo Directo Seguro automáticamente sin parar.");
      }
    }
    const excludeSrc = Array.isArray(cfgIn.exclude) ? cfgIn.exclude : String(cfgIn.exclude != null ? cfgIn.exclude : (this.settings.get("exclude") || "")).split(",");
    const exclude = excludeSrc.map((s) => String(s).trim().toLowerCase()).filter(Boolean);

    this.scan = {
      mode: cfgIn.mode === "rubros" ? "rubros" : "all", demo: !!cfgIn.demo, cells, idx: startIdx, cellKm, queries,
      email: !!cfgIn.email, proxyList, exclude, maxLeads: +cfgIn.maxLeads || +this.settings.get("maxLeads") || 0,
      running: true, paused: false, found: 0, area, consecBlocks: 0, retried: false, initialCells: cells.length,
      alreadyDoneCount, skippedCells: alreadyDoneCount, sessionSeen: 0, startTime: Date.now(), lastLeadTime: Date.now(),
    };
    this.store.setActiveScan({ running: true, area, mode: this.scan.mode, cellKm, email: this.scan.email });

    const modeMsg = proxyList.length ? `${proxyList.length} proxies backend activos` : "Modo directo seguro (antibaneo activo)";
    const resumeMsg = alreadyDoneCount ? ` (continuando donde se quedó: ${alreadyDoneCount} celdas en verde ya completadas, quedan ${pendingCount} pendientes)` : "";
    this.log(`Inicio ${this.scan.mode} · ${cells.length} celdas · celda ${cellKm}km · ${modeMsg}${resumeMsg}${this.scan.demo ? " (demo)" : ""}`);
    if (adjusted) { const m = `Área grande: ajusté la celda de ${askedKm} a ${cellKm} km para cubrirla en ${cells.length} celdas.`; this.log(m); this._notice(m); }
    if (alreadyDoneCount) this._notice(`Continuando donde te quedaste: ${alreadyDoneCount} celdas previas ya están en verde.`);

    this.bus.broadcast("cells", { cells: cells.map((c) => ({ key: c.key, bbox: c.bbox, state: c.state })), area, total: cells.length, doneCount: alreadyDoneCount });
    this._status();
    this._processNext();
    return { ok: true, cells: cells.length, mode: this.scan.mode, cellKm, adjusted, askedKm, skipped: alreadyDoneCount, pending: pendingCount, proxies: proxyList.length };
  }

  pause() { if (this.scan) { this.scan.paused = true; this._status(); } return { ok: true }; }

  resume() {
    if (this.scan) {
      this.scan.paused = false; this.scan.consecBlocks = 0; this._status();
      // Si hay una celda en curso, su fin encadena la siguiente; si no, retomamos ya (sin lanzar dos scrapers).
      if (!this.child && !this.demoT) { this.t.clearTimeout(this.nextT); this.nextT = null; this._processNext(); }
    }
    return { ok: true };
  }

  stop() {
    this._clearTimers();
    if (this.child) { this.runner.kill(this.child); this.child = null; }
    if (this.scan) {
      this.scan.running = false;
      this.store.setActiveScan(null);
      this.store.flush();
      this._status();
      this.bus.broadcast("done", { found: this.scan.found, cells: this.scan.cells.length });
    }
    return { ok: true };
  }

  /** Detiene lo que haya en curso y olvida el escaneo (usado por /api/reset). */
  discard() { this.stop(); this.scan = null; this.curCell = null; this.cellStart = 0; }

  _clearTimers() {
    for (const k of ["demoT", "nextT", "cellTimer"]) { if (this[k]) { this.t.clearTimeout(this[k]); this[k] = null; } }
    if (this.pollT) { this.t.clearInterval(this.pollT); this.pollT = null; }
  }

  // ---------------------------------------------------------------- bucle de celdas
  _processNext() {
    const s = this.scan;
    if (!s || !s.running || s.paused) return;
    while (s.idx < s.cells.length && s.cells[s.idx].state === "done") s.idx++;
    const cell = s.cells[s.idx];
    if (!cell) return this._finish();
    cell.state = "scanning";
    this.bus.broadcast("cell", { key: cell.key, state: "scanning", found: 0 });
    this._status();
    if (s.demo) return this._demoCell(cell);
    this._runCell(cell);
  }

  _pauseRange() {
    const s = this.scan, cfg = this.settings;
    const hasProxies = s.proxyList.length > 0;
    const num = (k) => (cfg.get(k) != null && !isNaN(+cfg.get(k))) ? +cfg.get(k) : null;
    let lo = num("pauseMin") != null ? Math.max(0.2, num("pauseMin")) : (hasProxies ? 0.8 : (cfg.get("safeMode") ? 1.5 : 0.8));
    let hi = num("pauseMax") != null ? Math.max(lo, num("pauseMax")) : (hasProxies ? 1.8 : (cfg.get("safeMode") ? 3.0 : 1.5));
    if (hi < lo) hi = lo;
    if (s.consecBlocks > 0) { lo = Math.max(lo, hasProxies ? 3 : 6 * s.consecBlocks); hi = Math.max(hi, hasProxies ? 7 : 12 * s.consecBlocks); }
    return [lo, hi];
  }

  _scheduleNext() {
    const s = this.scan;
    if (!s || !s.running || s.paused) return;
    const [lo, hi] = this._pauseRange();
    const ms = s.demo ? 250 : Math.round((lo + Math.random() * (hi - lo)) * 1000);
    this.nextT = this.t.setTimeout(() => { this.nextT = null; this._processNext(); }, ms);
  }

  _advance() {
    const s = this.scan;
    if (!s) return;
    s.idx++;
    while (s.idx < s.cells.length && s.cells[s.idx].state === "done") s.idx++;
    this.bus.broadcast("progress", { cellsDone: countFinished(s.cells), cellsTotal: s.cells.length, found: s.found });
    this._scheduleNext();
  }

  _retryCell(cell, waitMs, msg) {
    cell._tries = (cell._tries || 0) + 1; cell._blocked = false; cell.found = 0;
    this.log(msg(cell._tries, Math.round(waitMs / 1000)));
    this.bus.broadcast("cell", { key: cell.key, state: "scanning" });
    this.nextT = this.t.setTimeout(() => { this.nextT = null; if (this.running && !this.scan.paused) this._runCell(cell); }, waitMs);
  }

  _finishCell(cell) {
    const s = this.scan;
    if (!s) return;
    this.cellStart = 0; // evita que el watchdog vuelva a cerrar una celda ya cerrada
    const hasProxies = s.proxyList.length > 0;
    if (cell._blocked && !s.paused && !s.demo) {
      if (hasProxies && (cell._tries || 0) < 3) {
        s.proxyList = shuffle([...s.proxyList]);
        return this._retryCell(cell, 2000 + Math.floor(Math.random() * 2500), (n, sec) => `⚠️ Incidencia en celda ${cell.key}: reintentando (${n}/3) tras ${sec}s con proxies rotados`);
      }
      if (!hasProxies && (cell._tries || 0) < 2) {
        return this._retryCell(cell, 4000 + Math.floor(Math.random() * 3000), (n, sec) => `⚠️ Celda ${cell.key} con aviso en modo directo: esperando ${sec}s antes de reintentar...`);
      }
    }
    cell.state = cell.found > 0 ? "done" : (cell._blocked ? "error" : "empty");
    this.bus.broadcast("cell", { key: cell.key, state: cell.state, found: cell.found });
    // Persistencia inmediata: la celda terminada queda registrada aunque se apague el equipo.
    if (cell.state === "done" || cell.state === "empty") this.store.addScanned(cell.key);

    s.consecBlocks = cell._blocked ? (s.consecBlocks || 0) + 1 : Math.max(0, (s.consecBlocks || 0) - 1);

    // Antibaneo resiliente: nunca se para, se enfría y sigue.
    if (s.consecBlocks >= (this.settings.get("maxBlocks") || 4)) {
      const cooldownSec = hasProxies ? 15 : 25;
      this.log(`🛡️ Antibaneo activo: ${s.consecBlocks} avisos acumulados. Enfriando ${cooldownSec}s antes de continuar automáticamente...`);
      this._notice(`Antibaneo: enfriando ${cooldownSec}s. El escáner continuará solo sin detenerse.`);
      s.consecBlocks = 0;
      if (hasProxies) s.proxyList = shuffle([...s.proxyList]);
      this.nextT = this.t.setTimeout(() => { this.nextT = null; this._advance(); }, cooldownSec * 1000);
      return;
    }

    const subdivideAt = this.settings.get("subdivideAt") || 90;
    if (!s.demo && this.settings.get("subdivide") !== false && cell.found >= subdivideAt && (cell.km || s.cellKm) > 0.35 && (cell.depth || 0) < 2) {
      const subs = splitCell(cell);
      s.cells.splice(s.idx + 1, 0, ...subs);
      this.bus.broadcast("cellsadd", { cells: subs.map((c) => ({ key: c.key, bbox: c.bbox, state: "pending" })) });
      this.log("Celda densa subdividida en 4 (" + cell.found + " negocios)");
    }
    this._advance();
  }

  _jobFor(cell) {
    const s = this.scan, cfg = this.settings;
    const hasProxies = s.proxyList.length > 0;
    return {
      queries: s.queries, bbox: cell.bbox, cellKm: cell.km || s.cellKm,
      proxies: hasProxies ? shuffle([...s.proxyList]) : [],
      concurrency: Math.max(4, Math.min(8, +cfg.get("conc") || 5)),
      depth: cfg.get("depth") > 0 ? cfg.get("depth") : 3,
      inactivitySec: Math.max(25, Math.min(60, +cfg.get("inactivity") || 35)),
      leadsdbKey: cfg.get("leadsdbKey") || "",
    };
  }

  _runCell(cell) {
    const s = this.scan;
    if (!s || !s.running) return;
    if (s.proxyList.length) { s.proxyList = shuffle([...s.proxyList]); this.log("Celda " + cell.key + " → rotando entre " + s.proxyList.length + " proxies (antibaneo activo)"); }
    else this.log("Celda " + cell.key + " → modo directo seguro (sin proxies, pausas antibaneo)");

    this.curCell = cell; this.curEmitted = 0; this.cellStart = Date.now();
    const started = this.runner.start(this._jobFor(cell));
    if (started.error) {
      this.log("ERROR: " + started.error);
      this.bus.broadcast("error", { message: started.error });
      s.running = false; this.store.setActiveScan(null); this._status();
      return;
    }
    const child = this.child = started.child;
    child.stderr.on("data", (d) => this._onStderr(cell, child, d));
    this.pollT = this.t.setInterval(() => this._ingestCell(), POLL_MS);
    const maxMin = Math.max(1.0, Math.min(2.5, +this.settings.get("cellMax") || 1.5));
    this.t.clearTimeout(this.cellTimer);
    this.cellTimer = this.t.setTimeout(() => {
      if (this.child !== child) return;
      this.log("Celda " + cell.key + " completó su ventana de " + maxMin + " min; liberando celda y avanzando...");
      cell._timedout = true;
      this.child = null; this.t.clearInterval(this.pollT); this.pollT = null;
      this.runner.kill(child);
      this._finishCell(cell);
    }, maxMin * 60000);
    child.on("exit", () => {
      if (cell._timedout || this.child !== child) return;
      this.t.clearTimeout(this.cellTimer); this.t.clearInterval(this.pollT); this.pollT = null;
      this._ingestCell();
      this.child = null;
      this._finishCell(cell);
    });
    child.on("error", () => {
      if (cell._timedout || this.child !== child) return;
      this.t.clearTimeout(this.cellTimer); this.t.clearInterval(this.pollT); this.pollT = null;
      this.child = null;
      cell.state = "error";
      this.bus.broadcast("cell", { key: cell.key, state: "error" });
      this._advance();
    });
  }

  _onStderr(cell, child, d) {
    const s = d.toString().trim();
    if (!s) return;
    this.log(s.slice(0, 200));
    if (QUOTA_RE.test(s) && this.scan && this.scan.proxyList.length) {
      this.log("⚠️ Límite de saldo alcanzado en proxies (402 Payment Required). Cambiando inmediatamente a MODO DIRECTO SEGURO...");
      this._notice("Saldo de proxies agotado. Continuando en Modo Directo Seguro automáticamente para no parar.");
      this.scan.proxyList = []; cell._blocked = false;
      this.runner.kill(child);
      return;
    }
    if (BLOCK_RE.test(s)) cell._blocked = true;
    const now = Date.now();
    if (NOISY_RE.test(s) && now - this.lastLogBroadcast > 4000) { this.lastLogBroadcast = now; this.bus.broadcast("log", { line: s.slice(0, 150) }); }
  }

  /** Lee el CSV parcial de la celda y añade las filas nuevas (las completas). */
  _ingestCell() {
    const text = this.runner.readCellCsv();
    if (!text) return;
    let rows = parseCSV(text);
    if (!/\n$/.test(text) && rows.length) rows = rows.slice(0, -1);
    if (rows.length < 2) return;
    const H = rows[0].map((h) => h.trim().toLowerCase());
    for (let i = 1 + this.curEmitted; i < rows.length; i++) { const l = rowToLead(H, rows[i]); if (l) this.ingestLead(l); }
    this.curEmitted = rows.length - 1;
  }

  /** Añade un lead al almacén (solo si es nuevo) y avisa al panel. */
  ingestLead(l) {
    const s = this.scan;
    if (s && s.exclude.length) { const t = (l.title || "").toLowerCase(); if (s.exclude.some((x) => t.includes(x))) return false; }
    const id = leadId(l);
    if (s) { s.lastLeadTime = Date.now(); s.sessionSeen = (s.sessionSeen || 0) + 1; }
    if (this.curCell) this.curCell.seen = (this.curCell.seen || 0) + 1;
    if (!this.store.insertLead(id, l)) return false; // ya existía: no se toca
    if (this.curCell) this.curCell.found = (this.curCell.found || 0) + 1;
    if (s) s.found++;
    this.bus.broadcast("lead", Object.assign({}, l, { lastLeadAt: Date.now() }));
    this.notifier.notifyLead(l);
    if (s && s.maxLeads && s.found >= s.maxLeads && s.running && !s.paused) {
      s.paused = true;
      this.log("Auto-pausa: tope de " + s.maxLeads + " leads");
      this._notice("Alcanzaste el tope de " + s.maxLeads + " leads — escaneo en pausa.");
      this._status();
    }
    return true;
  }

  _finish() {
    const s = this.scan;
    if (!s) return;
    const errs = s.cells.filter((c) => c.state === "error");
    if (this.settings.get("retryFailed") !== false && !s.retried && errs.length && !s.paused) {
      s.retried = true; s.idx = s.cells.length;
      errs.forEach((c) => s.cells.push(Object.assign({}, c, { state: "pending", _blocked: false })));
      this.log("Reintentando " + errs.length + " celdas con error");
      this._status();
      return this._scheduleNext();
    }
    s.running = false;
    this.store.setActiveScan(null);
    this.store.addScannedMany(s.cells.filter((c) => c.state === "done" || c.state === "empty").map((c) => c.key));
    this.store.addHistory({ ts: Date.now(), found: s.found, cells: s.cells.length, mode: s.mode, area: s.area });
    this.store.flush();
    this._status();
    this.bus.broadcast("done", { found: s.found, cells: s.cells.length });
    this.log(`Fin · ${s.found} negocios`);
    this.notifier.scanFinished(s.found, s.cells.length);
  }

  _watchdog() {
    const s = this.scan;
    if (!s || !s.running || s.paused) return;
    if (!this.cellStart || Date.now() - this.cellStart <= WATCHDOG_MS) return;
    const cell = this.curCell, child = this.child;
    this.log(`⏰ Watchdog: Celda ${cell ? cell.key : ""} excedió 100s; forzando liberación y avance inmediato.`);
    this.child = null; this.t.clearInterval(this.pollT); this.pollT = null; this.t.clearTimeout(this.cellTimer);
    if (child) this.runner.kill(child);
    if (cell) { cell._timedout = true; this._finishCell(cell); } else { this.cellStart = 0; this._advance(); }
  }

  _demoCell(cell) {
    this.demoT = this.t.setTimeout(() => {
      this.demoT = null;
      if (!this.running) return;
      this.curCell = cell;
      for (const l of this.demo.leadsFor(cell)) this.ingestLead(l);
      this._finishCell(cell);
    }, 500);
  }

  /** Si al arrancar había un escaneo activo (apagón, reinicio), lo retoma donde iba. */
  autoResume() {
    const prev = this.store.getActiveScan();
    if (!prev || !prev.running || !Array.isArray(prev.area)) return false;
    this.t.setTimeout(() => {
      this.log("🔄 Auto-reanudando escaneo previo donde se quedó...");
      this.start(Object.assign({}, prev, { skipScanned: true })).catch((e) => this.log("Error al auto-reanudar escaneo: " + (e && e.message)));
    }, 2000);
    return true;
  }

  close() { this.t.clearInterval(this.watchdog); this.stop(); }
}

module.exports = { Scanner, BLOCK_RE, MAX_CELLS };

"use strict";
/**
 * Orquestador del escaneo por cuadrícula: una celda = un trabajo del scraper.
 *
 * Trabajadores en paralelo (ajuste `workers`, 1–4): cada "slot" lleva su propio proceso hijo y su
 * propio CSV, de modo que la pausa antibaneo y el timeout de una celda vacía no frenan a las demás.
 * Con `workers = 1` el comportamiento es exactamente el secuencial de siempre.
 *
 * Máquina de estados: idle → running (scanning cell → done/empty/error → pausa aleatoria → siguiente) → finished.
 * Incluye antibaneo (detección de bloqueos, backoff, rotación de proxies, enfriamiento global),
 * subdivisión de celdas densas, reintento de celdas con error, watchdog y "continuar donde se quedó".
 *
 * Emite por el bus: status, cells, cell, cellsadd, progress, lead, notice, log, error, done.
 */
const { StringDecoder } = require("string_decoder");
const { parseCSV, splitCompleteRows } = require("../domain/csv");
const { rowToLead, leadId } = require("../domain/lead");
const { fitCells, sortFromCenter, markScanned, splitCell, countFinished } = require("../domain/grid");
const { parseProxyList, shuffle } = require("../domain/proxy");
const { CORE_ALL_CATEGORIES } = require("../config/categories");

const BLOCK_RE = /ERR_TUNNEL|\b429\b|\b403\b|captcha|unusual traffic|too many requests|rate.?limit|sorry\/index|connection reset/i;
const QUOTA_RE = /402 Payment Required|bandwidthlimit|net::ERR_PROXY_AUTH_UNSUPPORTED/i;
const NOISY_RE = /panic|cannot|refused|no such|not found|forbidden|blocked|denied|ERR_/i;
const MAX_CELLS = 550;
const MAX_WORKERS = 4;
const WATCHDOG_MS = 100000; // ninguna celda queda colgada más de 100 s
const POLL_MS = 300;
const STAGGER_MS = 1500; // separación entre lanzamientos simultáneos (no martillar a la vez)

class Scanner {
  constructor({ store, bus, settings, runner, proxies, notifier, log, demo, timers }) {
    this.store = store; this.bus = bus; this.settings = settings; this.runner = runner;
    this.proxies = proxies; this.notifier = notifier; this.log = log || (() => {});
    this.demo = demo; this.t = timers || { setTimeout, clearTimeout, setInterval, clearInterval };
    this.scan = null;
    /** @type {Map<number, object>} slot → trabajo en curso (celda, proceso, buffers, timers) */
    this.jobs = new Map();
    this.timers = new Set(); // timeouts de una sola vez (pausas, reintentos, enfriamiento)
    this.lastLogBroadcast = 0;
    this.watchdog = this.t.setInterval(() => this._watchdog(), 8000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  get running() { return !!(this.scan && this.scan.running); }
  get activeJobs() { return [...this.jobs.values()]; }

  /** Vista de estado que consume el panel (misma forma en reposo y en marcha). */
  status() {
    const s = this.scan;
    if (!s) return { running: false, backendProxies: this.proxies.backendProxies().length, totalDbLeads: this.store.countLeads(), dbScannedCount: this.store.countScanned() };
    const done = countFinished(s.cells);
    const oldest = this.activeJobs.filter((j) => j.start).sort((a, b) => a.start - b.start)[0];
    return {
      running: s.running, paused: s.paused, mode: s.mode,
      cellsTotal: s.cells.length, cellsDone: done, overallTotal: s.cells.length, overallDone: done,
      skipped: s.alreadyDoneCount || 0, found: s.found, sessionSeen: s.sessionSeen || 0,
      totalDbLeads: this.store.countLeads(),
      cellIdx: Math.min(s.idx + 1, s.cells.length),
      cellFound: oldest ? (oldest.cell.found || 0) : 0,
      cellSecs: (s.running && !s.paused && oldest) ? Math.round((Date.now() - oldest.start) / 1000) : 0,
      scanSecs: s.startTime ? Math.round((Date.now() - s.startTime) / 1000) : 0,
      lastLeadSecs: s.lastLeadTime ? Math.round((Date.now() - s.lastLeadTime) / 1000) : null,
      queries: (s.queries || []).length,
      backendProxies: s.proxyList ? s.proxyList.length : this.proxies.backendProxies().length,
      workers: this._workers(), activeCells: this.jobs.size,
    };
  }

  cellsView() { return this.scan ? this.scan.cells.map((c) => ({ key: c.key, bbox: c.bbox, state: c.state, found: c.found })) : []; }

  _status() { this.bus.broadcast("status", this.status()); }
  _notice(msg) { this.bus.broadcast("notice", { msg }); }
  _workers() { return Math.max(1, Math.min(MAX_WORKERS, Math.round(+this.settings.get("workers") || 1))); }
  _after(ms, fn) {
    const t = this.t.setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  _cancel(t) { if (t) { this.t.clearTimeout(t); this.timers.delete(t); } }

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
      mode: cfgIn.mode === "rubros" ? "rubros" : "all", demo: !!cfgIn.demo, cells, idx: 0, cellKm, queries,
      email: !!cfgIn.email, proxyList, exclude, maxLeads: +cfgIn.maxLeads || +this.settings.get("maxLeads") || 0,
      running: true, paused: false, found: 0, area, consecBlocks: 0, cooldownUntil: 0, retried: false, initialCells: cells.length,
      alreadyDoneCount, skippedCells: alreadyDoneCount, sessionSeen: 0, startTime: Date.now(), lastLeadTime: Date.now(),
    };
    this.store.setActiveScan({ running: true, area, mode: this.scan.mode, cellKm, email: this.scan.email });

    const workers = this._workers();
    const modeMsg = proxyList.length ? `${proxyList.length} proxies backend activos` : "Modo directo seguro (antibaneo activo)";
    const resumeMsg = alreadyDoneCount ? ` (continuando donde se quedó: ${alreadyDoneCount} celdas en verde ya completadas, quedan ${pendingCount} pendientes)` : "";
    this.log(`Inicio ${this.scan.mode} · ${cells.length} celdas · celda ${cellKm}km · ${modeMsg}${workers > 1 ? ` · ${workers} celdas a la vez` : ""}${resumeMsg}${this.scan.demo ? " (demo)" : ""}`);
    if (adjusted) { const m = `Área grande: ajusté la celda de ${askedKm} a ${cellKm} km para cubrirla en ${cells.length} celdas.`; this.log(m); this._notice(m); }
    if (alreadyDoneCount) this._notice(`Continuando donde te quedaste: ${alreadyDoneCount} celdas previas ya están en verde.`);

    this.bus.broadcast("cells", { cells: cells.map((c) => ({ key: c.key, bbox: c.bbox, state: c.state })), area, total: cells.length, doneCount: alreadyDoneCount });
    this._status();
    this._fill();
    return { ok: true, cells: cells.length, mode: this.scan.mode, cellKm, adjusted, askedKm, skipped: alreadyDoneCount, pending: pendingCount, proxies: proxyList.length, workers };
  }

  pause() { if (this.scan) { this.scan.paused = true; this._status(); } return { ok: true }; }

  resume() {
    if (this.scan) {
      this.scan.paused = false; this.scan.consecBlocks = 0; this._status();
      // Celdas cuyo reintento venció durante la pausa: se relanzan ahora.
      for (const job of this.activeJobs) if (job.waiting) { job.waiting = false; this._runCell(job); }
      // Las celdas en curso encadenan solas; aquí solo se ocupan los slots libres (sin duplicar scrapers).
      this._fill();
    }
    return { ok: true };
  }

  stop() {
    this._clearAll();
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
  discard() { this.stop(); this.scan = null; }

  _clearJobTimers(job) {
    if (job.pollT) { this.t.clearInterval(job.pollT); job.pollT = null; }
    for (const k of ["cellTimer", "retryT", "demoT"]) { if (job[k]) { this._cancel(job[k]); job[k] = null; } }
  }
  _clearAll() {
    for (const job of this.activeJobs) { this._clearJobTimers(job); if (job.child) { const c = job.child; job.child = null; this.runner.kill(c); } }
    this.jobs.clear();
    for (const t of this.timers) this.t.clearTimeout(t);
    this.timers.clear();
  }

  // ---------------------------------------------------------------- reparto de celdas entre trabajadores
  _nextPendingIndex() { return this.scan.cells.findIndex((c) => c.state === "pending"); }
  _freeSlot() { let i = 0; while (this.jobs.has(i)) i++; return i; }

  /** Ocupa todos los slots libres con celdas pendientes; si no queda nada, cierra el escaneo. */
  _fill() {
    const s = this.scan;
    if (!s || !s.running || s.paused) return;
    const now = Date.now();
    if (s.cooldownUntil > now) { this._after(s.cooldownUntil - now, () => this._fill()); return; }
    const workers = this._workers();
    let launched = 0;
    while (this.jobs.size < workers) {
      const i = this._nextPendingIndex();
      if (i < 0) break;
      s.idx = i;
      const cell = s.cells[i];
      cell.state = "scanning"; // reservada: ningún otro slot la tomará mientras espera su turno
      this.bus.broadcast("cell", { key: cell.key, state: "scanning", found: 0 });
      const job = { slot: this._freeSlot(), cell, child: null, start: 0, offset: 0, buf: "", header: null, decoder: null, pollT: null, cellTimer: null, retryT: null, demoT: null, waiting: false };
      this.jobs.set(job.slot, job);
      if (launched === 0 || s.demo) this._launch(job);
      else this._after(launched * STAGGER_MS, () => { if (this.jobs.get(job.slot) === job && this.running) this._launch(job); });
      launched++;
    }
    if (!this.jobs.size && this._nextPendingIndex() < 0) this._finish();
  }

  _launch(job) {
    const s = this.scan, cell = job.cell;
    if (!s || !s.running) return;
    cell.state = "scanning";
    this._status();
    if (s.demo) return this._demoCell(job);
    this._runCell(job);
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

  /** Libera el slot de un trabajo terminado, avisa el progreso y, tras la pausa antibaneo, pide otra celda. */
  _release(job, waitMs) {
    const s = this.scan;
    this.jobs.delete(job.slot);
    if (!s) return;
    this.bus.broadcast("progress", { cellsDone: countFinished(s.cells), cellsTotal: s.cells.length, found: s.found });
    if (!s.running || s.paused) return;
    if (waitMs == null) { const [lo, hi] = this._pauseRange(); waitMs = s.demo ? 250 : Math.round((lo + Math.random() * (hi - lo)) * 1000); }
    this._after(waitMs, () => this._fill());
  }

  _retryCell(job, waitMs, msg) {
    const cell = job.cell;
    cell._tries = (cell._tries || 0) + 1; cell._blocked = false; cell.found = 0;
    this.log(msg(cell._tries, Math.round(waitMs / 1000)));
    this.bus.broadcast("cell", { key: cell.key, state: "scanning" });
    job.retryT = this._after(waitMs, () => {
      job.retryT = null;
      if (!this.running) return;
      if (this.scan.paused) { job.waiting = true; return; }
      this._runCell(job);
    });
  }

  _finishCell(job) {
    const s = this.scan, cell = job.cell;
    this._clearJobTimers(job);
    job.child = null; job.start = 0;
    if (!s) { this.jobs.delete(job.slot); return; }
    const hasProxies = s.proxyList.length > 0;
    if (cell._blocked && !s.paused && !s.demo) {
      if (hasProxies && (cell._tries || 0) < 3) {
        s.proxyList = shuffle([...s.proxyList]);
        return this._retryCell(job, 2000 + Math.floor(Math.random() * 2500), (n, sec) => `⚠️ Incidencia en celda ${cell.key}: reintentando (${n}/3) tras ${sec}s con proxies rotados`);
      }
      if (!hasProxies && (cell._tries || 0) < 2) {
        return this._retryCell(job, 4000 + Math.floor(Math.random() * 3000), (n, sec) => `⚠️ Celda ${cell.key} con aviso en modo directo: esperando ${sec}s antes de reintentar...`);
      }
    }
    cell.state = cell.found > 0 ? "done" : (cell._blocked ? "error" : "empty");
    this.bus.broadcast("cell", { key: cell.key, state: cell.state, found: cell.found });
    // Persistencia inmediata: la celda terminada queda registrada aunque se apague el equipo.
    if (cell.state === "done" || cell.state === "empty") this.store.addScanned(cell.key);

    s.consecBlocks = cell._blocked ? (s.consecBlocks || 0) + 1 : Math.max(0, (s.consecBlocks || 0) - 1);

    // Antibaneo resiliente: nunca se para, se enfría (todos los trabajadores) y sigue.
    if (s.consecBlocks >= (this.settings.get("maxBlocks") || 4)) {
      const cooldownSec = hasProxies ? 15 : 25;
      this.log(`🛡️ Antibaneo activo: ${s.consecBlocks} avisos acumulados. Enfriando ${cooldownSec}s antes de continuar automáticamente...`);
      this._notice(`Antibaneo: enfriando ${cooldownSec}s. El escáner continuará solo sin detenerse.`);
      s.consecBlocks = 0;
      s.cooldownUntil = Date.now() + cooldownSec * 1000;
      if (hasProxies) s.proxyList = shuffle([...s.proxyList]);
      return this._release(job, cooldownSec * 1000);
    }

    const subdivideAt = this.settings.get("subdivideAt") || 90;
    if (!s.demo && this.settings.get("subdivide") !== false && cell.found >= subdivideAt && (cell.km || s.cellKm) > 0.35 && (cell.depth || 0) < 2) {
      const subs = splitCell(cell);
      const at = s.cells.indexOf(cell);
      s.cells.splice(at + 1, 0, ...subs);
      this.bus.broadcast("cellsadd", { cells: subs.map((c) => ({ key: c.key, bbox: c.bbox, state: "pending" })) });
      this.log("Celda densa subdividida en 4 (" + cell.found + " negocios)");
    }
    this._release(job);
  }

  _jobFor(cell, slot) {
    const s = this.scan, cfg = this.settings;
    const hasProxies = s.proxyList.length > 0;
    return {
      slot, queries: s.queries, bbox: cell.bbox, cellKm: cell.km || s.cellKm,
      proxies: hasProxies ? shuffle([...s.proxyList]) : [],
      concurrency: Math.max(4, Math.min(8, +cfg.get("conc") || 5)),
      depth: cfg.get("depth") > 0 ? cfg.get("depth") : 3,
      inactivitySec: Math.max(25, Math.min(60, +cfg.get("inactivity") || 35)),
      leadsdbKey: cfg.get("leadsdbKey") || "",
    };
  }

  /** Error fatal (p. ej. falta el binario): detiene todo sin dejar un escaneo "fantasma" que se auto-reanude. */
  _abort(message) {
    this.log("ERROR: " + message);
    this.bus.broadcast("error", { message });
    this._clearAll();
    if (this.scan) { this.scan.running = false; this.store.setActiveScan(null); }
    this._status();
  }

  _runCell(job) {
    const s = this.scan, cell = job.cell;
    if (!s || !s.running) return;
    if (s.proxyList.length) { s.proxyList = shuffle([...s.proxyList]); this.log("Celda " + cell.key + " → rotando entre " + s.proxyList.length + " proxies (antibaneo activo)"); }
    else this.log("Celda " + cell.key + " → modo directo seguro (sin proxies, pausas antibaneo)");

    job.start = Date.now(); job.offset = 0; job.buf = ""; job.header = null; job.decoder = new StringDecoder("utf8");
    const started = this.runner.start(this._jobFor(cell, job.slot));
    if (started.error) return this._abort(started.error);
    const child = job.child = started.child;
    child.stderr.on("data", (d) => this._onStderr(job, child, d));
    job.pollT = this.t.setInterval(() => this._ingestCell(job), POLL_MS);
    const maxMin = Math.max(1.0, Math.min(2.5, +this.settings.get("cellMax") || 1.5));
    job.cellTimer = this._after(maxMin * 60000, () => {
      job.cellTimer = null;
      if (job.child !== child) return;
      this.log("Celda " + cell.key + " completó su ventana de " + maxMin + " min; liberando celda y avanzando...");
      job.child = null;
      this.runner.kill(child);
      this._finishCell(job);
    });
    child.on("exit", () => {
      if (job.child !== child) return;
      this._ingestCell(job);
      job.child = null;
      this._finishCell(job);
    });
    child.on("error", () => {
      if (job.child !== child) return;
      this._clearJobTimers(job);
      job.child = null;
      cell.state = "error";
      this.bus.broadcast("cell", { key: cell.key, state: "error" });
      this._release(job);
    });
  }

  _onStderr(job, child, d) {
    const s = d.toString().trim();
    if (!s) return;
    this.log(s.slice(0, 200));
    if (QUOTA_RE.test(s) && this.scan && this.scan.proxyList.length) {
      this.log("⚠️ Límite de saldo alcanzado en proxies (402 Payment Required). Cambiando inmediatamente a MODO DIRECTO SEGURO...");
      this._notice("Saldo de proxies agotado. Continuando en Modo Directo Seguro automáticamente para no parar.");
      this.scan.proxyList = []; job.cell._blocked = false;
      this.runner.kill(child);
      return;
    }
    if (BLOCK_RE.test(s)) job.cell._blocked = true;
    const now = Date.now();
    if (NOISY_RE.test(s) && now - this.lastLogBroadcast > 4000) { this.lastLogBroadcast = now; this.bus.broadcast("log", { line: s.slice(0, 150) }); }
  }

  /** Lee solo lo nuevo del CSV del trabajo, parsea las filas completas y las guarda en un lote. */
  _ingestCell(job) {
    const chunk = this.runner.readCellChunk(job.slot, job.offset);
    if (!chunk.buf) return;
    if (chunk.next < job.offset) { job.buf = ""; job.header = null; } // archivo reiniciado
    job.offset = chunk.next;
    job.buf += job.decoder ? job.decoder.write(chunk.buf) : chunk.buf.toString("utf8");
    const [complete, rest] = splitCompleteRows(job.buf);
    job.buf = rest;
    if (!complete) return;
    const rows = parseCSV(complete);
    if (!job.header) { if (!rows.length) return; job.header = rows.shift().map((h) => h.trim().toLowerCase()); }
    if (!rows.length) return;
    const header = job.header;
    this.store.batch(() => { for (const r of rows) { const l = rowToLead(header, r); if (l) this.ingestLead(l, job); } });
  }

  /** Añade un lead al almacén (solo si es nuevo) y avisa al panel. */
  ingestLead(l, job) {
    const s = this.scan, cell = job ? job.cell : null;
    if (s && s.exclude.length) { const t = (l.title || "").toLowerCase(); if (s.exclude.some((x) => t.includes(x))) return false; }
    const id = leadId(l);
    if (s) { s.lastLeadTime = Date.now(); s.sessionSeen = (s.sessionSeen || 0) + 1; }
    if (cell) cell.seen = (cell.seen || 0) + 1;
    if (!this.store.insertLead(id, l)) return false; // ya existía: no se toca
    if (cell) cell.found = (cell.found || 0) + 1;
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
    if (!s || this.jobs.size) return;
    const errs = s.cells.filter((c) => c.state === "error");
    if (this.settings.get("retryFailed") !== false && !s.retried && errs.length && !s.paused) {
      s.retried = true;
      errs.forEach((c) => s.cells.push({ key: c.key, bbox: c.bbox, km: c.km, depth: c.depth, state: "pending", found: 0, _blocked: false, _tries: 0 }));
      this.log("Reintentando " + errs.length + " celdas con error");
      this._status();
      return this._fill();
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
    const now = Date.now();
    for (const job of this.activeJobs) {
      if (!job.child || !job.start || now - job.start <= WATCHDOG_MS) continue;
      this.log(`⏰ Watchdog: Celda ${job.cell.key} excedió 100s; forzando liberación y avance inmediato.`);
      const child = job.child; job.child = null;
      this.runner.kill(child);
      this._finishCell(job);
    }
  }

  _demoCell(job) {
    job.start = Date.now();
    job.demoT = this._after(500, () => {
      job.demoT = null;
      if (!this.running) return;
      for (const l of this.demo.leadsFor(job.cell)) this.ingestLead(l, job);
      this._finishCell(job);
    });
  }

  /** Si al arrancar había un escaneo activo (apagón, reinicio), lo retoma donde iba. */
  autoResume() {
    const prev = this.store.getActiveScan();
    if (!prev || !prev.running || !Array.isArray(prev.area)) return false;
    this._after(2000, () => {
      this.log("🔄 Auto-reanudando escaneo previo donde se quedó...");
      this.start(Object.assign({}, prev, { skipScanned: true })).catch((e) => this.log("Error al auto-reanudar escaneo: " + (e && e.message)));
    });
    return true;
  }

  close() { this.t.clearInterval(this.watchdog); this.stop(); }
}

module.exports = { Scanner, BLOCK_RE, MAX_CELLS, MAX_WORKERS };

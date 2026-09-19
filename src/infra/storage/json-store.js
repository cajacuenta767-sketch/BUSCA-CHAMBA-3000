"use strict";
/**
 * Almacenamiento en un solo JSON (data/db.json): el formato original del proyecto.
 * Escritura atómica (tmp + rename), copia .bak cada 60 s y guardado diferido (200 ms).
 * Sirve para instalaciones pequeñas o cuando `node:sqlite` no está disponible.
 */
const fs = require("fs");

const EMPTY = () => ({ leads: {}, order: [], history: [], scanned: [], activeScan: null });

class JsonStore {
  constructor({ file, log } = {}) {
    this.file = file;
    this.log = log || (() => {});
    this.db = file ? this._load() : EMPTY();
    this._timer = null;
    this._lastBackup = 0;
  }

  get driver() { return "json"; }

  _load() {
    const tryRead = (f) => {
      const raw = fs.readFileSync(f, "utf8");
      if (!raw || !raw.trim()) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    };
    try { const d = tryRead(this.file); if (d) return Object.assign(EMPTY(), d); } catch (e) { /* se intenta el .bak */ }
    try {
      const bak = this.file + ".bak";
      if (fs.existsSync(bak)) {
        const d = tryRead(bak);
        if (d) {
          this.log(`🛡️ Recuperada base de datos desde ${bak} tras fallo en ${this.file}`);
          try { fs.copyFileSync(bak, this.file); } catch (_) { /* no crítico */ }
          return Object.assign(EMPTY(), d);
        }
      }
    } catch (e) { /* sin respaldo */ }
    return EMPTY();
  }

  _save(immediate = false) {
    if (!this.file) return;
    const write = () => {
      this._timer = null;
      try {
        fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.db));
        fs.renameSync(this.file + ".tmp", this.file);
        const now = Date.now();
        if (now - this._lastBackup > 60000) {
          this._lastBackup = now;
          try { fs.copyFileSync(this.file, this.file + ".bak"); } catch (_) { /* no crítico */ }
        }
      } catch (e) {
        try { fs.writeFileSync(this.file, JSON.stringify(this.db)); } catch (_) { /* disco lleno u otro */ }
      }
    };
    clearTimeout(this._timer);
    if (immediate) write(); else this._timer = setTimeout(write, 200);
  }

  // ---- Leads ----
  countLeads() { return this.db.order.length; }
  hasLead(id) { return !!this.db.leads[id]; }
  getLead(id) { return this.db.leads[id] || null; }
  listLeads({ offset = 0, limit = 0 } = {}) {
    const ids = limit > 0 ? this.db.order.slice(offset, offset + limit) : (offset ? this.db.order.slice(offset) : this.db.order);
    return ids.map((id) => this.db.leads[id]).filter(Boolean);
  }
  /** Inserta solo si no existe. Un lead ya guardado nunca se sobreescribe. */
  insertLead(id, lead) {
    if (this.db.leads[id]) return false;
    this.db.leads[id] = lead; this.db.order.push(id); this._save(); return true;
  }
  saveLead(id, lead) {
    if (!this.db.leads[id]) this.db.order.push(id);
    this.db.leads[id] = lead; this._save();
  }
  updateLeadMeta(id, patch) {
    const l = this.db.leads[id];
    if (!l) return null;
    l._meta = Object.assign({}, l._meta, patch); this._save(); return l._meta;
  }
  resetLeads() { this.db.leads = {}; this.db.order = []; this._save(true); }

  // ---- Celdas barridas ----
  scannedKeys() { return (this.db.scanned || []).slice(); }
  countScanned() { return (this.db.scanned || []).length; }
  isScanned(key) { return (this.db.scanned || []).includes(key); }
  addScanned(key) {
    if (!Array.isArray(this.db.scanned)) this.db.scanned = [];
    if (this.db.scanned.includes(key)) return false;
    this.db.scanned.push(key); this._save(true); return true;
  }
  addScannedMany(keys) {
    this.db.scanned = [...new Set((this.db.scanned || []).concat(keys))].slice(-5000);
    this._save(true);
  }

  // ---- Historial y escaneo activo ----
  history() { return (this.db.history || []).slice(); }
  addHistory(entry) { this.db.history.unshift(entry); this.db.history = this.db.history.slice(0, 50); this._save(true); }
  getActiveScan() { return this.db.activeScan || null; }
  setActiveScan(obj) { this.db.activeScan = obj || null; this._save(true); }

  /** Agrupa varias escrituras (en JSON basta con el guardado diferido). */
  batch(fn) { return fn(); }
  flush() { this._save(true); }
  close() { this.flush(); }
}

module.exports = { JsonStore };

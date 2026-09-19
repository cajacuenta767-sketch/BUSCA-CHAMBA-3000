"use strict";
/**
 * Almacenamiento en SQLite usando `node:sqlite` (Node ≥ 22.13, sin dependencias npm).
 * Modelo "documento + proyecciones": el lead completo va en `data` (JSON) y las columnas
 * consultables (categoría, ciudad, teléfono…) se extraen para indexar y filtrar en SQL.
 * Escrituras incrementales (una fila por lead) en vez de reescribir todo el archivo.
 */
const { DatabaseSync } = require("node:sqlite");

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS leads (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        id         TEXT    NOT NULL UNIQUE,
        title      TEXT    NOT NULL,
        category   TEXT,
        city       TEXT,
        country    TEXT,
        phone      TEXT,
        website    TEXT,
        rating     REAL    NOT NULL DEFAULT 0,
        reviews    INTEGER NOT NULL DEFAULT 0,
        lat        REAL,
        lon        REAL,
        data       TEXT    NOT NULL,
        meta       TEXT,
        enriched   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category);
      CREATE INDEX IF NOT EXISTS idx_leads_city     ON leads(city);
      CREATE INDEX IF NOT EXISTS idx_leads_country  ON leads(country);
      CREATE INDEX IF NOT EXISTS idx_leads_phone    ON leads(phone);
      CREATE INDEX IF NOT EXISTS idx_leads_enriched ON leads(enriched);
      CREATE TABLE IF NOT EXISTS scanned_cells (
        key        TEXT PRIMARY KEY,
        scanned_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scan_history (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        ts    INTEGER NOT NULL,
        found INTEGER NOT NULL DEFAULT 0,
        cells INTEGER NOT NULL DEFAULT 0,
        mode  TEXT,
        area  TEXT
      );
      CREATE TABLE IF NOT EXISTS kv (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
];

function rowToLead(row) {
  const lead = JSON.parse(row.data);
  if (row.meta) lead._meta = JSON.parse(row.meta);
  if (row.enriched) lead._enr = 1;
  return lead;
}

function splitLead(lead) {
  const { _meta, _enr, ...data } = lead;
  return { data, meta: _meta || null, enriched: _enr ? 1 : 0 };
}

class SqliteStore {
  constructor({ file = ":memory:", log } = {}) {
    this.log = log || (() => {});
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    this._migrate();
    this._prepare();
  }

  get driver() { return "sqlite"; }

  _migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    const applied = new Set(this.db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.db.exec("BEGIN");
      try {
        this.db.exec(m.sql);
        this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, Date.now());
        this.db.exec("COMMIT");
      } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    }
  }

  _prepare() {
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      count: p("SELECT COUNT(*) AS n FROM leads"),
      has: p("SELECT 1 FROM leads WHERE id = ?"),
      get: p("SELECT data, meta, enriched FROM leads WHERE id = ?"),
      listAll: p("SELECT data, meta, enriched FROM leads ORDER BY seq"),
      listPage: p("SELECT data, meta, enriched FROM leads ORDER BY seq LIMIT ? OFFSET ?"),
      insert: p(`INSERT OR IGNORE INTO leads (id, title, category, city, country, phone, website, rating, reviews, lat, lon, data, meta, enriched, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      upsert: p(`INSERT INTO leads (id, title, category, city, country, phone, website, rating, reviews, lat, lon, data, meta, enriched, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET title=excluded.title, category=excluded.category, city=excluded.city, country=excluded.country,
                 phone=excluded.phone, website=excluded.website, rating=excluded.rating, reviews=excluded.reviews, lat=excluded.lat, lon=excluded.lon,
                 data=excluded.data, meta=excluded.meta, enriched=excluded.enriched, updated_at=excluded.updated_at`),
      getMeta: p("SELECT meta FROM leads WHERE id = ?"),
      setMeta: p("UPDATE leads SET meta = ?, updated_at = ? WHERE id = ?"),
      deleteLeads: p("DELETE FROM leads"),
      scannedAll: p("SELECT key FROM scanned_cells ORDER BY scanned_at, rowid"),
      scannedCount: p("SELECT COUNT(*) AS n FROM scanned_cells"),
      scannedHas: p("SELECT 1 FROM scanned_cells WHERE key = ?"),
      scannedAdd: p("INSERT OR IGNORE INTO scanned_cells (key, scanned_at) VALUES (?, ?)"),
      histAll: p("SELECT ts, found, cells, mode, area FROM scan_history ORDER BY ts DESC LIMIT 50"),
      histAdd: p("INSERT INTO scan_history (ts, found, cells, mode, area) VALUES (?, ?, ?, ?, ?)"),
      kvGet: p("SELECT value FROM kv WHERE key = ?"),
      kvSet: p("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
      kvDel: p("DELETE FROM kv WHERE key = ?"),
    };
  }

  _params(id, lead, now, createdAt) {
    const { data, meta, enriched } = splitLead(lead);
    return [id, lead.title || "", lead.category || "", lead.city || "", lead.country || "", lead.phone || "", lead.website || "",
      Number(lead.rating) || 0, Number(lead.reviews) || 0, Number(lead.lat) || null, Number(lead.lon) || null,
      JSON.stringify(data), meta ? JSON.stringify(meta) : null, enriched, createdAt, now];
  }

  transaction(fn) {
    this.db.exec("BEGIN");
    try { const r = fn(); this.db.exec("COMMIT"); return r; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  // ---- Leads ----
  countLeads() { return this.q.count.get().n; }
  hasLead(id) { return !!this.q.has.get(id); }
  getLead(id) { const r = this.q.get.get(id); return r ? rowToLead(r) : null; }
  listLeads({ offset = 0, limit = 0 } = {}) {
    const rows = limit > 0 ? this.q.listPage.all(limit, offset) : (offset ? this.q.listPage.all(-1, offset) : this.q.listAll.all());
    return rows.map(rowToLead);
  }
  insertLead(id, lead) {
    const now = Date.now();
    return this.q.insert.run(...this._params(id, lead, now, now)).changes > 0;
  }
  saveLead(id, lead) {
    const now = Date.now();
    this.q.upsert.run(...this._params(id, lead, now, now));
  }
  updateLeadMeta(id, patch) {
    const r = this.q.getMeta.get(id);
    if (!r) return null;
    const meta = Object.assign({}, r.meta ? JSON.parse(r.meta) : {}, patch);
    this.q.setMeta.run(JSON.stringify(meta), Date.now(), id);
    return meta;
  }
  resetLeads() { this.q.deleteLeads.run(); }

  // ---- Celdas barridas ----
  scannedKeys() { return this.q.scannedAll.all().map((r) => r.key); }
  countScanned() { return this.q.scannedCount.get().n; }
  isScanned(key) { return !!this.q.scannedHas.get(key); }
  addScanned(key) { return this.q.scannedAdd.run(key, Date.now()).changes > 0; }
  addScannedMany(keys) { const now = Date.now(); this.transaction(() => { for (const k of keys) this.q.scannedAdd.run(k, now); }); }

  // ---- Historial y escaneo activo ----
  history() { return this.q.histAll.all().map((r) => ({ ts: r.ts, found: r.found, cells: r.cells, mode: r.mode, area: r.area ? JSON.parse(r.area) : null })); }
  addHistory(e) { this.q.histAdd.run(e.ts || Date.now(), e.found || 0, e.cells || 0, e.mode || null, e.area ? JSON.stringify(e.area) : null); }
  getActiveScan() { const r = this.q.kvGet.get("activeScan"); return r && r.value ? JSON.parse(r.value) : null; }
  setActiveScan(obj) { if (obj) this.q.kvSet.run("activeScan", JSON.stringify(obj)); else this.q.kvDel.run("activeScan"); }
  kvGet(key) { const r = this.q.kvGet.get(key); return r ? r.value : null; }
  kvSet(key, value) { this.q.kvSet.run(key, String(value)); }

  flush() { /* SQLite escribe en cada operación */ }
  close() { try { this.db.close(); } catch (e) { /* ya cerrada */ } }
}

module.exports = { SqliteStore, MIGRATIONS };

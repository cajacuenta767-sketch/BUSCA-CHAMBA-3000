"use strict";
/** Importa data/db.json a SQLite una sola vez (idempotente). El JSON se conserva como respaldo. */
const fs = require("fs");

function migrateJsonToSqlite({ jsonFile, store, log = () => {} }) {
  if (store.driver !== "sqlite") return { skipped: "driver" };
  if (store.kvGet("migrated_from_json")) return { skipped: "already" };
  if (!jsonFile || !fs.existsSync(jsonFile)) return { skipped: "no-json" };
  let db;
  try { db = JSON.parse(fs.readFileSync(jsonFile, "utf8")); } catch (e) { return { error: "db.json ilegible: " + e.message }; }
  if (!db || typeof db !== "object") return { skipped: "empty" };
  const order = Array.isArray(db.order) ? db.order : Object.keys(db.leads || {});
  let leads = 0;
  store.transaction(() => {
    for (const id of order) {
      const l = db.leads && db.leads[id];
      if (l && store.insertLead(id, l)) leads++;
    }
    for (const k of db.scanned || []) store.addScanned(k);
    for (const h of (db.history || []).slice().reverse()) store.addHistory(h);
    if (db.activeScan) store.setActiveScan(db.activeScan);
    store.kvSet("migrated_from_json", String(Date.now()));
  });
  log(`📦 Migrados ${leads} leads, ${(db.scanned || []).length} celdas y ${(db.history || []).length} escaneos de db.json a SQLite`);
  return { leads, scanned: (db.scanned || []).length, history: (db.history || []).length };
}

module.exports = { migrateJsonToSqlite };

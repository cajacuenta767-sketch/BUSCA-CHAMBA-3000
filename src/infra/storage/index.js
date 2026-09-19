"use strict";
/**
 * Fábrica de almacenamiento. Interfaz común (síncrona) que cumplen JsonStore y SqliteStore:
 *
 *   countLeads() · hasLead(id) · getLead(id) · listLeads({offset,limit}) · insertLead(id, lead) → bool
 *   saveLead(id, lead) · updateLeadMeta(id, patch) → meta|null · resetLeads()
 *   scannedKeys() · countScanned() · isScanned(key) · addScanned(key) · addScannedMany(keys)
 *   history() · addHistory(entry) · getActiveScan() · setActiveScan(obj|null)
 *   listLeadsByCatKey(key) · categoryCounts() · batch(fn) · flush() · close()
 */
const { JsonStore } = require("./json-store");

function sqliteAvailable() {
  try { require("node:sqlite"); return true; } catch (e) { return false; }
}

function createStore({ env, log = () => {} }) {
  const driver = env.DB_DRIVER === "json" ? "json" : (env.DB_DRIVER === "sqlite" || sqliteAvailable()) ? "sqlite" : "json";
  if (driver === "sqlite") {
    const { SqliteStore } = require("./sqlite-store");
    const { migrateJsonToSqlite } = require("./migrate");
    const store = new SqliteStore({ file: env.files.dbSqlite, log });
    migrateJsonToSqlite({ jsonFile: env.files.dbJson, store, log });
    return store;
  }
  return new JsonStore({ file: env.files.dbJson, log });
}

module.exports = { createStore, sqliteAvailable };

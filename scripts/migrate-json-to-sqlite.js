#!/usr/bin/env node
"use strict";
// Migra data/db.json → data/busca-chamba.sqlite (una sola vez; el JSON se conserva como respaldo).
const env = require("../src/config/env");
const { SqliteStore } = require("../src/infra/storage/sqlite-store");
const { migrateJsonToSqlite } = require("../src/infra/storage/migrate");
const store = new SqliteStore({ file: env.files.dbSqlite });
const r = migrateJsonToSqlite({ jsonFile: env.files.dbJson, store, log: console.log });
console.log(r.skipped ? "Nada que migrar (" + r.skipped + ")" : r.error ? "Error: " + r.error : `Listo: ${r.leads} leads, ${r.scanned} celdas, ${r.history} escaneos → ${env.files.dbSqlite}`);
store.close();

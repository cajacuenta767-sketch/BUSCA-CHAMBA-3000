#!/usr/bin/env node
"use strict";
// Cuenta tus leads REALES leyendo el almacén (SQLite o db.json). No toca ni interrumpe el escaneo.
// Uso:  node stats.js
const env = require("./src/config/env");
const { createStore } = require("./src/infra/storage");
const { isOwnWebsite } = require("./src/domain/lead");

let store;
try { store = createStore({ env }); } catch (e) { console.error("No pude abrir el almacén de datos\n" + e.message); process.exit(1); }
const leads = store.listLeads();
const hasPhone = (l) => !!(l.phone && String(l.phone).replace(/\D/g, ""));
const hasMail = (l) => Array.isArray(l.emails) && l.emails.length > 0;
const pad = (n) => String(n).padStart(6, " ");
console.log("\n===== BUSCA-CHAMBA-3000 · tus leads (" + store.driver + ") =====");
console.log(pad(leads.length) + "  leads en total");
console.log(pad(leads.filter((l) => !isOwnWebsite(l.website)).length) + "  SIN WEB  (tus mejores prospectos)");
console.log(pad(leads.filter(hasPhone).length) + "  con teléfono (les puedes escribir)");
console.log(pad(leads.filter(hasMail).length) + "  con correo");
console.log(pad(store.countScanned()) + "  celdas ya cubiertas");
const byCat = {}; leads.forEach((l) => { const c = (l.category || "—").trim(); byCat[c] = (byCat[c] || 0) + 1; });
const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
console.log("\nCategorías distintas: " + top.length + "  ·  Top 15:");
top.slice(0, 15).forEach(([c, n]) => console.log("  " + pad(n) + "  " + c));
const byCountry = {}; leads.forEach((l) => { const p = (l.country || "?").toUpperCase(); byCountry[p] = (byCountry[p] || 0) + 1; });
console.log("\nPor país: " + Object.entries(byCountry).sort((a, b) => b[1] - a[1]).map(([p, n]) => p + "=" + n).join("  "));
const h = store.history()[0];
if (h) console.log("\nÚltimo escaneo cerrado: " + new Date(h.ts).toLocaleString() + " · " + h.found + " negocios · " + h.cells + " celdas");
console.log("");
store.close();

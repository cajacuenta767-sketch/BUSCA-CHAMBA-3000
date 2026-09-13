#!/usr/bin/env node
// Cuenta tus leads REALES leyendo data/db.json. No toca ni interrumpe el escaneo.
// Uso:  node stats.js
const fs = require("fs"), path = require("path");
const f = path.join(__dirname, "data", "db.json");
let db;
try { db = JSON.parse(fs.readFileSync(f, "utf8")); }
catch (e) { console.error("No pude leer " + f + "\n" + e.message); process.exit(1); }
const leads = (db.order || []).map(i => db.leads[i]).filter(Boolean);
const realWeb = l => { const w = l.website || ""; return !!w && !/facebook\.|instagram\.|linktr|beacons|wa\.me|api\.whatsapp|tiktok\./i.test(w); };
const conTel = l => !!(l.phone && String(l.phone).replace(/\D/g, ""));
const conMail = l => Array.isArray(l.emails) && l.emails.length > 0;
const pad = n => String(n).padStart(6, " ");
console.log("\n===== BUSCA-CHAMBA-3000 · tus leads =====");
console.log(pad(leads.length) + "  leads en total");
console.log(pad(leads.filter(l => !realWeb(l)).length) + "  SIN WEB  (tus mejores prospectos)");
console.log(pad(leads.filter(conTel).length) + "  con teléfono (les puedes escribir)");
console.log(pad(leads.filter(conMail).length) + "  con correo");
console.log(pad((db.scanned || []).length) + "  celdas ya cubiertas");
const cnt = {}; leads.forEach(l => { const c = (l.category || "—").trim(); cnt[c] = (cnt[c] || 0) + 1; });
const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
console.log("\nCategorías distintas: " + top.length + "  ·  Top 15:");
top.slice(0, 15).forEach(([c, n]) => console.log("  " + pad(n) + "  " + c));
const paises = {}; leads.forEach(l => { const p = (l.country || "?").toUpperCase(); paises[p] = (paises[p] || 0) + 1; });
console.log("\nPor país: " + Object.entries(paises).sort((a, b) => b[1] - a[1]).map(([p, n]) => p + "=" + n).join("  "));
const h = (db.history || [])[0];
if (h) console.log("\nÚltimo escaneo cerrado: " + new Date(h.ts).toLocaleString() + " · " + h.found + " negocios · " + h.cells + " celdas");
console.log("");

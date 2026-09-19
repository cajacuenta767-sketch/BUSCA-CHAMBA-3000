"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { JsonStore } = require("../src/infra/storage/json-store");
const { SqliteStore, MIGRATIONS } = require("../src/infra/storage/sqlite-store");
const { migrateJsonToSqlite } = require("../src/infra/storage/migrate");

const sample = (i) => ({ title: "N" + i, category: "Farmacia", city: "Lima", country: "PE", phone: "+51 9" + i, website: "", emails: [], rating: 4, reviews: i, lat: -12, lon: -77, link: "", place_id: "p" + i, thumb: "", about: "", images: [] });

/** Contrato común: ambas implementaciones deben comportarse igual. */
function contract(name, make) {
  test(`${name}: leads, orden, dedupe y meta`, () => {
    const s = make();
    assert.equal(s.countLeads(), 0);
    assert.equal(s.insertLead("a", sample(1)), true);
    assert.equal(s.insertLead("a", sample(99)), false, "no sobreescribe");
    assert.equal(s.insertLead("b", sample(2)), true);
    assert.equal(s.getLead("a").title, "N1");
    assert.deepEqual(s.listLeads().map((l) => l.title), ["N1", "N2"]);
    assert.deepEqual(s.listLeads({ offset: 1, limit: 1 }).map((l) => l.title), ["N2"]);
    assert.equal(s.listLeadsByCatKey("farmacia-botica").length, 2);
    assert.deepEqual(s.categoryCounts(), [{ key: "farmacia-botica", n: 2 }]);
    assert.deepEqual(s.updateLeadMeta("a", { state: "contactado" }), { state: "contactado" });
    assert.deepEqual(s.updateLeadMeta("a", { notes: "x" }), { state: "contactado", notes: "x" });
    assert.equal(s.updateLeadMeta("zz", {}), null);
    assert.deepEqual(s.getLead("a")._meta, { state: "contactado", notes: "x" });
    const l = s.getLead("b"); l.emails = ["b@b.com"]; l._enr = 1; s.saveLead("b", l);
    assert.deepEqual(s.getLead("b").emails, ["b@b.com"]);
    assert.equal(s.getLead("b")._enr, 1);
    s.resetLeads();
    assert.equal(s.countLeads(), 0);
    s.close();
  });

  test(`${name}: celdas, historial y escaneo activo`, () => {
    const s = make();
    assert.equal(s.addScanned("k1"), true);
    assert.equal(s.addScanned("k1"), false);
    s.addScannedMany(["k1", "k2", "k3"]);
    assert.deepEqual(s.scannedKeys().sort(), ["k1", "k2", "k3"]);
    assert.equal(s.countScanned(), 3);
    assert.equal(s.isScanned("k2"), true);
    s.addHistory({ ts: 1, found: 1, cells: 2, mode: "all", area: [1, 2, 3, 4] });
    s.addHistory({ ts: 2, found: 5, cells: 9, mode: "rubros", area: [1, 2, 3, 4] });
    assert.equal(s.history()[0].ts, 2, "más reciente primero");
    assert.deepEqual(s.history()[0].area, [1, 2, 3, 4]);
    assert.equal(s.getActiveScan(), null);
    s.setActiveScan({ running: true, area: [1, 2, 3, 4] });
    assert.equal(s.getActiveScan().running, true);
    s.setActiveScan(null);
    assert.equal(s.getActiveScan(), null);
    s.close();
  });
}

contract("JsonStore", () => new JsonStore());
contract("SqliteStore", () => new SqliteStore({ file: ":memory:" }));

test("JsonStore: persiste en disco (escritura atómica) y recupera desde .bak si el JSON se corrompe", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc3-json-"));
  const file = path.join(dir, "db.json");
  const s = new JsonStore({ file });
  s.insertLead("a", sample(1)); s.flush();
  assert.equal(new JsonStore({ file }).countLeads(), 1);
  fs.copyFileSync(file, file + ".bak");
  fs.writeFileSync(file, "{corrupto");
  const logs = [];
  const r = new JsonStore({ file, log: (m) => logs.push(m) });
  assert.equal(r.countLeads(), 1);
  assert.ok(logs[0].includes("Recuperada"));
});

test("SqliteStore: persiste en archivo y las migraciones son idempotentes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc3-sqlite-"));
  const file = path.join(dir, "x.sqlite");
  const a = new SqliteStore({ file }); a.insertLead("a", sample(1)); a.close();
  const b = new SqliteStore({ file });
  assert.equal(b.countLeads(), 1);
  assert.equal(b.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n, MIGRATIONS.length);
  assert.equal(b.db.prepare("SELECT catkey FROM leads WHERE id = 'a'").get().catkey, "farmacia-botica", "rubro normalizado indexado");
  assert.equal(b.db.prepare("SELECT category FROM leads WHERE id = 'a'").get().category, "Farmacia", "columna proyectada indexable");
  b.close();
});

test("migrateJsonToSqlite: importa una sola vez y conserva meta, celdas e historial", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc3-mig-"));
  const jsonFile = path.join(dir, "db.json");
  const lead = Object.assign(sample(1), { _meta: { state: "cliente" }, _enr: 1 });
  fs.writeFileSync(jsonFile, JSON.stringify({ leads: { a: lead }, order: ["a"], history: [{ ts: 1, found: 1, cells: 1 }], scanned: ["k"], activeScan: null }));
  const s = new SqliteStore({ file: ":memory:" });
  const r = migrateJsonToSqlite({ jsonFile, store: s });
  assert.deepEqual(r, { leads: 1, scanned: 1, history: 1 });
  assert.deepEqual(s.getLead("a")._meta, { state: "cliente" });
  assert.equal(s.getLead("a")._enr, 1);
  assert.equal(s.isScanned("k"), true);
  assert.equal(migrateJsonToSqlite({ jsonFile, store: s }).skipped, "already");
  assert.ok(fs.existsSync(jsonFile), "el JSON se conserva como respaldo");
  s.close();
});

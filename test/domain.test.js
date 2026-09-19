"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCSV, splitCompleteRows } = require("../src/domain/csv");
const lead = require("../src/domain/lead");
const grid = require("../src/domain/grid");
const proxy = require("../src/domain/proxy");

test("parseCSV: comillas, comillas escapadas y CRLF", () => {
  const rows = parseCSV('a,b,c\r\n1,"x, y","di ""hola"""\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", 'di "hola"']]);
});

test("parseCSV: última fila sin salto de línea se conserva", () => {
  assert.deepEqual(parseCSV("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("splitCompleteRows: corta solo en saltos de línea fuera de comillas", () => {
  assert.deepEqual(splitCompleteRows("a,b\n1,2\n3,"), ["a,b\n1,2\n", "3,"]);
  assert.deepEqual(splitCompleteRows('a,"x\ny"\n1,"par'), ['a,"x\ny"\n', '1,"par']);
  assert.deepEqual(splitCompleteRows('1,"sin cerrar\n'), ["", '1,"sin cerrar\n']);
  assert.deepEqual(splitCompleteRows(""), ["", ""]);
});

test("rowToLead: normaliza fila del scraper y detecta redes en cualquier columna", () => {
  const H = ["title", "category", "address", "phone", "website", "emails", "review_rating", "review_count", "latitude", "longitude", "link", "place_id", "complete_address", "descriptions"];
  const row = ["Botica Sol", "Farmacia", "", "+51 987654321", "https://www.facebook.com/boticasol", "a@b.com, A@B.COM", "4.6", "1,234", "-12.1", "-77.0", "https://maps/x", "pid1",
    '{"street":"7XJQ+ABC, Av. Sol 123","city":"Cusco","state":"Cusco","country":"pe"}', '[{"options":[{"name":"Delivery","enabled":true},{"name":"Reservas","enabled":false},"Wifi"]}]'];
  const l = lead.rowToLead(H, row);
  assert.equal(l.title, "Botica Sol");
  assert.equal(l.address, "Av. Sol 123, Cusco, Cusco, pe");
  assert.equal(l.city, "Cusco");
  assert.equal(l.country, "PE");
  assert.deepEqual(l.emails, ["a@b.com"]);
  assert.equal(l.reviews, 1234);
  assert.equal(l.rating, 4.6);
  assert.equal(l.social.fb, "https://www.facebook.com/boticasol");
  assert.equal(l.about, "Delivery · Wifi");
  assert.equal(lead.leadId(l), "pid1");
});

test("rowToLead: sin título → null; dirección plana → ciudad = último tramo", () => {
  const H = ["title", "address"];
  assert.equal(lead.rowToLead(H, ["", "x"]), null);
  assert.equal(lead.rowToLead(H, ["A", "Jr. Lima 1, Miraflores, Lima"]).city, "Lima");
});

test("leadId: place_id → link → teléfono → título|dirección", () => {
  assert.equal(lead.leadId({ place_id: "p", link: "l", phone: "1" }), "p");
  assert.equal(lead.leadId({ link: "l", phone: "1" }), "l");
  assert.equal(lead.leadId({ phone: "+51 (1) 234", title: "t", address: "a" }), "tel:511234");
  assert.equal(lead.leadId({ title: "t", address: "a" }), "t|a");
});

test("isOwnWebsite y cleanEmails", () => {
  assert.equal(lead.isOwnWebsite("https://miweb.pe"), true);
  assert.equal(lead.isOwnWebsite("https://instagram.com/x"), false);
  assert.equal(lead.isOwnWebsite("miweb.pe"), false);
  assert.deepEqual(lead.cleanEmails(["ok@x.com", "img@2x.png", "u@sentry.io", "ok@x.com"]), ["ok@x.com"]);
});

test("grid: computeCells cubre el área y fitCells auto-ajusta el tamaño", () => {
  const area = [-12.10, -77.10, -12.00, -77.00]; // ~11 km × ~11 km
  const cells = grid.computeCells(area, 1);
  assert.ok(cells.length >= 121 && cells.length <= 144, "celdas: " + cells.length);
  assert.equal(cells[0].state, "pending");
  const fit = grid.fitCells(area, 0.2, 50);
  assert.equal(fit.adjusted, true);
  assert.ok(fit.cells.length <= 50);
  assert.equal(fit.tooBig, false);
  const huge = grid.fitCells([-20, -80, 0, -60], 1, 550);
  assert.equal(huge.tooBig, true);
});

test("grid: splitCell divide en 4 con mitad de km y profundidad +1", () => {
  const c = grid.computeCells([0, 0, 0.01, 0.01], 1)[0];
  const subs = grid.splitCell(c);
  assert.equal(subs.length, 4);
  assert.equal(subs[0].km, 0.5);
  assert.equal(subs[0].depth, 1);
  assert.ok(subs.every((s) => s.key.startsWith(c.key + "s")));
});

test("grid: markScanned reconoce claves exactas y celdas cercanas", () => {
  const area = [-12.02, -77.02, -12.00, -77.00];
  const cells = grid.computeCells(area, 1);
  const n = grid.markScanned(cells, [cells[0].key], 1, area);
  assert.equal(n, 1);
  assert.equal(cells[0].state, "done");
  assert.equal(grid.countFinished(cells), 1);
  assert.equal(grid.markScanned(grid.computeCells(area, 1), [], 1, area), 0);
});

test("proxy: normalización de formatos y parseo de listas", () => {
  assert.equal(proxy.normalizeProxy("1.2.3.4:8080"), "http://1.2.3.4:8080");
  assert.equal(proxy.normalizeProxy("1.2.3.4:8080:user:pass"), "http://user:pass@1.2.3.4:8080");
  assert.equal(proxy.normalizeProxy("socks5://a:b@h:1"), "socks5://a:b@h:1");
  assert.deepEqual(proxy.parseProxyList("1.1.1.1:80\n# comentario\n1.1.1.1:80, 2.2.2.2:81"), ["http://1.1.1.1:80", "http://2.2.2.2:81"]);
  assert.equal(proxy.maskProxy("http://user:pass@h:1"), "http://***:***@h:1/");
});

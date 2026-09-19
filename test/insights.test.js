"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/domain/taxonomy");
const I = require("../src/domain/insights");

const base = { lat: -12.05, lon: -77.04 };
const km = (dLat, dLon) => ({ lat: base.lat + dLat / 111, lon: base.lon + dLon / (111 * Math.cos((base.lat * Math.PI) / 180)) });
let seq = 0;
const mk = (o) => Object.assign({ place_id: "p" + (++seq), title: "N" + seq, category: "Farmacia", city: "Lima", address: "Av. X 1, Lima", website: "", social: {}, phone: "+51 9" + seq, rating: 4.2, reviews: 40 }, o);

test("taxonomía: sinónimos y acentos caen en el mismo rubro; desconocidos conservan su nombre", () => {
  assert.equal(T.categoryKey("Botica"), T.categoryKey("Farmacia y perfumería"));
  assert.equal(T.classifyCategory("Cevichería").vertical, "restaurante");
  assert.equal(T.classifyCategory("Peluquería").group, "belleza");
  assert.equal(T.classifyCategory("Espacio coworking").known, false);
  assert.equal(T.normalizeCategory("Espacio coworking"), "Espacio coworking");
  assert.equal(T.classifyCategory("Tienda de ropa").service, "caja");
  assert.equal(T.verticalLabel("bodega"), "Bodega / minimarket");
});

test("competidores: mismo rubro por radio (2 km → 5 km) y nunca de otro rubro", () => {
  const me = mk(Object.assign({ reviews: 120, rating: 4.7 }, base));
  const near = [1, 2, 3, 4].map((i) => mk(Object.assign({ reviews: 30 + i }, km(0.4 * i, 0.3))));
  const far = [1, 2].map((i) => mk(Object.assign({ reviews: 300 }, km(4, i))));
  const rest = [1, 2, 3, 4, 5].map(() => mk(Object.assign({ category: "Restaurante", reviews: 900 }, km(0.2, 0.2))));
  const r = I.analyze(me, [me, ...near, ...far, ...rest]);
  assert.equal(r.ok, true);
  assert.equal(r.stats.level, "radius");
  assert.equal(r.stats.radiusKm, 2, "con 5 farmacias a menos de 2 km basta");
  assert.equal(r.stats.n, 5);
  assert.equal(r.stats.rankVis, 1);
  assert.equal(r.stats.focus, "visibilidad");
  assert.match(r.stats.scope, /5 negocios de farmacia \/ botica a menos de 2 km/);
  assert.ok(!r.stats.scope.includes("restaur"));
  assert.equal(r.insights[0].id, "lider-resenas");
  assert.match(r.anchor, /más reseñados/);
  const me2 = mk(Object.assign({ reviews: 10 }, km(-2.5, 0)));
  const r2 = I.analyze(me2, [me2, ...near, ...far]);
  assert.equal(r2.stats.radiusKm, 5, "sin 5 a 2 km, amplía a 5 km");
});

test("sin ubicación cae a misma ciudad; con menos de 5 competidores no hay ranking", () => {
  const me = mk({ reviews: 50, city: "Cusco" });
  const same = [1, 2, 3, 4].map(() => mk({ city: "cusco", reviews: 20 }));
  const other = [1, 2, 3].map(() => mk({ city: "Lima" }));
  const r = I.analyze(me, [me, ...same, ...other]);
  assert.equal(r.stats.level, "city");
  assert.equal(r.stats.n, 5);
  const few = I.analyze(me, [me, ...same.slice(0, 2)]);
  assert.equal(few.ok, false);
  assert.equal(few.reason, "pocos competidores");
  assert.equal(I.analyze(mk({ category: "" }), [me]).reason, "sin rubro");
});

test("dos rankings: negocio nuevo con buena calificación se enfoca en calidad y no sale 'último'", () => {
  const me = mk(Object.assign({ reviews: 12, rating: 4.9 }, base));
  const peers = [1, 2, 3, 4, 5, 6].map((i) => mk(Object.assign({ reviews: 100 + i * 20, rating: 3.9 }, km(0.3 * i, 0))));
  const r = I.analyze(me, [me, ...peers]);
  assert.equal(r.stats.rankVis, 7, "por reseñas es el último");
  assert.equal(r.stats.rankQual, 1, "por calidad (bayesiano) es el primero");
  assert.equal(r.stats.focus, "calidad");
  assert.match(r.anchor, /4\.9 estrellas/);
  const groups = r.insights.map((x) => x.group);
  assert.equal(new Set(groups).size, groups.length, "una frase por grupo, sin contradicciones");
  assert.ok(r.insights.length <= 3);
  assert.ok(r.insights.some((x) => x.id === "calidad-alta"));
});

test("índice reutilizable y memo por negocio", () => {
  const leads = [1, 2, 3, 4, 5, 6].map((i) => mk(Object.assign({ reviews: i * 10 }, km(0.1 * i, 0))));
  const idx = I.createIndex(leads);
  const a = I.analyze(leads[0], idx), b = I.analyze(leads[0], idx);
  assert.equal(a, b, "misma referencia: se calcula una vez");
  assert.equal(I.analyze(leads[5], idx).stats.rankVis, 1);
});

test("haversine: 1 grado de latitud ≈ 111 km", () => {
  assert.ok(Math.abs(I.haversineKm(0, 0, 1, 0) - 111.2) < 0.5);
});

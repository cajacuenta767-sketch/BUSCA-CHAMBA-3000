"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Msg = require("../src/domain/messages");

const lead = (o) => Object.assign({ place_id: "x1", title: "Botica Central", category: "Farmacia", address: "Av. Sol 1, Cusco" }, o);

test("paso 1: apertura con hecho real, gancho, oferta y pregunta; ≤ 350 caracteres", () => {
  const m = Msg.buildMessage({ lead: lead(), sender: "Bryan", anchor: "vi que tienen 120 reseñas en Google, más que el promedio de su zona", variant: "A" });
  assert.equal(m.step, 1);
  assert.match(m.text, /^Hola, ¿hablo con Botica Central\? Soy Bryan\. Vi que tienen 120 reseñas/);
  assert.match(m.text, /boticas/);
  assert.match(m.text, /\?$/);
  assert.ok(m.chars <= Msg.MAX_CHARS, "largo " + m.chars);
  assert.equal((m.text.match(/gratis/gi) || []).length, 1, "'gratis' una sola vez");
  assert.ok(!/100%/.test(m.text));
});

test("variantes: estables por negocio y distintas entre sí", () => {
  const a = Msg.buildMessage({ lead: lead(), sender: "Bryan", variant: "A" }).text;
  const b = Msg.buildMessage({ lead: lead(), sender: "Bryan", variant: "B" }).text;
  const c = Msg.buildMessage({ lead: lead(), sender: "Bryan", variant: "C" }).text;
  assert.ok(a !== b && b !== c && a !== c);
  const v1 = Msg.variantFor(lead()), v2 = Msg.variantFor(lead());
  assert.equal(v1, v2);
  const spread = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => Msg.variantFor(lead({ place_id: "id" + i }))));
  assert.equal(spread.size, 3, "la base se reparte en las tres variantes");
});

test("secuencia: recordatorio y cierre con salida; siguiente paso y fecha de seguimiento", () => {
  const s2 = Msg.buildMessage({ lead: lead(), sender: "Bryan Salirrosas", step: 2, variant: "B" });
  assert.match(s2.text, /otra vez|Le escribí|no dejarlo/);
  const s3 = Msg.buildMessage({ lead: lead(), sender: "Bryan", step: 3, variant: "A", demo: "https://d.pe" });
  assert.match(s3.text, /no le vuelvo a escribir/);
  assert.ok(!s3.text.includes("https://d.pe"), "el cierre no lleva enlace");
  assert.deepEqual(Msg.nextStep([]), { step: 1, dueTs: null, done: false, last: null });
  const t0 = Date.parse("2026-09-19T12:00:00Z");
  const n = Msg.nextStep([{ ts: t0, step: 1, variant: "A", channel: "wa" }]);
  assert.equal(n.step, 2);
  assert.equal(n.dueTs, t0 + 3 * 86400000);
  assert.equal(Msg.nextStep([{ ts: t0, step: 3 }]).done, true);
  assert.match(Msg.followDateAfter(1, t0), /^2026-09-22$/);
  assert.equal(Msg.followDateAfter(3, t0), "");
});

test("oferta: vertical del rubro, servicio genérico para rubros sin vertical, o la elegida a mano", () => {
  assert.equal(Msg.offerFor(lead()).key, "farmacia");
  assert.equal(Msg.offerFor(lead({ category: "Tienda de ropa" })).key, "caja");
  assert.equal(Msg.offerFor(lead({ category: "Consultorio médico" })).key, "citas");
  assert.equal(Msg.offerFor(lead(), "fiados").key, "fiados");
  assert.match(Msg.offerFor(lead({ category: "Tienda de ropa" }), "sistema").text, /para ropa \/ calzado/);
  assert.equal(Msg.emailSubject(lead()), "Vencimientos y stock de Botica Central");
  assert.equal(Msg.emailSubject(lead(), 2), "Re: Vencimientos y stock de Botica Central");
});

test("métrica por variante: enviados, negocios y respuestas", () => {
  const metas = [
    { state: "respondio", messages: [{ variant: "A", step: 1 }, { variant: "A", step: 2 }] },
    { state: "contactado", messages: [{ variant: "A", step: 1 }] },
    { state: "cliente", messages: [{ variant: "B", step: 1 }] },
    { state: "nuevo", messages: [] },
  ];
  const s = Msg.variantStats(metas);
  assert.deepEqual(s.A, { sent: 3, leads: 2, replied: 1, rate: 50 });
  assert.deepEqual(s.B, { sent: 1, leads: 1, replied: 1, rate: 100 });
  assert.equal(s.C.rate, null);
});

test("todos los pasos de todas las verticales y variantes respetan el tope", () => {
  for (const v of Object.keys(Msg.OFFERS)) for (const variant of Msg.VARIANTS) for (const step of [1, 2, 3]) {
    const m = Msg.buildMessage({ lead: lead({ category: v === "sistema" ? "Espacio coworking" : v }), sender: "Bryan Salirrosas", step, variant, offer: v, anchor: "vi que el 70% de los negocios de su rubro en su zona sigue sin sistema" });
    assert.ok(!m.overLimit, `${v}/${variant}/${step}: ${m.chars}`);
  }
});

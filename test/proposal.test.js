"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../src/domain/insights");
const M = require("../src/ui/proposal-model");
const P = require("../src/ui/proposal-pdf");
const H = require("../src/ui/proposal-html");

let seq = 0;
const mk = (o) => Object.assign({ place_id: "p" + (++seq), title: "Botica " + seq, category: "Farmacia", city: "Cusco", address: "Av. Sol " + seq + ", Cusco", website: "", social: {}, phone: "+51 9876543" + seq, rating: 4.2, reviews: 30 + seq, lat: -13.52 + seq * 0.002, lon: -71.97 + seq * 0.0015, thumb: "" }, o);
const zone = () => [1, 2, 3, 4, 5, 6, 7].map(() => mk());
const ctx = (extra) => Object.assign({ sender: "Bryan Salirrosas", contact: "+51 999 999 999 · bryan@skytech.pe", demo: "https://demo.skytech.pe", now: new Date("2026-09-19T12:00:00Z") }, extra);

/** jsPDF simulado: registra llamadas y detecta texto fuera de página. */
function fakeDoc() {
  const calls = { text: [], pages: 1, images: 0, links: 0 };
  const d = {
    _page: 1, _size: 10,
    setFont() {}, setFontSize(s) { this._size = s; }, setTextColor() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {}, setLineJoin() {},
    text(t, x, y) { calls.text.push({ t: String(t), x, y, page: this._page }); }, textWithLink(t, x, y) { calls.links++; this.text(t, x, y); },
    splitTextToSize(t, w) { const cpl = Math.max(8, Math.floor(w / (this._size * 0.18))); const out = []; for (const para of String(t).split("\n")) { let line = ""; for (const word of para.split(" ")) { if ((line + " " + word).trim().length > cpl) { out.push(line.trim()); line = word; } else line = (line + " " + word).trim(); } out.push(line); } return out; },
    getTextWidth(t) { return String(t).length * this._size * 0.18; },
    roundedRect() {}, rect() {}, circle() {}, line() {}, lines() {}, triangle() {},
    addPage() { calls.pages++; this._page = calls.pages; }, setPage(n) { this._page = n; }, getNumberOfPages() { return calls.pages; },
    link() { calls.links++; }, addImage() { calls.images++; },
  };
  return { d, calls };
}

test("modelo: negocio líder → KPIs, comparación, radar, folio estable y QR de contacto", () => {
  const leads = zone(); const me = leads[6];
  me.reviews = 500; me.rating = 4.8;
  const m = M.buildProposal(me, ctx({ analysis: I.analyze(me, leads) }));
  assert.equal(m.cover.kpis.length, 3);
  assert.equal(m.cover.kpis[0].value, "1.º");
  assert.equal(m.comparison.rank.pos, 1);
  assert.equal(m.comparison.radar.radiusKm, 2);
  assert.equal(m.comparison.radar.points.length, 7);
  assert.match(m.meta.folio, /^SKT-2026-\d{4}$/);
  assert.equal(M.buildProposal(me, ctx({ analysis: I.analyze(me, leads) })).meta.folio, m.meta.folio, "el folio no cambia entre generaciones");
  assert.match(m.meta.qr.url, /^https:\/\/wa\.me\/51999999999/);
  assert.equal(m.beforeAfter.length, 4);
  assert.ok(m.includes[0].startsWith("Hecho para su rubro"));
  assert.ok(m.insights.length >= 1 && m.insights.length <= 3);
  assert.ok(!JSON.stringify(m).includes("undefined"));
});

test("modelo: negocio nuevo bien calificado se compara por calidad; sin competidores no inventa ranking", () => {
  const leads = zone(); const me = leads[0];
  me.reviews = 6; me.rating = 4.9;
  const m = M.buildProposal(me, ctx({ analysis: I.analyze(me, leads) }));
  assert.equal(m.comparison.rank.focus, "calidad");
  assert.match(m.comparison.title, /califican/);
  assert.equal(m.comparison.max, 5);
  const alone = mk({ category: "Espacio coworking" });
  const m2 = M.buildProposal(alone, ctx({ analysis: I.analyze(alone, [alone]) }));
  assert.equal(m2.comparison, null);
  assert.equal(m2.cover.kpis[0].label, "reseñas en Google");
  assert.equal(m2.includes.length, 5, "sin vertical no hay línea 'hecho para su rubro'");
  assert.equal(M.buildProposal(alone, ctx({ contact: "" })).meta.qr, null);
});

test("PDF: propuesta completa cabe en 2 páginas, sin texto fuera de página; versión 1 página cabe en una", () => {
  const leads = zone(); const me = leads[3];
  const m = M.buildProposal(me, ctx({ analysis: I.analyze(me, leads) }));
  const { d, calls } = fakeDoc();
  const r = P.renderProposal(d, m, { qr: () => true, images: { photo: { data: "data:image/jpeg;base64,AAAA", format: "JPEG" } } });
  assert.equal(r.pages, 2);
  assert.equal(calls.images, 1);
  assert.ok(calls.links >= 2, "QR + demo enlazados");
  for (const t of calls.text) assert.ok(t.y <= P.PAGE.h && t.y >= 0 && t.x >= 0 && t.x <= P.PAGE.w, "texto fuera de página: " + JSON.stringify(t));
  const all = calls.text.map((t) => t.t).join("\n");
  assert.ok(all.includes(m.meta.folio) && all.includes("pág. 1 / 2") && all.includes("HOY, A MANO") && all.includes(m.cover.title));
  const one = fakeDoc();
  assert.equal(P.renderProposal(one.d, m, { mode: "one", qr: () => true }).pages, 1);
});

test("PDF: sin análisis ni contacto ni fuentes de marca sigue generando (Helvetica, sin ★)", () => {
  const me = mk({ rating: 4.6, category: "Coworking" });
  const m = M.buildProposal(me, { analysis: I.analyze(me, [me]) });
  const { d, calls } = fakeDoc();
  P.renderProposal(d, m, { fonts: { display: "helvetica", body: "helvetica" } });
  assert.ok(!calls.text.some((t) => t.t.includes("★")), "Helvetica no tiene la estrella: se dibuja como vector");
  assert.ok(calls.text.some((t) => /Lo que vimos/.test(t.t)));
});

test("HTML: mismo modelo, misma información", () => {
  const leads = zone(); const me = leads[2];
  const m = M.buildProposal(me, ctx({ analysis: I.analyze(me, leads) }));
  const html = H.renderProposalHtml([m], { qrSvg: () => "<svg></svg>", fontsHref: "" });
  assert.ok(html.includes(m.cover.title) && html.includes(m.meta.folio) && html.includes("<svg class=\"radar\"") && html.includes(m.cta.headline));
  assert.ok(!html.includes("undefined"));
  const one = H.renderProposalHtml([m], { mode: "one", fontsHref: "" });
  assert.ok(!one.includes("HOY, A MANO"));
});

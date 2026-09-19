"use strict";
/**
 * Renderizador de la propuesta en PDF (jsPDF) a partir del modelo de proposal-model.js.
 * Sistema de diseño propio: retícula de 4 mm, escala tipográfica, tarjetas, barras, radar,
 * tabla hoy/con sistema, plan y cierre con QR. Fuentes de marca si están cargadas (Sora + IBM
 * Plex Sans), Helvetica si no. Sin dependencias: recibe el `doc` de jsPDF ya creado.
 * Funciona en el navegador y en Node (build node de jsPDF) para pruebas.
 */
const Logo = require("./logo");

const C = {
  navy: [11, 60, 104], sky: [31, 162, 255], ink: [17, 37, 58], mut: [92, 113, 131], line: [215, 226, 238], bg: [244, 247, 251], white: [255, 255, 255],
  azul: [29, 78, 216], rojo: [217, 45, 32], ambar: [183, 121, 31], verde: [14, 159, 110],
  azulW: [229, 236, 252], rojoW: [253, 232, 230], ambarW: [250, 241, 225], verdeW: [224, 246, 238], navyW: [232, 240, 249], grisW: [236, 240, 245],
};
const TONE = { azul: [C.azul, C.azulW], ambar: [C.ambar, C.ambarW], verde: [C.verde, C.verdeW], rojo: [C.rojo, C.rojoW], gris: [C.mut, C.grisW], navy: [C.navy, C.navyW] };
const PAGE = { w: 210, h: 297, m: 16, footerH: 12 };
const PT = 25.4 / 72; // mm por punto
const GRID = 4;

/** Envoltorio fino sobre jsPDF: fuentes, texto envuelto, formas. */
class Pen {
  constructor(doc, fonts) {
    this.doc = doc;
    this.fonts = fonts || { display: "helvetica", body: "helvetica" };
    this.y = PAGE.m;
    this.page = 1;
    this.lhScale = 1; // < 1 en modo denso (cuando la segunda página no cabe)
  }
  get W() { return PAGE.w; }
  get cw() { return PAGE.w - 2 * PAGE.m; }
  get bottom() { return PAGE.h - PAGE.m - PAGE.footerH; }

  font(kind, weight) {
    const name = kind === "display" ? this.fonts.display : this.fonts.body;
    // Sora solo viene en bold; Helvetica y Plex tienen normal/bold.
    const style = kind === "display" ? "bold" : (weight === "bold" ? "bold" : "normal");
    try { this.doc.setFont(name, style); } catch (e) { this.doc.setFont("helvetica", style); }
    return this;
  }
  size(pt) { this.doc.setFontSize(pt); return this; }
  color(rgb) { this.doc.setTextColor(rgb[0], rgb[1], rgb[2]); return this; }
  fill(rgb) { this.doc.setFillColor(rgb[0], rgb[1], rgb[2]); return this; }
  stroke(rgb, w) { this.doc.setDrawColor(rgb[0], rgb[1], rgb[2]); if (w != null) this.doc.setLineWidth(w); return this; }
  lh(pt, factor) { return pt * PT * (factor || 1.32) * this.lhScale; }
  wrap(text, w) { return this.doc.splitTextToSize(String(text == null ? "" : text), w); }
  width(text) { return this.doc.getTextWidth(String(text)); }
  clean(text) { return this.fonts.body === "helvetica" ? String(text).replace(/★/g, "*") : String(text); }

  /** Dibuja un párrafo envuelto y devuelve su altura. `o`: {size, color, kind, weight, lh, align} */
  para(text, x, y, w, o = {}) {
    const size = o.size || 10;
    this.font(o.kind || "body", o.weight || "normal").size(size).color(o.color || C.ink);
    const lines = this.wrap(this.clean(text), w), h = this.lh(size, o.lh);
    lines.forEach((ln, i) => this.doc.text(ln, o.align === "center" ? x + w / 2 : (o.align === "right" ? x + w : x), y + h * (i + 0.78), o.align ? { align: o.align } : undefined));
    return lines.length * h;
  }
  measure(text, w, size, kind, weight, lhf) {
    this.font(kind || "body", weight || "normal").size(size);
    return this.wrap(this.clean(text), w).length * this.lh(size, lhf);
  }
  /** Una línea de texto (sin envolver). */
  line(text, x, y, o = {}) {
    this.font(o.kind || "body", o.weight || "normal").size(o.size || 10).color(o.color || C.ink);
    this.doc.text(this.clean(text), x, y, Object.assign({}, o.align ? { align: o.align } : {}, o.charSpace ? { charSpace: o.charSpace } : {}));
    return this;
  }
  rrect(x, y, w, h, r, fillRgb, strokeRgb, lw) {
    if (fillRgb) this.fill(fillRgb);
    if (strokeRgb) this.stroke(strokeRgb, lw || 0.3);
    this.doc.roundedRect(x, y, w, h, r, r, fillRgb && strokeRgb ? "FD" : (fillRgb ? "F" : "S"));
  }
  rect(x, y, w, h, fillRgb) { this.fill(fillRgb); this.doc.rect(x, y, w, h, "F"); }
  circle(x, y, r, fillRgb, strokeRgb, lw) {
    if (fillRgb) this.fill(fillRgb);
    if (strokeRgb) this.stroke(strokeRgb, lw || 0.3);
    this.doc.circle(x, y, r, fillRgb && strokeRgb ? "FD" : (fillRgb ? "F" : "S"));
  }
  hline(x1, x2, y, rgb, w) { this.stroke(rgb, w || 0.3); this.doc.line(x1, y, x2, y); }
  star(x, y, r, rgb) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; pts.push([x + rr * Math.cos(a), y + rr * Math.sin(a)]); }
    this.fill(rgb);
    this.doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], "F", true);
  }
  check(x, y, z, rgb) { this.stroke(rgb, 0.7); this.doc.line(x, y, x + z * 0.36, y + z * 0.38); this.doc.line(x + z * 0.36, y + z * 0.38, x + z, y - z * 0.52); }
  cross(x, y, z, rgb) { this.stroke(rgb, 0.7); this.doc.line(x, y - z * 0.4, x + z * 0.8, y + z * 0.4); this.doc.line(x + z * 0.8, y - z * 0.4, x, y + z * 0.4); }
  withOpacity(alpha, fn) {
    const d = this.doc;
    let ok = false;
    try { if (d.GState && d.setGState && d.saveGraphicsState) { d.saveGraphicsState(); d.setGState(new d.GState({ opacity: alpha })); ok = true; } } catch (e) { ok = false; }
    fn();
    if (ok) { try { d.restoreGraphicsState(); } catch (e) { /* nada */ } }
  }
}

/** Flujo vertical con salto de página automático. */
class Flow {
  constructor(pen, model, opts) { this.p = pen; this.m = model; this.o = opts; this.y = PAGE.m; }
  ensure(h) {
    if (this.y + h <= this.p.bottom) return;
    this.p.doc.addPage(); this.p.page++; this.y = PAGE.m + 4;
  }
  gap(n = 1) { this.y += GRID * n; }
  h2(title, keep) {
    const p = this.p; this.ensure(14 + (keep || 12));
    p.rrect(PAGE.m, this.y, 1.8, 6.4, 0.9, C.sky);
    p.line(title, PAGE.m + 5, this.y + 5.2, { kind: "display", size: 12.5, color: C.navy });
    this.y += 7;
    p.hline(PAGE.m, PAGE.m + p.cw, this.y, C.line, 0.3);
    this.y += 3.5;
  }
  bullets(items, tone) {
    const p = this.p, col = TONE[tone || "azul"][0];
    for (const t of items) {
      const h = p.measure(t, p.cw - 7, 9.6, "body", "normal");
      this.ensure(h + 2);
      p.circle(PAGE.m + 1.6, this.y + 2.2, 1, col);
      p.para(t, PAGE.m + 6, this.y, p.cw - 7, { size: 9.6 });
      this.y += h + 2;
    }
  }
}

// ---------------------------------------------------------------- bloques
function header(pen, model, opts, h, one) {
  const d = pen.doc, M = PAGE.m, W = PAGE.w;
  pen.rect(0, 0, W, h, C.navy);
  pen.rect(0, h, W, 1.6, C.sky);
  // marca de agua: la nube grande y tenue a la derecha
  const wm = h * 0.98;
  pen.withOpacity(0.09, () => Logo.drawIsotypePdf(d, W - wm * 0.86, -8, wm, { variant: "onDark", noBg: true }));
  Logo.drawIsotypePdf(d, M, 11, 11, { variant: "onDark" });
  Logo.drawWordmarkPdf(d, M + 14.5, 19, 12.5, { variant: "onDark", font: pen.fonts.display });
  pen.line("SISTEMAS DE GESTIÓN PARA NEGOCIOS", M + 14.5, 24.2, { size: 6.8, color: [170, 200, 230], weight: "bold", charSpace: 0.5 });

  const photo = opts.images && opts.images.photo;
  const photoW = photo ? 44 : 0;
  const textW = pen.cw - photoW - (photo ? 8 : 0);
  let y = h - (one ? 33 : 42);
  pen.line(model.cover.kicker, M, y, { size: 7.8, color: [150, 190, 230], weight: "bold", charSpace: 0.6 });
  y += one ? 8.5 : 10;
  let size = one ? 21 : 24;
  pen.font("display").size(size);
  let lines = pen.wrap(model.cover.title, textW);
  if (lines.length > 2) { size = 17; pen.size(size); lines = pen.wrap(model.cover.title, textW).slice(0, 2); }
  else if (lines.length === 2) { size = 19; pen.size(size); lines = pen.wrap(model.cover.title, textW); }
  pen.color(C.white);
  lines.forEach((ln, i) => d.text(ln, M, y + i * pen.lh(size, 1.15)));
  y += lines.length * pen.lh(size, 1.15) + 3;
  pen.para(model.cover.subtitle, M, y - 3, textW, { size: 9, color: [190, 212, 236] });
  if (photo) {
    const px = W - M - photoW, py = h - 12 - photoW;
    pen.rrect(px - 1.5, py - 1.5, photoW + 3, photoW + 3, 3.5, C.white);
    try { d.addImage(photo.data, photo.format || "JPEG", px, py, photoW, photoW, undefined, "FAST"); } catch (e) { pen.rrect(px, py, photoW, photoW, 2.5, C.navyW); }
  }
}

function footers(pen, model) {
  const d = pen.doc, n = d.getNumberOfPages ? d.getNumberOfPages() : pen.page;
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    const y = PAGE.h - PAGE.m - 2;
    pen.hline(PAGE.m, PAGE.m + pen.cw, y - 5.5, C.line, 0.3);
    Logo.drawIsotypePdf(d, PAGE.m, y - 3.6, 4.4, { variant: "color" });
    pen.line("Sky Tech  ·  Propuesta " + model.meta.folio + "  ·  válida hasta " + model.meta.validUntil, PAGE.m + 6.5, y - 0.4, { size: 7.2, color: C.mut });
    pen.line("pág. " + i + " / " + n, PAGE.m + pen.cw, y - 0.4, { size: 7.2, color: C.mut, align: "right" });
  }
}

function promise(f, compact) {
  const p = f.p, m = f.m, M = PAGE.m;
  const bodyH = p.measure(m.cover.promise.body, p.cw - 16, compact ? 9.8 : 10.5, "body", "normal", 1.3);
  const h = (compact ? 8 : 10) + 7 + bodyH + (compact ? 4 : 5);
  f.ensure(h);
  p.rrect(M, f.y, p.cw, h, 3, C.navyW);
  p.rrect(M, f.y, 2.2, h, 1.1, C.navy);
  p.line(m.cover.promise.headline, M + 8, f.y + (compact ? 8.2 : 9.5), { kind: "display", size: compact ? 13.5 : 15, color: C.navy });
  p.para(m.cover.promise.body, M + 8, f.y + (compact ? 11.2 : 13), p.cw - 16, { size: compact ? 9.8 : 10.5, color: C.ink, lh: 1.3 });
  f.y += h;
  f.gap(1.25);
}

function kpis(f) {
  const p = f.p, m = f.m, M = PAGE.m, gapW = 4, n = m.cover.kpis.length, bw = (p.cw - gapW * (n - 1)) / n, h = 22;
  f.ensure(h);
  m.cover.kpis.forEach((k, i) => {
    const x = M + i * (bw + gapW), [col, weak] = TONE[k.tone] || TONE.azul;
    p.rrect(x, f.y, bw, h, 3, weak);
    p.rrect(x, f.y, bw, 2, 1, col);
    let vx = x + 5, val = String(k.value);
    if (/^★\s*/.test(val)) { p.star(x + 7.2, f.y + 11.2, 2.4, col); vx = x + 11.5; val = val.replace(/^★\s*/, ""); }
    p.line(val, vx, f.y + 12.5, { kind: "display", size: 16, color: col });
    p.para(k.label, x + 5, f.y + 14, bw - 8, { size: 7.4, color: C.mut, lh: 1.15 });
  });
  f.y += h;
  f.gap(1.5);
}

function bars(p, x, y, w, comp, rowH) {
  const labW = 44, barW = w - labW - 14;
  comp.bars.forEach((b, i) => {
    const yy = y + i * rowH, [col] = TONE[b.tone] || TONE.gris;
    p.line(b.label, x, yy + 4.6, { size: 8.4, weight: b.strong ? "bold" : "normal", color: b.strong ? C.ink : C.mut });
    p.rrect(x + labW, yy, barW, 6.6, 1.8, C.line);
    const bwid = Math.max(2.2, barW * Math.min(1, b.value / comp.max));
    p.rrect(x + labW, yy, bwid, 6.6, 1.8, col);
    p.line(b.text, x + labW + barW + 2.5, yy + 4.9, { size: 9.2, weight: "bold", color: col });
  });
  return comp.bars.length * 10.5;
}

function radar(p, cx, cy, R, rad) {
  const scale = R / rad.radiusKm;
  p.circle(cx, cy, R, C.bg, C.line, 0.3);
  p.stroke(C.line, 0.25); p.doc.circle(cx, cy, R / 2, "S");
  p.doc.line(cx - R, cy, cx + R, cy); p.doc.line(cx, cy - R, cx, cy + R);
  p.line((rad.radiusKm / 2) + " km", cx + 1.2, cy - R / 2 + 2.6, { size: 5.8, color: C.mut });
  p.line(rad.radiusKm + " km", cx + 1.2, cy - R + 2.6, { size: 5.8, color: C.mut });
  for (const pt of rad.points) {
    if (pt.me) continue;
    const dist = Math.hypot(pt.x, pt.y);
    if (dist > rad.radiusKm) continue;
    const r = 0.9 + 1.7 * Math.sqrt(pt.reviews / rad.top);
    p.circle(cx + pt.x * scale, cy + pt.y * scale, r, C.mut);
  }
  p.circle(cx, cy, 3.1, C.white); p.circle(cx, cy, 2.4, C.azul);
  p.line("USTED", cx, cy + R + 5, { size: 6.6, weight: "bold", color: C.azul, align: "center" });
  p.line("cada punto: un competidor (más grande = más reseñas)", cx, cy + R + 8.6, { size: 5.8, color: C.mut, align: "center" });
}

function chips(p, x, y, w, items) {
  let cx = x, cy = y; const h = 7.4;
  p.font("body", "bold").size(7.8);
  for (const it of items) {
    const [col, weak] = TONE[it.tone] || TONE.azul, tw = p.width(p.clean(it.text)) + 7;
    if (cx + tw > x + w) { cx = x; cy += h + 2.2; }
    p.rrect(cx, cy, tw, h, 2, weak);
    p.line(it.text, cx + 3.5, cy + 5.1, { size: 7.8, weight: "bold", color: col });
    cx += tw + 2.6;
  }
  return cy + h - y;
}

function comparison(f, compact) {
  const p = f.p, m = f.m, M = PAGE.m, comp = m.comparison;
  if (!comp) {
    f.h2("Lo que vimos de su negocio en Google");
    const b = m.business, txt = [b.reviews ? b.reviews + " reseñas" : "todavía sin reseñas", b.rating ? "calificación " + b.rating.toFixed(1) : "", b.website ? "con web propia" : "sin web propia"].filter(Boolean).join(", ") + ".";
    f.y += p.para("Su negocio aparece con " + txt + " Cuando tengamos más negocios de su rubro escaneados en su zona, le mostramos su puesto exacto frente a la competencia.", M, f.y, p.cw, { size: 9.6, color: C.ink });
    f.gap(2);
    return;
  }
  f.h2(comp.title, 40);
  if (!compact) f.y += p.para(comp.note, M, f.y, p.cw, { size: 8.6, color: C.mut }) + 2;
  const hasRadar = !!comp.radar && !compact;
  const R = 19.5, radarW = hasRadar ? R * 2 + 12 : 0, leftW = p.cw - radarW - (hasRadar ? 6 : 0);
  const rowH = compact ? 9 : 10.5, barsH = comp.bars.length * rowH;
  // altura de las fichas (se envuelven en la columna izquierda)
  p.font("body", "bold").size(7.8);
  const chipRows = (() => { let cx = 0, rows = 1; for (const it of comp.chips) { const tw = p.width(p.clean(it.text)) + 7; if (cx + tw > leftW) { cx = 0; rows++; } cx += tw + 2.6; } return rows; })();
  const leftH = barsH + 10 + (compact ? 0 : chipRows * 9.6 + 1);
  const blockH = Math.max(leftH, hasRadar ? R * 2 + 15 : 0);
  f.ensure(blockH + 3);
  const y0 = f.y;
  bars(p, M, y0, leftW, comp, rowH);
  const [gcol] = TONE[comp.rank.grade];
  p.line(comp.rank.label, M, y0 + barsH + 6.5, { kind: "display", size: 12, color: gcol });
  if (!compact) chips(p, M, y0 + barsH + 11, leftW, comp.chips);
  if (hasRadar) radar(p, M + leftW + 6 + radarW / 2 - 6, y0 + R + 1, R, comp.radar);
  f.y = y0 + blockH + 3;
}

function gains(f) {
  const p = f.p, m = f.m, M = PAGE.m, gapW = 4, bw = (p.cw - 2 * gapW) / 3;
  const items = [["TIEMPO", m.gains.time, "azul", "clock"], ["DINERO", m.gains.money, "verde", "coin"], ["TRANQUILIDAD", m.gains.calm, "ambar", "smile"]];
  const th = Math.max(...items.map((it) => p.measure(it[1], bw - 8, 8.4, "body", "normal", 1.28)));
  const h = 19 + th + 2.5;
  f.h2("Lo que gana cada mes", h);
  items.forEach((it, i) => {
    const x = M + i * (bw + gapW), [col, weak] = TONE[it[2]];
    p.rrect(x, f.y, bw, h, 3, weak); p.rrect(x, f.y, bw, 2, 1, col);
    icon(p, it[3], x + bw / 2, f.y + 8, 3.3, col);
    p.line(it[0], x + bw / 2, f.y + 15.2, { kind: "display", size: 9, color: col, align: "center" });
    p.para(it[1], x + 4, f.y + 17, bw - 8, { size: 8.4, lh: 1.28 });
  });
  f.y += h + 1.2;
  f.y += p.para(m.gains.note, M, f.y, p.cw, { size: 7, color: C.mut, lh: 1.15 }) + 1.5;
}

function icon(p, kind, x, y, r, col) {
  const d = p.doc;
  p.stroke(col, 0.55);
  if (kind === "clock") { d.circle(x, y, r, "S"); d.line(x, y, x, y - r * 0.55); d.line(x, y, x + r * 0.45, y + r * 0.22); }
  else if (kind === "coin") { d.circle(x, y, r, "S"); p.line("$", x, y + r * 0.45, { size: r * 2.9, weight: "bold", color: col, align: "center" }); }
  else { d.circle(x, y, r, "S"); p.fill(col); d.circle(x - r * 0.34, y - r * 0.22, 0.32, "F"); d.circle(x + r * 0.34, y - r * 0.22, 0.32, "F"); d.line(x - r * 0.52, y + r * 0.14, x - r * 0.22, y + r * 0.44); d.line(x - r * 0.22, y + r * 0.44, x + r * 0.22, y + r * 0.44); d.line(x + r * 0.22, y + r * 0.44, x + r * 0.52, y + r * 0.14); }
}

function includes(f) {
  const p = f.p, m = f.m, M = PAGE.m, gapW = 6, bw = (p.cw - gapW) / 2;
  const half = Math.ceil(m.includes.length / 2), cols = [m.includes.slice(0, half), m.includes.slice(half)];
  const hs = cols.map((c) => c.reduce((a, t) => a + p.measure(t, bw - 8, 9, "body", "normal", 1.25) + 2, 0));
  f.h2("Qué incluye su sistema", Math.max(...hs));
  cols.forEach((c, ci) => {
    let yy = f.y; const x = M + ci * (bw + gapW);
    for (const t of c) { p.check(x, yy + 1.9, 2.6, C.verde); const h = p.para(t, x + 6.5, yy, bw - 8, { size: 9, lh: 1.25 }); yy += h + 2; }
  });
  f.y += Math.max(...hs) + 2.5;
}

function beforeAfter(f) {
  const p = f.p, m = f.m, M = PAGE.m, gapW = 5, bw = (p.cw - gapW) / 2;
  const rows = m.beforeAfter.map((r) => ({ r, hL: p.measure(r.today, bw - 13, 8.8, "body", "normal", 1.3), hR: p.measure(r.withSystem, bw - 13, 8.8, "body", "normal", 1.3) }));
  const total = 11 + rows.reduce((a, x) => a + 3.4 + Math.max(x.hL, x.hR) + 2, 0);
  f.h2("Cómo trabaja hoy y cómo quedaría con el sistema", total);
  p.rrect(M, f.y, bw, total, 3, C.rojoW); p.rrect(M + bw + gapW, f.y, bw, total, 3, C.verdeW);
  p.rrect(M, f.y, bw, 2, 1, C.rojo); p.rrect(M + bw + gapW, f.y, bw, 2, 1, C.verde);
  p.line("HOY, A MANO", M + 5, f.y + 8.4, { kind: "display", size: 9.5, color: C.rojo });
  p.line("CON EL SISTEMA", M + bw + gapW + 5, f.y + 8.4, { kind: "display", size: 9.5, color: C.verde });
  let yy = f.y + 11;
  for (const x of rows) {
    p.line(x.r.topic.toUpperCase(), M + 9, yy + 2.4, { size: 6.4, weight: "bold", color: C.mut, charSpace: 0.3 });
    p.line(x.r.topic.toUpperCase(), M + bw + gapW + 9, yy + 2.4, { size: 6.4, weight: "bold", color: C.mut, charSpace: 0.3 });
    yy += 3.4;
    p.cross(M + 4.6, yy + 2.2, 2.4, C.rojo); p.check(M + bw + gapW + 4.4, yy + 2.2, 2.5, C.verde);
    p.para(x.r.today, M + 9, yy, bw - 13, { size: 8.8, lh: 1.3 });
    p.para(x.r.withSystem, M + bw + gapW + 9, yy, bw - 13, { size: 8.8, lh: 1.3 });
    yy += Math.max(x.hL, x.hR) + 2;
  }
  f.y += total + 3;
}

function plan(f) {
  const p = f.p, m = f.m, M = PAGE.m, gapW = 4, bw = (p.cw - 2 * gapW) / 3;
  const th = Math.max(...m.plan.map((s) => p.measure(s.body, bw - 8, 8.4, "body", "normal", 1.3)));
  const h = 13.5 + th + 2;
  f.h2("Cómo funciona, en tres pasos", h);
  m.plan.forEach((s, i) => {
    const x = M + i * (bw + gapW);
    p.rrect(x, f.y, bw, h, 3, C.bg, C.line, 0.3);
    p.circle(x + 7, f.y + 7, 4, C.navy);
    p.line(String(s.n), x + 7, f.y + 8.4, { kind: "display", size: 9, color: C.white, align: "center" });
    p.para(s.title, x + 13, f.y + 3.6, bw - 16, { size: 9, weight: "bold", color: C.navy, lh: 1.15 });
    p.para(s.body, x + 4, f.y + 13.5, bw - 8, { size: 8.4, lh: 1.3, color: C.ink });
  });
  f.y += h + 3;
}

function cta(f, compact) {
  const p = f.p, m = f.m, M = PAGE.m, c = m.cta, qrSize = c.qr ? 32 : 0, txtW = p.cw - (c.qr ? qrSize + 22 : 12);
  const h1 = p.measure(c.body, txtW, 9.8, "body", "normal", 1.35), h2 = p.measure(c.steps, txtW, 7.8, "body", "normal", 1.3);
  const h3 = c.contactLine ? p.measure(c.contactLine, txtW, 9.4, "body", "bold", 1.3) : 0;
  const h4 = c.demo ? 6 + p.measure(c.demo, txtW, 7.2, "body", "normal", 1.2) : 0;
  const alto = 13 + h1 + 2.5 + h2 + 2.5 + (h3 ? h3 + 1.5 : 0) + h4 + 6;
  const h = Math.max(alto, c.qr ? qrSize + 17 : 26);
  f.ensure(h + 2);
  p.rrect(M, f.y, p.cw, h, 3.5, C.navy); p.rrect(M, f.y, p.cw, 2.4, 1.2, C.sky);
  let yy = f.y + 12.5;
  p.line(c.headline, M + 7, yy, { kind: "display", size: compact ? 13.5 : 15, color: C.white });
  yy += 5;
  yy += p.para(c.body, M + 7, yy, txtW, { size: 9.8, color: C.white, lh: 1.35 }) + 2.5;
  yy += p.para(c.steps, M + 7, yy, txtW, { size: 7.8, color: [186, 212, 236], lh: 1.3 }) + 2.5;
  if (c.contactLine) yy += p.para(c.contactLine, M + 7, yy, txtW, { size: 9.4, weight: "bold", color: C.white, lh: 1.3 }) + 1.5;
  if (c.demo) {
    p.font("body", "bold").size(9.6).color(C.white);
    try { p.doc.textWithLink(c.demoLabel, M + 7, yy + 3.2, { url: c.demo }); } catch (e) { p.doc.text(c.demoLabel, M + 7, yy + 3.2); }
    const lw = p.width(c.demoLabel);
    p.hline(M + 7, M + 7 + lw, yy + 4.2, C.sky, 0.4);
    p.para(c.demo, M + 7, yy + 5.2, txtW, { size: 7.2, color: [186, 212, 236], lh: 1.2 });
  }
  if (c.qr && f.o.qr) {
    const qx = M + p.cw - qrSize - 8, qy = f.y + (h - qrSize - 6) / 2;
    if (f.o.qr(c.qr.url, qx, qy, qrSize)) {
      try { p.doc.link(qx - 2.5, qy - 2.5, qrSize + 5, qrSize + 5, { url: c.qr.url }); } catch (e) { /* sin enlace */ }
      p.para(c.qr.label, qx - 4, qy + qrSize + 4.5, qrSize + 8, { size: 6.8, weight: "bold", color: C.white, align: "center", lh: 1.15 });
    }
  }
  f.y += h + 3;
}

function insightsBlock(f, max) {
  let items = f.m.insights.slice(0, max);
  if (!items.length) return;
  const hs = items.map((t) => f.p.measure(t, f.p.cw - 7, 9.6, "body", "normal") + 2);
  const avail = f.p.bottom - f.y - 15;
  // Los insights vienen por prioridad: si no caben todos en esta página, se dejan los que sí (mínimo 1).
  let n = 0, acc = 0;
  while (n < items.length && acc + hs[n] <= avail) { acc += hs[n]; n++; }
  if (n === 0) { n = 1; acc = hs[0]; }
  items = items.slice(0, n);
  f.h2("Por qué ahora", Math.min(acc, 60));
  f.bullets(items, "ambar");
  f.gap(0.5);
}

/** Altura estimada de los bloques de la segunda página con la escala actual. */
function secondPageHeight(f) {
  const p = f.p, m = f.m, bw3 = (p.cw - 8) / 3, bw2 = (p.cw - 6) / 2, bwT = (p.cw - 5) / 2;
  const gainsTxt = Math.max(...[m.gains.time, m.gains.money, m.gains.calm].map((t) => p.measure(t, bw3 - 8, 8.4, "body", "normal", 1.28)));
  const gainsH = 19 + gainsTxt + 2.5 + 1.2 + p.measure(m.gains.note, p.cw, 7, "body", "normal", 1.15) + 1.5;
  const half = Math.ceil(m.includes.length / 2);
  const incH = Math.max(...[m.includes.slice(0, half), m.includes.slice(half)].map((c) => c.reduce((a, t) => a + p.measure(t, bw2 - 8, 9, "body", "normal", 1.25) + 2, 0))) + 2.5;
  const tabH = 11 + m.beforeAfter.reduce((a, r) => a + 3.4 + Math.max(p.measure(r.today, bwT - 13, 8.8, "body", "normal", 1.3), p.measure(r.withSystem, bwT - 13, 8.8, "body", "normal", 1.3)) + 2, 0) + 3;
  const planH = 13.5 + Math.max(...m.plan.map((s) => p.measure(s.body, bw3 - 8, 8.4, "body", "normal", 1.3))) + 2 + 3;
  const c = m.cta, qrSize = c.qr ? 32 : 0, txtW = p.cw - (c.qr ? qrSize + 22 : 12);
  const ctaH = Math.max(13 + p.measure(c.body, txtW, 9.8, "body", "normal", 1.35) + 2.5 + p.measure(c.steps, txtW, 7.8, "body", "normal", 1.3) + 2.5 + (c.contactLine ? p.measure(c.contactLine, txtW, 9.4, "body", "bold", 1.3) + 1.5 : 0) + (c.demo ? 6 + p.measure(c.demo, txtW, 7.2, "body", "normal", 1.2) : 0) + 6, c.qr ? qrSize + 17 : 26) + 3;
  const headings = 4 * (14.5 + 4);
  return headings + gainsH + incH + tabH + planH + ctaH;
}

/**
 * Dibuja una propuesta completa (2 páginas) o de una página en el `doc` dado.
 * @param {object} doc jsPDF
 * @param {object} model de buildProposal()
 * @param {{fonts?:{display:string,body:string}, mode?:"full"|"one", qr?:(url,x,y,size)=>boolean, images?:{photo?:{data:string,format:string}}}} opts
 */
function renderProposal(doc, model, opts = {}) {
  const pen = new Pen(doc, opts.fonts);
  const f = new Flow(pen, model, opts);
  const one = opts.mode === "one";
  const hh = one ? 64 : 72;
  header(pen, model, opts, hh, one);
  f.y = hh + 8;
  promise(f, one);
  kpis(f);
  comparison(f, one);
  if (one) {
    insightsBlock(f, 2);
    cta(f, true);
  } else {
    insightsBlock(f, 3);
    if (f.y > 175) { doc.addPage(); pen.page++; f.y = PAGE.m + 4; }
    // Si la segunda página no cabe con la escala normal, se aprieta el interlineado (hasta 12 %)
    const avail = pen.bottom - f.y;
    for (const scale of [1, 0.95, 0.9, 0.88]) { pen.lhScale = scale; if (secondPageHeight(f) <= avail) break; }
    gains(f);
    includes(f);
    beforeAfter(f);
    plan(f);
    cta(f, false);
  }
  footers(pen, model);
  const dense = pen.lhScale < 1;
  pen.lhScale = 1;
  return { pages: pen.page, dense };
}

module.exports = { renderProposal, Pen, Flow, C, TONE, PAGE };

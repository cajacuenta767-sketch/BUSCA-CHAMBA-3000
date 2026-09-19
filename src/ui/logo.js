"use strict";
/**
 * Logo Sky Tech: una sola fuente de verdad, dibujada como lista de primitivas.
 * De aquí salen el SVG (panel, marca/, favicon) y el dibujo vectorial en el PDF (jsPDF),
 * así los tres son exactamente el mismo dibujo.
 *
 * Concepto: una nube (el sistema vive en la nube, se abre desde cualquier celular) atravesada por
 * un rayo (la energía que le pone al negocio). Caja de 48 × 48; legible desde 16 px.
 */
const COLORS = Object.freeze({ navy: "#0B3C68", sky: "#1FA2FF", ink: "#11253A", muted: "#5C7183", white: "#FFFFFF" });

/**
 * Primitivas en la caja 0..48. `role` decide el color según la variante.
 *  - bg: cuadrado redondeado de fondo
 *  - cloud: silueta de nube (unión de círculos y un rectángulo con extremos redondeados)
 *  - bolt: rayo (polígono cerrado, en el borde inferior de la nube)
 */
const SHAPES = Object.freeze([
  { role: "bg", type: "rrect", x: 0, y: 0, w: 48, h: 48, r: 12 },
  { role: "cloud", type: "circle", cx: 16.5, cy: 24.5, r: 6.6 },
  { role: "cloud", type: "circle", cx: 25, cy: 19, r: 9.2 },
  { role: "cloud", type: "circle", cx: 33.6, cy: 24.8, r: 6.2 },
  { role: "cloud", type: "rrect", x: 9.9, y: 24.5, w: 30, h: 8.6, r: 4.3 },
  { role: "bolt", type: "poly", points: [[28.8, 21.2], [18.4, 33.9], [24.6, 33.9], [22.0, 43.6], [33.0, 29.9], [26.9, 29.9]] },
]);

/** Colores por variante: color (fondo marino), onDark (fondo blanco), mono (un solo color, rayo en negativo). */
function palette(variant, mono) {
  if (variant === "onDark") return { bg: COLORS.white, cloud: COLORS.navy, bolt: COLORS.sky };
  if (variant === "mono") { const c = mono || COLORS.navy; return { bg: c, cloud: COLORS.white, bolt: c, boltStroke: COLORS.white }; }
  return { bg: COLORS.navy, cloud: COLORS.white, bolt: COLORS.sky };
}

function shapesSvg(variant, mono) {
  const p = palette(variant, mono);
  return SHAPES.map((s) => {
    const fill = p[s.role];
    if (s.type === "rrect") return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${fill}"/>`;
    if (s.type === "circle") return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}"/>`;
    const d = s.points.map((pt, i) => (i ? "L" : "M") + pt[0] + " " + pt[1]).join(" ") + " Z";
    const stroke = p.boltStroke ? ` stroke="${p.boltStroke}" stroke-width="1.2" stroke-linejoin="round"` : "";
    return `<path d="${d}" fill="${fill}"${stroke}/>`;
  }).join("");
}

/** Isotipo SVG (solo el distintivo). */
function isotypeSvg({ size = 48, variant = "color", mono, title = "Sky Tech", attrs = "" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="${title}"${attrs ? " " + attrs : ""}><title>${title}</title>${shapesSvg(variant, mono)}</svg>`;
}

/** Logo horizontal: isotipo + SKY TECH + lema. Tipografía Sora (con respaldo del sistema). */
function logoSvg({ height = 56, variant = "color", mono, tagline = "SISTEMAS DE GESTIÓN PARA NEGOCIOS" } = {}) {
  const onDark = variant === "onDark";
  const sky = onDark ? COLORS.sky : COLORS.sky, navy = onDark ? COLORS.white : COLORS.navy, mut = onDark ? "#B8D0E6" : COLORS.muted;
  const c1 = mono ? mono : navy, c2 = mono ? mono : sky;
  const font = "Sora,'IBM Plex Sans',Helvetica,Arial,sans-serif";
  const W = 300, H = 56, s = H / 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * (height / H))}" height="${height}" role="img" aria-label="Sky Tech"><title>Sky Tech</title>` +
    `<g transform="translate(4,4)">${shapesSvg(variant, mono)}</g>` +
    `<text x="62" y="31" font-family="${font}" font-size="21" font-weight="700" fill="${c1}" letter-spacing="1.5">SKY</text>` +
    `<text x="111" y="31" font-family="${font}" font-size="21" font-weight="700" fill="${c2}" letter-spacing="1.5">TECH</text>` +
    (tagline ? `<text x="62" y="45" font-family="${font}" font-size="7.6" font-weight="600" fill="${mut}" letter-spacing="1.6">${tagline}</text>` : "") +
    `</svg>`;
}

/** Logo apilado (isotipo arriba, nombre debajo) para avatares cuadrados y sellos. */
function stackedSvg({ size = 160, variant = "color", mono } = {}) {
  const onDark = variant === "onDark";
  const c1 = mono || (onDark ? COLORS.white : COLORS.navy), c2 = mono || COLORS.sky;
  const font = "Sora,'IBM Plex Sans',Helvetica,Arial,sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Sky Tech"><title>Sky Tech</title>` +
    `<g transform="translate(36,10)">${shapesSvg(variant, mono)}</g>` +
    `<text x="60" y="86" text-anchor="middle" font-family="${font}" font-size="17" font-weight="700" letter-spacing="1.5"><tspan fill="${c1}">SKY </tspan><tspan fill="${c2}">TECH</tspan></text>` +
    `<text x="60" y="102" text-anchor="middle" font-family="${font}" font-size="6.2" font-weight="600" fill="${onDark ? "#B8D0E6" : COLORS.muted}" letter-spacing="1.4">SISTEMAS DE GESTIÓN</text></svg>`;
}

function hexToRgb(hex) { const h = hex.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }

/**
 * Dibuja el isotipo en jsPDF con las MISMAS primitivas (mm). `variant` como en el SVG.
 * @param {object} doc jsPDF
 */
function drawIsotypePdf(doc, x, y, size, { variant = "color", mono } = {}) {
  const p = palette(variant, mono), k = size / 48;
  for (const s of SHAPES) {
    const fill = hexToRgb(p[s.role]);
    doc.setFillColor(fill[0], fill[1], fill[2]);
    if (s.type === "rrect") doc.roundedRect(x + s.x * k, y + s.y * k, s.w * k, s.h * k, s.r * k, s.r * k, "F");
    else if (s.type === "circle") doc.circle(x + s.cx * k, y + s.cy * k, s.r * k, "F");
    else {
      const pts = s.points.map((pt) => [x + pt[0] * k, y + pt[1] * k]);
      const segs = pts.slice(1).map((pt, i) => [pt[0] - pts[i][0], pt[1] - pts[i][1]]);
      if (p.boltStroke) { const st = hexToRgb(p.boltStroke); doc.setDrawColor(st[0], st[1], st[2]); doc.setLineWidth(1.2 * k); doc.setLineJoin("round"); }
      doc.lines(segs, pts[0][0], pts[0][1], [1, 1], p.boltStroke ? "FD" : "F", true);
    }
  }
}

/** Wordmark en jsPDF. Usa la fuente `font` (p. ej. "Sora") si está cargada; si no, Helvetica bold. */
function drawWordmarkPdf(doc, x, baseline, size, { variant = "color", font = "helvetica" } = {}) {
  const onDark = variant === "onDark";
  const c1 = onDark ? [255, 255, 255] : hexToRgb(COLORS.navy), c2 = hexToRgb(COLORS.sky);
  const setFont = () => { try { doc.setFont(font, "bold"); } catch (e) { doc.setFont("helvetica", "bold"); } };
  setFont(); doc.setFontSize(size);
  doc.setTextColor(c1[0], c1[1], c1[2]); doc.text("SKY", x, baseline, { charSpace: size * 0.06 });
  const w = doc.getTextWidth("SKY") + size * 0.22;
  doc.setTextColor(c2[0], c2[1], c2[2]); doc.text("TECH", x + w, baseline, { charSpace: size * 0.06 });
  return w + doc.getTextWidth("TECH") + size * 0.18;
}

const faviconDataUri = () => "data:image/svg+xml," + encodeURIComponent(isotypeSvg({ size: 64 }));

module.exports = { COLORS, SHAPES, palette, isotypeSvg, logoSvg, stackedSvg, drawIsotypePdf, drawWordmarkPdf, faviconDataUri, hexToRgb };

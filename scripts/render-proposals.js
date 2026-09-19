#!/usr/bin/env node
"use strict";
/**
 * Genera propuestas de muestra en PDF y HTML con datos fijos (para revisión visual).
 * Necesita el build de jsPDF para Node (no se versiona): JSPDF_NODE=/ruta/jspdf.node.min.js
 * Uso: JSPDF_NODE=... node scripts/render-proposals.js <carpeta-salida>
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const I = require("../src/domain/insights");
const M = require("../src/ui/proposal-model");
const P = require("../src/ui/proposal-pdf");
const H = require("../src/ui/proposal-html");

const out = path.resolve(process.argv[2] || "propuestas-muestra");
fs.mkdirSync(out, { recursive: true });
const ROOT = path.resolve(__dirname, "..");

// QR: la librería incrustada en dashboard.html (UMD) se carga en un contexto propio.
function loadQr() {
  const html = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
  const m = html.match(/<script>(var qrcode=function\(\)[\s\S]*?)<\/script>/);
  if (!m) return null;
  const ctx = { module: { exports: {} }, exports: {} }; ctx.exports = ctx.module.exports;
  vm.createContext(ctx); vm.runInContext(m[1], ctx);
  return ctx.module.exports || ctx.qrcode;
}
const qrcode = loadQr();
function drawQR(doc, url, x, y, size) {
  if (!qrcode) return false;
  const q = qrcode(0, "M"); q.addData(url); q.make();
  const n = q.getModuleCount(), c = size / n;
  doc.setFillColor(255, 255, 255); doc.roundedRect(x - 2.5, y - 2.5, size + 5, size + 5, 1.5, 1.5, "F");
  doc.setFillColor(22, 24, 38);
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) doc.rect(x + k * c, y + r * c, c + 0.02, c + 0.02, "F");
  return true;
}
const qrSvg = (url) => { if (!qrcode) return ""; const q = qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };

// Fuentes de marca
function fontsFor(jsPDF) {
  const dir = path.join(ROOT, "public", "fonts");
  const files = [["Sora-Bold.ttf", "Sora", "bold"], ["IBMPlexSans-Regular.ttf", "IBMPlexSans", "normal"], ["IBMPlexSans-SemiBold.ttf", "IBMPlexSans", "bold"]];
  if (!files.every((f) => fs.existsSync(path.join(dir, f[0])))) return { display: "helvetica", body: "helvetica" };
  jsPDF.API.events.push(["addFonts", function () { for (const f of files) { this.addFileToVFS(f[0], fs.readFileSync(path.join(dir, f[0])).toString("base64")); this.addFont(f[0], f[1], f[2]); } }]);
  return { display: "Sora", body: "IBMPlexSans" };
}

// Datos fijos: una zona con 9 farmacias + casos límite
let seq = 0;
const mk = (o) => Object.assign({ place_id: "p" + (++seq), title: "Botica " + ["San Martín", "Central", "Los Andes", "El Sol", "Perú", "Miraflores", "Norte", "Express", "Salud Total"][seq - 1], category: "Farmacia", city: "Cusco", address: "Av. El Sol " + (100 + seq * 37) + ", Cusco", website: seq % 3 ? "" : "https://botica" + seq + ".pe", social: seq % 2 ? { fb: "https://facebook.com/b" + seq } : {}, phone: "+51 98" + (7000000 + seq * 1234), rating: [4.7, 4.1, 3.9, 4.5, 4.3, 4.9, 4.0, 3.6, 4.4][seq - 1], reviews: [420, 88, 35, 150, 61, 9, 112, 20, 240][seq - 1], lat: -13.5226 + (seq % 3) * 0.006, lon: -71.9673 + Math.floor(seq / 3) * 0.007 }, o);
const zone = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => mk());
const cases = [
  ["lider", zone[0]],
  ["nuevo-bien-calificado", zone[5]],
  ["medio", zone[4]],
  ["sin-rubro-conocido", mk({ title: "Espacio Coworking Qosqo", category: "Espacio de coworking", reviews: 14, rating: 4.6 })],
  ["nombre-largo", Object.assign({}, zone[3], { title: "Farmacia y Perfumería Nuestra Señora de la Asunción del Valle Sagrado S.A.C." })],
];
const ctxBase = { sender: "Bryan Salirrosas", contact: "+51 999 999 999 · bryan@skytech.pe", demo: "https://demo.skytech.pe", now: new Date("2026-09-19T12:00:00Z") };
const models = cases.map(([name, lead]) => [name, M.buildProposal(lead, Object.assign({ analysis: I.analyze(lead, zone.concat([lead])) }, ctxBase))]);
models.push(["sin-contacto", M.buildProposal(zone[1], Object.assign({ analysis: I.analyze(zone[1], zone) }, ctxBase, { contact: "", demo: "" }))]);

fs.writeFileSync(path.join(out, "propuestas.html"), H.renderProposalHtml(models.map((x) => x[1]), { qrSvg, fontsHref: "" }));
const jsPdfPath = process.env.JSPDF_NODE;
if (jsPdfPath && fs.existsSync(jsPdfPath)) {
  const { jsPDF } = require(jsPdfPath);
  const fonts = fontsFor(jsPDF);
  for (const [name, model] of models) {
    for (const mode of ["full", "one"]) {
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const r = P.renderProposal(doc, model, { fonts, mode, qr: (u, x, y, s) => drawQR(doc, u, x, y, s) });
      fs.writeFileSync(path.join(out, `${name}-${mode}.pdf`), Buffer.from(doc.output("arraybuffer")));
      console.log(`${name}-${mode}.pdf: ${r.pages} pág.`);
    }
  }
} else console.log("Sin JSPDF_NODE: solo se generó propuestas.html");
console.log("Salida en " + out);

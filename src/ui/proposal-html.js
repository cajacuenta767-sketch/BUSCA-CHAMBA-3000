"use strict";
/**
 * Renderizador HTML de la propuesta (para imprimir / "Guardar como PDF" cuando no carga jsPDF,
 * y para las pruebas visuales). Consume el MISMO modelo que el PDF, así nunca dicen cosas distintas.
 */
const Logo = require("./logo");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TONE = { azul: ["#1D4ED8", "#E5ECFC"], ambar: ["#B7791F", "#FAF1E1"], verde: ["#0E9F6E", "#E0F6EE"], rojo: ["#D92D20", "#FDE8E6"], gris: ["#5C7183", "#ECF0F5"], navy: ["#0B3C68", "#E8F0F9"] };

function radarSvg(rad) {
  if (!rad) return "";
  const R = 60, s = R / rad.radiusKm, cx = 70, cy = 70;
  const dots = rad.points.filter((p) => !p.me && Math.hypot(p.x, p.y) <= rad.radiusKm).map((p) => `<circle cx="${(cx + p.x * s).toFixed(1)}" cy="${(cy + p.y * s).toFixed(1)}" r="${(2.4 + 4.5 * Math.sqrt(p.reviews / rad.top)).toFixed(1)}" fill="#5C7183"/>`).join("");
  return `<svg class="radar" viewBox="0 0 140 150" width="140" height="150" role="img" aria-label="Competidores a ${rad.radiusKm} km"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#F4F7FB" stroke="#D7E2EE"/><circle cx="${cx}" cy="${cy}" r="${R / 2}" fill="none" stroke="#D7E2EE"/><line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="#D7E2EE"/><line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="#D7E2EE"/>${dots}<circle cx="${cx}" cy="${cy}" r="8" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="6" fill="#1D4ED8"/><text x="${cx + R / 2 + 2}" y="${cy - 3}" font-size="7" fill="#5C7183">${rad.radiusKm / 2} km</text><text x="${cx + R - 16}" y="${cy - 3}" font-size="7" fill="#5C7183">${rad.radiusKm} km</text><text x="${cx}" y="142" text-anchor="middle" font-size="8" font-weight="700" fill="#1D4ED8">USTED</text></svg>`;
}

function article(m, o) {
  const b = m.business, c = m.comparison, k = m.cover.kpis;
  const chip = (it) => `<span class="ch" style="color:${TONE[it.tone][0]};background:${TONE[it.tone][1]}">${esc(it.text)}</span>`;
  const bar = (x) => `<div class="brow"><span class="blab${x.strong ? " strong" : ""}">${esc(x.label)}</span><span class="btrack"><i style="width:${Math.max(1.5, 100 * Math.min(1, x.value / c.max)).toFixed(1)}%;background:${TONE[x.tone][0]}"></i></span><b style="color:${TONE[x.tone][0]}">${esc(x.text)}</b></div>`;
  const photo = b.thumb && o.photos !== false ? `<img class="photo" src="${esc(b.thumb)}" alt="" onerror="this.remove()">` : "";
  const qr = m.cta.qr && o.qrSvg ? o.qrSvg(m.cta.qr.url) : "";
  return `<article>
  <header><div class="hlogo">${Logo.isotypeSvg({ size: 34, variant: "onDark" })}<div><b>SKY <i>TECH</i></b><span>SISTEMAS DE GESTIÓN PARA NEGOCIOS</span></div></div>
    <div class="hrow"><div><div class="k">${esc(m.cover.kicker)}</div><h1>${esc(m.cover.title)}</h1><div class="sub">${esc(m.cover.subtitle)}</div></div>${photo}</div></header>
  <div class="promise"><b>${esc(m.cover.promise.headline)}</b><p>${esc(m.cover.promise.body)}</p></div>
  <div class="kpis">${k.map((x) => `<div class="kpi" style="background:${TONE[x.tone][1]};border-top-color:${TONE[x.tone][0]}"><b style="color:${TONE[x.tone][0]}">${esc(x.value)}</b><span>${esc(x.label)}</span></div>`).join("")}</div>
  ${c ? `<h2>${esc(c.title)}</h2><p class="mut">${esc(c.note)}</p>
  <div class="cmp"><div class="bars">${c.bars.map(bar).join("")}<p class="rank" style="color:${TONE[c.rank.grade][0]}">${esc(c.rank.label)}</p></div>${radarSvg(c.radar)}</div>
  <div class="chips">${c.chips.map(chip).join("")}</div>` : `<h2>Lo que vimos de su negocio en Google</h2><p>Su negocio aparece con ${b.reviews ? b.reviews + " reseñas" : "todavía sin reseñas"}${b.rating ? ", calificación " + b.rating.toFixed(1) : ""}, ${b.website ? "con" : "sin"} web propia. Cuando tengamos más negocios de su rubro escaneados en su zona, le mostramos su puesto exacto frente a la competencia.</p>`}
  ${m.insights.length ? `<h2>Por qué ahora</h2><ul class="why">${m.insights.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
  ${o.mode === "one" ? "" : `<h2>Lo que gana cada mes</h2>
  <div class="gain"><div class="g" style="background:${TONE.azul[1]};border-top-color:${TONE.azul[0]}"><b style="color:${TONE.azul[0]}">TIEMPO</b><span>${esc(m.gains.time)}</span></div><div class="g" style="background:${TONE.verde[1]};border-top-color:${TONE.verde[0]}"><b style="color:${TONE.verde[0]}">DINERO</b><span>${esc(m.gains.money)}</span></div><div class="g" style="background:${TONE.ambar[1]};border-top-color:${TONE.ambar[0]}"><b style="color:${TONE.ambar[0]}">TRANQUILIDAD</b><span>${esc(m.gains.calm)}</span></div></div>
  <p class="mut tiny">${esc(m.gains.note)}</p>
  <h2>Qué incluye su sistema</h2><ul class="check">${m.includes.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
  <h2>Cómo trabaja hoy y cómo quedaría con el sistema</h2>
  <div class="bacols"><div class="bahead red">HOY, A MANO</div><div class="bahead green">CON EL SISTEMA</div>${m.beforeAfter.map((r) => `<div class="ba"><div class="hoy"><small>${esc(r.topic)}</small><s>✕</s>${esc(r.today)}</div><div class="sis"><small>${esc(r.topic)}</small><s>✓</s>${esc(r.withSystem)}</div></div>`).join("")}</div>
  <h2>Cómo funciona, en tres pasos</h2><div class="plan">${m.plan.map((s) => `<div class="step"><i>${s.n}</i><b>${esc(s.title)}</b><span>${esc(s.body)}</span></div>`).join("")}</div>`}
  <div class="cta"><div class="ctatxt"><b>${esc(m.cta.headline)}</b><p>${esc(m.cta.body)}</p><p class="pasos">${esc(m.cta.steps)}</p>${m.cta.contactLine ? `<p class="firma">${esc(m.cta.contactLine)}</p>` : ""}${m.cta.demo ? `<p><a class="lnk" href="${esc(m.cta.demo)}">${esc(m.cta.demoLabel)}</a><br><span class="tiny">${esc(m.cta.demo)}</span></p>` : ""}</div>${qr ? `<div class="qr"><a href="${esc(m.cta.qr.url)}">${qr}</a><span>${esc(m.cta.qr.label)}</span></div>` : ""}</div>
  <footer>${Logo.isotypeSvg({ size: 14 })}<span>Sky Tech · Propuesta ${esc(m.meta.folio)} · válida hasta ${esc(m.meta.validUntil)}</span></footer>
</article>`;
}

const CSS = `
*{box-sizing:border-box}body{font:13px/1.5 'IBM Plex Sans',-apple-system,Segoe UI,Roboto,sans-serif;color:#11253A;margin:0;background:#EEF3F8}
h1,h2,.kpi b,.promise b,.cta b,.rank,.step b,.bahead{font-family:Sora,'IBM Plex Sans',-apple-system,Segoe UI,sans-serif}
article{max-width:780px;margin:0 auto 24px;background:#fff;padding-bottom:18px}article+article{page-break-before:always}
header{background:#0B3C68;color:#fff;padding:18px 26px 22px;border-bottom:4px solid #1FA2FF;position:relative;overflow:hidden}
.hlogo{display:flex;align-items:center;gap:9px;margin-bottom:16px}.hlogo svg{display:block;border-radius:8px}
.hlogo b{font-size:15px;letter-spacing:1px;font-weight:800}.hlogo b i{font-style:normal;color:#1FA2FF}.hlogo span{font-size:8.5px;letter-spacing:1.4px;color:#9FC4E4;display:block}
.hrow{display:flex;justify-content:space-between;align-items:flex-end;gap:18px}
header .k{font-size:10px;letter-spacing:1.6px;color:#9FC4E4;font-weight:700}header h1{margin:4px 0 4px;font-size:27px;line-height:1.15}header .sub{font-size:12px;color:#BED4EC}
.photo{width:120px;height:120px;object-fit:cover;border-radius:10px;border:3px solid #fff;flex:none}
.promise{margin:18px 26px 12px;background:#E8F0F9;border-left:4px solid #0B3C68;border-radius:0 10px 10px 0;padding:12px 16px}
.promise b{font-size:17px;color:#0B3C68;display:block;margin-bottom:4px}.promise p{margin:0;font-size:13.5px}
.kpis{display:flex;gap:10px;margin:0 26px 14px}.kpi{flex:1;border-radius:9px;border-top:4px solid;padding:10px 12px}.kpi b{font-size:22px;display:block}.kpi span{font-size:11px;color:#5C7183}
h2{color:#0B3C68;margin:18px 26px 8px;font-size:15px;padding:0 0 6px 10px;border-left:4px solid #1FA2FF;border-bottom:1px solid #D7E2EE}
p{margin:0 26px 8px}.mut{color:#5C7183}.tiny{font-size:11px}
.cmp{display:flex;gap:16px;margin:8px 26px;align-items:flex-start}.bars{flex:1}
.brow{display:flex;align-items:center;gap:8px;margin:6px 0}.blab{width:132px;flex:none;font-size:12px;color:#6a758c}.blab.strong{color:#20233a;font-weight:700}
.btrack{flex:1;height:9px;background:#e4e7f2;border-radius:5px;overflow:hidden}.btrack i{display:block;height:100%;border-radius:5px}
.brow b{width:44px;text-align:right;font-size:12px}.rank{font-size:16px;font-weight:700;margin:10px 0 0}
.radar{flex:none}
.chips{margin:4px 26px 8px;display:flex;flex-wrap:wrap;gap:6px}.ch{font-size:11.5px;font-weight:700;border-radius:6px;padding:4px 9px}
ul.why{margin:0 26px 8px;padding-left:18px}ul.why li{margin:5px 0;font-size:12.5px}
.gain{display:flex;gap:10px;margin:8px 26px}.g{flex:1;border-radius:9px;padding:13px;border-top:4px solid}.g b{display:block;text-align:center;font-size:12.5px;margin-bottom:6px}.g span{font-size:12px}
ul.check{list-style:none;margin:0 26px 10px;padding:0;columns:2;column-gap:22px}ul.check li{break-inside:avoid;padding-left:20px;position:relative;margin:4px 0;font-size:12.5px}ul.check li:before{content:"✓";position:absolute;left:0;color:#0E9F6E;font-weight:700}
.bacols{margin:8px 26px;display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
.bahead{font-weight:700;font-size:12.5px;padding:8px 12px;border-radius:9px 9px 0 0}
.bahead.red{background:#FDE8E6;color:#D92D20;border-top:4px solid #D92D20}.bahead.green{background:#E0F6EE;color:#0E9F6E;border-top:4px solid #0E9F6E}
.ba{display:contents}.ba .hoy,.ba .sis{font-size:12px;padding:7px 12px}.ba .hoy{background:#FDE8E6}.ba .sis{background:#E0F6EE}
.ba:last-child .hoy,.ba:last-child .sis{border-radius:0 0 9px 9px}
.ba small{display:block;font-size:9.5px;letter-spacing:.6px;color:#5C7183;font-weight:700}.ba s{text-decoration:none;font-weight:700;margin-right:6px}.ba .hoy s{color:#D92D20}.ba .sis s{color:#0E9F6E}
.plan{display:flex;gap:10px;margin:8px 26px}.step{flex:1;background:#F4F7FB;border:1px solid #D7E2EE;border-radius:9px;padding:12px}.step i{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#0B3C68;color:#fff;font-style:normal;font-weight:700;margin-bottom:6px}.step b{display:block;color:#0B3C68;font-size:12.5px}.step span{font-size:12px}
.cta{background:#0B3C68;color:#fff;margin:16px 26px 0;padding:16px 18px;border-radius:11px;border-top:5px solid #1FA2FF;display:flex;gap:16px;align-items:center}
.ctatxt{flex:1}.cta b{font-size:18px;display:block;margin-bottom:6px}.cta p{margin:0 0 6px;font-size:12.5px}.cta .pasos{font-size:11px;color:#BAD4EC}.cta .firma{font-weight:700;font-size:13px}.cta .lnk{color:#fff;font-weight:700}
.qr{flex:none;width:118px;text-align:center}.qr svg{width:112px;height:112px;background:#fff;padding:5px;border-radius:7px;display:block}.qr span{font-size:10.5px;font-weight:700;display:block;margin-top:5px}
footer{display:flex;align-items:center;gap:8px;margin:14px 26px 0;padding-top:8px;border-top:1px solid #D7E2EE;font-size:10.5px;color:#5C7183}footer svg{border-radius:4px}
@media(max-width:620px){.kpis,.gain,.cta,.plan,.cmp{flex-direction:column}.bacols{grid-template-columns:1fr}ul.check{columns:1}.hrow{flex-direction:column;align-items:flex-start}}
@media print{body{background:#fff}article{margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

/**
 * @param {object[]} models de buildProposal()
 * @param {{qrSvg?:(url:string)=>string, mode?:"full"|"one", autoprint?:boolean, photos?:boolean, fontsHref?:string}} o
 */
function renderProposalHtml(models, o = {}) {
  const fonts = o.fontsHref === undefined ? '<link href="https://fonts.googleapis.com/css2?family=Sora:wght@700&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">' : (o.fontsHref ? `<link href="${esc(o.fontsHref)}" rel="stylesheet">` : "");
  const print = o.autoprint ? "<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>" : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Propuesta</title>${fonts}<style>${CSS}</style></head><body>${models.map((m) => article(m, o)).join("")}${print}</body></html>`;
}

module.exports = { renderProposalHtml, radarSvg, CSS };

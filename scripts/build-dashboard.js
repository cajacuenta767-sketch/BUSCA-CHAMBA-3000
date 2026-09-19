#!/usr/bin/env node
"use strict";
/**
 * Construye dashboard.html a partir de sí mismo: entre los marcadores
 *   <!-- @bundle:start --> … <!-- @bundle:end -->   inyecta los módulos CommonJS de src/ (mini-bundler)
 *   <!-- @css:start --> … <!-- @css:end -->         inyecta src/ui/dashboard.css
 * El resultado se versiona (el panel sigue funcionando con doble clic, sin servidor ni build).
 * Uso: node scripts/build-dashboard.js [--check]   (--check: falla si el archivo cambiaría)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "dashboard.html");
/** Módulos que el panel comparte con el backend. El nombre es el basename sin .js. */
const MODULES = ["src/domain/lead.js", "src/domain/taxonomy.js", "src/domain/insights.js", "src/domain/messages.js", "src/ui/proposal-model.js", "src/ui/proposal-pdf.js", "src/ui/logo.js"];
const CSS = "src/ui/dashboard.css";

function bundle() {
  const parts = [];
  parts.push('/* Generado por scripts/build-dashboard.js — NO editar aquí: edita src/ y ejecuta `npm run build`. */');
  parts.push('window.SkyLib=(function(){var defs={},cache={};function req(n){n=String(n).replace(/^.*\\//,"").replace(/\\.js$/,"");if(cache[n])return cache[n].exports;if(!defs[n])throw new Error("SkyLib: módulo no incluido: "+n);var m={exports:{}};cache[n]=m;defs[n](m,m.exports,req);return m.exports;}');
  for (const rel of MODULES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const name = path.basename(rel, ".js");
    const src = fs.readFileSync(file, "utf8").replace(/<\/script/gi, "<\\/script");
    parts.push(`defs[${JSON.stringify(name)}]=function(module,exports,require){\n${src}\n};`);
  }
  parts.push('return {require:req,has:function(n){return !!defs[n];}};})();');
  return "<script>\n" + parts.join("\n") + "\n</script>";
}

function replaceBetween(html, start, end, content) {
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error("Marcadores no encontrados: " + start);
  return html.slice(0, a + start.length) + "\n" + content + "\n" + html.slice(b);
}

function build() {
  let html = fs.readFileSync(HTML, "utf8");
  html = replaceBetween(html, "<!-- @bundle:start -->", "<!-- @bundle:end -->", bundle());
  const cssFile = path.join(ROOT, CSS);
  if (fs.existsSync(cssFile)) html = replaceBetween(html, "<!-- @css:start -->", "<!-- @css:end -->", "<style>\n" + fs.readFileSync(cssFile, "utf8").trim() + "\n</style>");
  return html;
}

const out = build();
const current = fs.readFileSync(HTML, "utf8");
if (process.argv.includes("--check")) {
  if (out !== current) { console.error("dashboard.html no está actualizado: ejecuta `npm run build` y vuelve a commitear."); process.exit(1); }
  console.log("dashboard.html está al día.");
} else {
  fs.writeFileSync(HTML, out);
  console.log(`dashboard.html generado (${(out.length / 1024).toFixed(0)} KB)`);
}

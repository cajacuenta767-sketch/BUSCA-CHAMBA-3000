"use strict";
/** El panel es un solo archivo generado: aquí se comprueba que está al día, que el bundle carga y que el script principal compila. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const HTML = path.resolve(__dirname, "..", "dashboard.html");
const html = fs.readFileSync(HTML, "utf8");

test("dashboard.html está generado con el build actual (npm run build)", () => {
  const out = execFileSync(process.execPath, [path.resolve(__dirname, "..", "scripts", "build-dashboard.js"), "--check"], { encoding: "utf8" });
  assert.match(out, /al día/);
});

test("el bundle de módulos compartidos carga en un contexto de navegador", () => {
  const a = html.indexOf("<!-- @bundle:start -->"), b = html.indexOf("<!-- @bundle:end -->");
  assert.ok(a > 0 && b > a);
  const js = html.slice(a, b).replace(/<!--.*?-->/g, "").replace(/<\/?script>/g, "");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  const lib = ctx.window.SkyLib;
  assert.equal(lib.require("taxonomy").normalizeCategory("botica"), "Farmacia / Botica");
  assert.equal(typeof lib.require("insights").analyze, "function");
  assert.equal(lib.require("lead").isOwnWebsite("https://x.pe"), true);
});

test("el script principal del panel compila", () => {
  const start = "<!-- @bundle:end -->\n<script>\n";
  const i = html.indexOf(start) + start.length, j = html.lastIndexOf("</script>");
  assert.ok(i > start.length && j > i);
  assert.doesNotThrow(() => new Function(html.slice(i, j)));
});

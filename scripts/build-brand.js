#!/usr/bin/env node
"use strict";
/** Regenera marca/*.svg desde src/ui/logo.js (única fuente de verdad del logo). */
const fs = require("fs");
const path = require("path");
const L = require("../src/ui/logo");
const OUT = path.resolve(__dirname, "..", "marca");
fs.mkdirSync(OUT, { recursive: true });
const files = {
  "skytech-isotipo.svg": L.isotypeSvg({ size: 48 }),
  "skytech-isotipo-blanco.svg": L.isotypeSvg({ size: 48, variant: "onDark" }),
  "skytech-isotipo-mono.svg": L.isotypeSvg({ size: 48, variant: "mono" }),
  "skytech-logo.svg": L.logoSvg({ height: 56 }),
  "skytech-logo-blanco.svg": L.logoSvg({ height: 56, variant: "onDark" }),
  "skytech-logo-mono.svg": L.logoSvg({ height: 56, mono: L.COLORS.navy, variant: "mono" }),
  "skytech-apilado.svg": L.stackedSvg({ size: 160 }),
  "skytech-apilado-blanco.svg": L.stackedSvg({ size: 160, variant: "onDark" }),
  "favicon.svg": L.isotypeSvg({ size: 64 }),
};
for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), svg + "\n");
console.log("marca/: " + Object.keys(files).length + " archivos generados desde src/ui/logo.js");

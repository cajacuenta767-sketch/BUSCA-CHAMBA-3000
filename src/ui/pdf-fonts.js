"use strict";
/**
 * Carga las fuentes de marca en jsPDF (Sora Bold, IBM Plex Sans Regular/SemiBold) desde
 * /public/fonts cuando el panel corre con servidor. Sin servidor (doble clic) o sin red, el PDF
 * usa Helvetica y no falla. Solo navegador; en Node no hace nada.
 */
const FILES = [
  { file: "Sora-Bold.ttf", name: "Sora", style: "bold" },
  { file: "IBMPlexSans-Regular.ttf", name: "IBMPlexSans", style: "normal" },
  { file: "IBMPlexSans-SemiBold.ttf", name: "IBMPlexSans", style: "bold" },
];
let state = { status: "idle", promise: null, fonts: null };

function toBase64(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Devuelve {display, body} con los nombres a usar en jsPDF (o Helvetica si no se pudieron cargar). */
function load(base = "public/fonts/") {
  if (state.promise) return state.promise;
  const fallback = { display: "helvetica", body: "helvetica" };
  if (typeof window === "undefined" || typeof fetch !== "function" || !(window.jspdf && window.jspdf.jsPDF)) { state = { status: "fallback", promise: Promise.resolve(fallback), fonts: fallback }; return state.promise; }
  if (window.location && window.location.protocol === "file:") { state = { status: "fallback", promise: Promise.resolve(fallback), fonts: fallback }; return state.promise; }
  state.status = "loading";
  state.promise = Promise.all(FILES.map((f) => fetch(base + f.file, { cache: "force-cache" }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then((b) => Object.assign({ b64: toBase64(b) }, f))))
    .then((loaded) => {
      const API = window.jspdf.jsPDF.API;
      API.events.push(["addFonts", function () { for (const f of loaded) { this.addFileToVFS(f.file, f.b64); this.addFont(f.file, f.name, f.style); } }]);
      state.fonts = { display: "Sora", body: "IBMPlexSans" }; state.status = "ready";
      return state.fonts;
    })
    .catch(() => { state.fonts = fallback; state.status = "fallback"; return fallback; });
  return state.promise;
}

module.exports = { load, FILES, status: () => state.status };

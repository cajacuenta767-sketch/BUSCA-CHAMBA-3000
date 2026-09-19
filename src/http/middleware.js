"use strict";
const crypto = require("crypto");

const CORS = { "Access-Control-Allow-Origin": "*" };

function sendJson(res, obj, code = 200) {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS));
  res.end(JSON.stringify(obj));
}

function sendText(res, text, code = 200, type = "text/plain; charset=utf-8") {
  res.writeHead(code, Object.assign({ "Content-Type": type }, CORS));
  res.end(text);
}

/** Lee el cuerpo como JSON con tope de tamaño. Cuerpo inválido → {} (compatibilidad con el panel). */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0, overflow = false; const chunks = [];
    req.on("data", (d) => {
      size += d.length;
      if (overflow) return;
      if (size > maxBytes) { overflow = true; chunks.length = 0; return; } // se sigue drenando para responder limpio
      chunks.push(d);
    });
    req.on("end", () => {
      if (overflow) return reject(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { resolve({}); }
    });
    req.on("error", reject);
  });
}

/** Basic Auth opcional (BASIC_AUTH="usuario:clave"), con comparación en tiempo constante. */
function makeAuth(credential) {
  if (!credential) return () => true;
  const expected = Buffer.from(credential);
  return (req, res) => {
    const h = req.headers.authorization || "";
    let ok = false;
    if (h.startsWith("Basic ")) {
      const given = Buffer.from(h.slice(6), "base64");
      ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    }
    if (!ok) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="BUSCA-CHAMBA-3000"' }); res.end("Autenticación requerida"); }
    return ok;
  };
}

function handlePreflight(req, res) {
  if (req.method !== "OPTIONS") return false;
  res.writeHead(204, Object.assign({ "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" }, CORS));
  res.end();
  return true;
}

module.exports = { sendJson, sendText, readJsonBody, makeAuth, handlePreflight, CORS };

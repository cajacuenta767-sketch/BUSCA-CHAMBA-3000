"use strict";
/** Parser CSV RFC-4180 (comillas, comillas escapadas, CRLF). Devuelve filas como arrays de strings. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Separa el texto en [filas completas, resto]: corta en el último salto de línea que está
 * FUERA de comillas, así una fila a medio escribir (o con saltos dentro de un campo entrecomillado)
 * se conserva para la siguiente lectura. Permite parsear solo lo nuevo de un CSV que crece.
 */
function splitCompleteRows(text) {
  let quoted = false, cut = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === "\n" && !quoted) cut = i;
  }
  return cut < 0 ? ["", text] : [text.slice(0, cut + 1), text.slice(cut + 1)];
}

module.exports = { parseCSV, splitCompleteRows };

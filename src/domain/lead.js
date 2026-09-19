"use strict";
/**
 * Dominio "Lead": normalización de una fila del scraper a un negocio,
 * identidad (dedupe), correos, redes sociales y descripción.
 * Todo puro: sin I/O.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAIL_JUNK = /sentry|wixpress|wix\.com|example\.|yourdomain|yourmail|domain\.com|email\.com|@2x|\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i;

/** Una red social NO es página web propia; se guardan aparte a propósito. */
const SOCIAL_HOSTS = /facebook\.|fb\.me|instagram\.|instagr\.am|tiktok\.|linktr|beacons|wa\.me|api\.whatsapp|twitter\.|x\.com|youtube\./i;
const SOCIAL_PATTERNS = {
  fb: /(?:https?:\/\/)?(?:[\w-]+\.)?(?:facebook\.com|fb\.me)\/[^\s",;)]+/i,
  ig: /(?:https?:\/\/)?(?:[\w-]+\.)?(?:instagram\.com|instagr\.am)\/[^\s",;)]+/i,
  tt: /(?:https?:\/\/)?(?:[\w-]+\.)?tiktok\.com\/[^\s",;)]+/i,
};

function extractEmails(s) {
  if (!s) return [];
  const m = String(s).match(EMAIL_RE) || [];
  return [...new Set(m.map((x) => x.toLowerCase()))];
}

function cleanEmails(list) {
  return [...new Set((list || []).filter((m) => m.length < 80 && !MAIL_JUNK.test(m)))].slice(0, 5);
}

function isOwnWebsite(u) {
  return !!u && /^https?:\/\//i.test(u) && !SOCIAL_HOSTS.test(u);
}

/**
 * Descripción: si es texto, se deja; si es el JSON de atributos de Google
 * (lo que ofrece el negocio), se convierte en texto legible en vez de descartarlo.
 */
function describe(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return "";
  if (!/^[\[{]/.test(s)) return s;
  try {
    const o = JSON.parse(s);
    const arr = Array.isArray(o) ? o : [o];
    const out = [];
    for (const gg of arr) {
      if (gg == null) continue;
      if (typeof gg === "string") { out.push(gg); continue; }
      const opts = gg.options || gg.Options;
      if (!Array.isArray(opts)) continue;
      for (const op of opts) {
        if (typeof op === "string") out.push(op);
        else if (op && typeof op === "object") {
          if (op.enabled === false || op.Enabled === false) continue;
          const nm = op.name || op.Name;
          if (nm) out.push(nm);
        }
      }
    }
    const uniq = [...new Set(out.map((x) => String(x).trim()).filter((x) => x.length > 1 && !/^\d+$/.test(x)))];
    return uniq.slice(0, 14).join(" · ").slice(0, 240);
  } catch (e) { return ""; }
}

/** Busca redes sociales en TODAS las columnas de la fila (no solo "website"). */
function extractSocial(values) {
  const t = (values || []).filter((x) => typeof x === "string").join(" ");
  const o = {};
  for (const k of Object.keys(SOCIAL_PATTERNS)) {
    const m = t.match(SOCIAL_PATTERNS[k]);
    if (!m) continue;
    let u = m[0].replace(/[),.;]+$/, "");
    if (!/^https?:/i.test(u)) u = "https://" + u;
    o[k] = u;
  }
  return o;
}

function parseJsonAddress(str) {
  try {
    let o = JSON.parse(str);
    if (Array.isArray(o)) o = o[0] || {};
    if (!o || typeof o !== "object") return null;
    const street = String(o.street || "").replace(/^[A-Z0-9]{4,}\+[A-Z0-9]+,?\s*/, "").trim();
    const address = [street, o.borough, o.city, o.state, o.country].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
    return { address, city: String(o.city || "").trim(), country: String(o.country || "").trim().toUpperCase() };
  } catch (e) { return null; }
}

function parseAddress(get) {
  const plain = (get("address") || "").trim();
  const complete = (get("complete_address") || "").trim();
  const j = /^[\[{]/.test(complete) ? complete : (/^[\[{]/.test(plain) ? plain : "");
  if (j) { const r = parseJsonAddress(j); if (r) return r; }
  const a = plain && !/^[\[{]/.test(plain) ? plain : (complete && !/^[\[{]/.test(complete) ? complete : "");
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean);
  return { address: a, city: parts[parts.length - 1] || "", country: "" };
}

/** Fila CSV del scraper (con cabecera H en minúsculas) → lead normalizado, o null si no tiene título. */
function rowToLead(headers, row) {
  const get = (name) => { const i = headers.indexOf(name); return i >= 0 ? (row[i] || "").trim() : ""; };
  const title = get("title");
  if (!title) return null;
  const addr = parseAddress(get);
  return {
    title,
    social: extractSocial(row),
    category: get("category"),
    address: addr.address,
    city: addr.city,
    country: addr.country || "",
    phone: get("phone"),
    website: get("website"),
    emails: extractEmails(get("emails")),
    rating: parseFloat(get("review_rating")) || 0,
    reviews: parseInt((get("review_count") || "").replace(/\D/g, ""), 10) || 0,
    lat: parseFloat(get("latitude")) || 0,
    lon: parseFloat(get("longitude")) || 0,
    link: get("link"),
    place_id: get("place_id") || get("cid"),
    thumb: get("thumbnail"),
    about: describe(get("descriptions") || get("about")),
    images: (get("images") || "").split(/[|;,\s]+/).filter((u) => /^https?:/.test(u)).slice(0, 6),
  };
}

/** Identidad estable para dedupe: place_id → link → teléfono → título|dirección. */
function leadId(l) {
  const ph = (l.phone || "").replace(/\D/g, "");
  return l.place_id || l.link || (ph ? "tel:" + ph : l.title + "|" + l.address);
}

module.exports = {
  extractEmails, cleanEmails, isOwnWebsite, describe, extractSocial,
  parseJsonAddress, parseAddress, rowToLead, leadId, SOCIAL_HOSTS,
};

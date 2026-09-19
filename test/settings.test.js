"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Settings, DEFAULTS } = require("../src/config/settings");
const { Notifier } = require("../src/services/notifier");

test("Settings: defaults, validación y persistencia", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bc3-cfg-")), "config.json");
  const s = new Settings({ file });
  assert.equal(s.get("safeMode"), DEFAULTS.safeMode);
  assert.deepEqual(s.update({ proxies: "1.1.1.1:80", conc: 4, notify: 1, depth: "3", pauseMin: NaN }).sort(), ["conc", "notify", "proxies"]);
  const again = new Settings({ file });
  assert.equal(again.get("conc"), 4);
  assert.equal(again.get("notify"), true);
  assert.equal(again.get("depth"), 0, "un string no pisa un número");
  assert.equal(again.publicView().proxies, "1.1.1.1:80");
});

test("Notifier: sin token no envía; con token encola y respeta el retraso entre mensajes", async () => {
  const sent = [];
  const s = new Settings();
  const n = new Notifier({ settings: s, httpsPost: async (url, body) => { sent.push({ url, body }); return { status: 200 }; }, delayMs: 5 });
  assert.match((await n.sendTelegram("x")).error, /Falta token/);
  n.notifyLead({ title: "A" });
  assert.equal(sent.length, 0);
  s.update({ telegramToken: "t", telegramChat: "c", notify: true, webhookUrl: "https://hook.test/x" });
  n.notifyLead({ title: "<B>", category: "Farmacia", phone: "1" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, 2, "telegram + webhook");
  const tg = sent.find((x) => /telegram/.test(x.url));
  assert.match(tg.body.text, /&lt;B&gt;/, "escapa HTML");
  assert.match(tg.body.text, /SIN WEB/);
});

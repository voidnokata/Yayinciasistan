const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const background = read("src/background/background.js");
const content = read("src/content/tiktok-content.js");
const popupHtml = read("src/ui/popup.html");
const popupScript = read("src/ui/popup.js");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  // Varsayılan parametredeki `{}` gövde sanılmasın.
  const braceStart = source.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} tamamlanamadı`);
}

function loadBackground(stored) {
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          get: async () => structuredClone(stored),
          set: async (patch) => Object.assign(stored, structuredClone(patch))
        }
      },
      tabs: {}
    }
  };
  vm.runInNewContext(background, context);
  return context;
}

test("Varsayılan ayarlar üç farklı hazır mesaj taşır", () => {
  const bg = loadBackground({});
  const variants = vm.runInContext("DEFAULT_MESSAGE_VARIANTS", vm.createContext(bg));
  assert.equal(variants.length, 3);
  assert.equal(new Set(variants.map((text) => text.trim())).size, 3);
  assert.equal(variants[0], vm.runInContext("DEFAULT_MESSAGE", vm.createContext(bg)));
  for (const text of variants) {
    assert.match(text, /Burak/);
    assert.match(text, /BTG Teknoloji/);
    assert.match(text, /komisyon/);
  }
});

test("sanitizeSettings kutu sırasını korur, ilk dolu mesajı message alanına yazar", () => {
  const bg = loadBackground({});
  const settings = bg.sanitizeSettings({ mode: "live", messages: ["  ", " İkinci ", "Üçüncü", "Fazla"] });
  assert.deepEqual([...settings.messages], ["", "İkinci", "Üçüncü"]);
  assert.equal(settings.message, "İkinci");

  const legacy = bg.sanitizeSettings({ mode: "live", message: "Tek mesaj" });
  assert.deepEqual([...legacy.messages], ["Tek mesaj"]);
  assert.equal(legacy.message, "Tek mesaj");

  const empty = bg.sanitizeSettings({ mode: "live", messages: ["", "", ""] });
  assert.equal(empty.messages.length, 1);
  assert.ok(empty.message.startsWith("Merhabalar, ben Burak."));
});

test("Eski tek mesajlı kayıt: yalnız varsayılan metinde alternatifler eklenir", async () => {
  const fresh = await loadBackground({}).getState();
  assert.equal(fresh.settings.messages.length, 3);
  assert.ok(fresh.settings.messages.every(Boolean));

  const bgDefault = loadBackground({});
  const defaultMessage = vm.runInContext("DEFAULT_MESSAGE", vm.createContext(bgDefault));
  const storedDefault = await loadBackground({ settings: { mode: "live", message: defaultMessage } }).getState();
  assert.equal(storedDefault.settings.messages.filter(Boolean).length, 3);

  // Kendi adıyla mesaj yazmış kullanıcıya başka imzalı metin eklenmez.
  const custom = await loadBackground({ settings: { mode: "live", message: "Merhaba, ben Ayşe." } }).getState();
  assert.deepEqual([...custom.settings.messages], ["Merhaba, ben Ayşe.", "", ""]);

  const saved = await loadBackground({ settings: { mode: "live", message: "A", messages: ["A", "B", ""] } }).getState();
  assert.deepEqual([...saved.settings.messages], ["A", "B", ""]);
});

test("Profil gönderiminde sohbetteki herhangi bir hazır mesaj tekrar gönderimi engeller", async () => {
  const bg = loadBackground({ settings: { messages: ["Bir", "", "Üç"], message: "Bir" } });
  assert.deepEqual([...(await bg.readOutreachMessageVariants())], ["Bir", "Üç"]);

  const sendDirect = extractFunction(background, "sendDirectMessage");
  assert.match(sendDirect, /const knownMessages = options\.feedback \? \[\] : await readOutreachMessageVariants\(\);/);
  assert.equal((sendDirect.match(/knownMessages\s*\n\s*\);/g) || []).length, 2);

  const trusted = extractFunction(background, "sendDmWithTrustedInput");
  assert.equal((trusted.match(/type: "BTG_PREPARE_PROFILE_DM",\s*message,\s*username,\s*knownMessages,/g) || []).length, 2);

  const prepare = extractFunction(content, "prepareProfileDmInput");
  assert.match(prepare, /conversationContainsAnyMessage\(message, knownMessages, composer\)/);

  const seen = [];
  const ctx = vm.createContext({
    conversationContainsMessage: (text) => { seen.push(text); return text === "Üç"; }
  });
  vm.runInContext(extractFunction(content, "conversationContainsAnyMessage"), ctx);
  assert.equal(ctx.conversationContainsAnyMessage("Bir", ["Bir", "Üç"], {}), true);
  assert.deepEqual(seen, ["Bir", "Bir", "Üç"]);
  assert.equal(ctx.conversationContainsAnyMessage("Bir", undefined, {}), false);
});

test("Gönderimde dolu kutulardan biri rastgele seçilir; numara kutu sırasıdır", () => {
  const ctx = vm.createContext({ Math: Object.create(Math) });
  vm.runInContext(extractFunction(content, "pickOutreachMessage"), ctx);
  const settings = { message: "A", messages: ["A", "", "C"] };

  ctx.Math.random = () => 0;
  assert.deepEqual({ ...ctx.pickOutreachMessage(settings) }, { text: "A", variant: 1, total: 2 });
  ctx.Math.random = () => 0.99;
  assert.deepEqual({ ...ctx.pickOutreachMessage(settings) }, { text: "C", variant: 3, total: 2 });

  ctx.Math.random = Math.random;
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 600; i += 1) counts[ctx.pickOutreachMessage({ messages: ["A", "B", "C"] }).variant] += 1;
  for (const variant of [1, 2, 3]) assert.ok(counts[variant] > 100, `Mesaj ${variant} yeterince seçilmedi`);

  assert.deepEqual({ ...ctx.pickOutreachMessage({ message: "Eski" }) }, { text: "Eski", variant: 0, total: 1 });
});

test("Canlı, mobil ve liste akışları rastgele mesaj seçer", () => {
  assert.doesNotMatch(content, /message: controller\.settings\.message/);
  assert.match(content, /message: outreach\.text,/);
  assert.match(content, /message: pickOutreachMessage\(controller\.settings\)\.text/);
  assert.match(extractFunction(content, "listMessageForUsername"), /return pickOutreachMessage\(settings\)\.text;/);
  assert.match(content, /Mevcut — DM gönderildi\$\{outreach\.total > 1 \? ` \(Mesaj \$\{outreach\.variant\}\)` : ""\}/);
});

test("Eklenti penceresinde üç mesaj kutusu var ve ayarlara yazılır", () => {
  for (const id of ["message", "message2", "message3", "messageGroup"]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }
  assert.match(popupScript, /messages: readMessageVariants\(\),/);
  assert.match(popupScript, /elements\.message2\.value = messages\[1\] \|\| "";/);
  assert.match(popupScript, /elements\.messageGroup\.hidden = elements\.message\.hidden;/);
});

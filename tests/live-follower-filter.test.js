const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const content = fs.readFileSync(path.join(__dirname, "..", "src/content/tiktok-content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "src/background/background.js"), "utf8");
const popup = fs.readFileSync(path.join(__dirname, "..", "src/ui/popup.html"), "utf8");
const popupScript = fs.readFileSync(path.join(__dirname, "..", "src/ui/popup.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} tamamlanamadı`);
}

// --- 1) Akış sıralaması: takipçi kontrolü DM yazımından önce olmalı ---------

const liveFlowStart = content.indexOf("async function runController()");
const liveFlowEnd = content.indexOf("async function runMobileController()", liveFlowStart);
assert.notEqual(liveFlowStart, -1, "CANLI Yayın akışı bulunamadı");
assert.notEqual(liveFlowEnd, -1, "CANLI Yayın akışının sınırı bulunamadı");
const liveFlow = content.slice(liveFlowStart, liveFlowEnd);

assert.match(liveFlow, /if \(dm\.followerSkipped\)/, "Canlı akış takipçi atlamasını işlemeli");
assert.match(liveFlow, /result: followerResult/, "Takipçi atlaması kalıcı geçmişe yazılmalı");
assert.match(liveFlow, /low_followers/, "Eşiğin altı için low_followers sonucu kullanılmalı");
assert.match(liveFlow, /follower_unknown/, "Okunamayan sayaç için follower_unknown kullanılmalı");
assert.ok(
  liveFlow.indexOf("if (dm.followerSkipped)") < liveFlow.indexOf("} else if (dm.unavailableSkipped)"),
  "Takipçi atlaması, DM sonucu değerlendirmesinin ilk dalı olmalı"
);
assert.match(
  liveFlow,
  /skipped: Number\(latest\.runtime\.skipped \|\| 0\) \+ 1,\s*\n\s*processed: \[\s*\n\s*\.\.\.latestProcessed,\s*\n\s*\{\s*\n\s*username,\s*\n\s*result: followerResult/,
  "Takipçi atlaması Atlandı sayacına ve işlenmiş listesine eklenmeli"
);

// Takipçi filtresi Backstage kontrolünden önce, yayın ekranındaki yayıncı
// kartından uygulanır; eşiği geçmeyen hesap için Backstage sorgusu yapılmaz.
const liveGateIndex = liveFlow.indexOf("await applyLiveFollowerGate(username)");
const eligibilityIndex = liveFlow.indexOf('type: "BTG_CHECK_ELIGIBILITY"');
assert.ok(liveGateIndex > 0, "Canlı akışta yayın kartı takipçi filtresi çağrılmalı");
assert.ok(
  eligibilityIndex > liveGateIndex,
  "Takipçi filtresi Backstage uygunluk kontrolünden önce çalışmalı"
);
assert.match(
  liveFlow,
  /} else if \(followerGate\.skip\) \{/,
  "Eşiği geçmeyen hesap için Backstage ve DM adımları atlanmalı"
);
assert.match(
  liveFlow,
  /followerCount: followerGate\.count/,
  "Yayın kartından okunan sayaç DM akışına aktarılmalı"
);
assert.match(
  content,
  /result: "low_followers",\s*\n\s*time: new Date\(\)\.toISOString\(\),\s*\n\s*backstageChecked: false/,
  "Yayın kartında elenen hesap Backstage kontrolü yapılmadan geçmişe yazılmalı"
);

const gateIndex = background.indexOf("await enforceFollowerThreshold(");
const openMessageIndex = background.indexOf("openProfileMessageWithReloads(profileTab.id");
const sendIndex = background.indexOf("await sendDmWithTrustedInput(");
assert.ok(gateIndex > 0, "DM akışında takipçi filtresi çağrısı bulunmalı");
assert.ok(openMessageIndex > gateIndex, "Takipçi filtresi Mesaj düğmesinden önce çalışmalı");
assert.ok(sendIndex > gateIndex, "Takipçi filtresi mesaj yazımından önce çalışmalı");
assert.ok(
  background.includes('{ type: "BTG_READ_FOLLOWER_COUNT", username }'),
  "Profil sekmesine takipçi sorgusu gönderilmeli"
);
assert.match(content, /message\?\.type === "BTG_READ_FOLLOWER_COUNT"/, "İçerik betiği takipçi sorgusunu yanıtlamalı");
assert.match(background, /active: mode === "live" && minFollowers > 0/, "Filtre yalnız CANLI Yayın modunda uygulanmalı");
assert.match(popup, /id="minFollowers"/, "Arayüzde minimum takipçi alanı olmalı");
assert.match(
  popupScript,
  /Denemi\\u015f yay\\u0131nc\\u0131lar|Denenmi\\u015f yay\\u0131nc\\u0131lar|Denenmiş yayıncılar/,
  "Arayüz açıklaması filtrelenen hesapların geçmişe eklendiğini belirtmeli"
);

// --- 2) Sayaç metni ayrıştırma ---------------------------------------------

const context = {
  document: { documentElement: { lang: "tr-TR" } },
  navigator: { language: "tr-TR" },
  console
};
vm.createContext(context);
vm.runInContext(
  [
    extractFunction(content, "parseFollowerCountText"),
    extractFunction(content, "followerSuffixMultiplier"),
    extractFunction(content, "isTurkishInterface"),
    extractFunction(content, "compactText"),
    extractFunction(content, "findFollowerCountInJson"),
    extractFunction(content, "readFollowerCountField"),
    extractFunction(content, "readJsonUniqueId")
  ].join("\n"),
  context
);

const parse = (value) => vm.runInContext("parseFollowerCountText", context)(value);

assert.equal(parse("976"), 976);
assert.equal(parse("1.234"), 1234, "Türkçe binlik ayıracı sayı olarak okunmalı");
assert.equal(parse("12.345.678"), 12345678);
assert.equal(parse("12,3B"), 12300, "Türkçe arayüzde B = bin");
assert.equal(parse("1,2 Mn"), 1200000);
assert.equal(parse("1.5M"), 1500000);
assert.equal(parse("48K"), 48000);
assert.equal(parse("0"), 0);
assert.equal(parse(" 3 400 "), 3400);
assert.equal(parse(""), null);
assert.equal(parse(null), null);
assert.equal(parse("Takipçi"), null, "Etiket metni sayı sanılmamalı");
assert.equal(parse("12 gönderi"), null, "Tanınmayan son ek reddedilmeli");
assert.equal(parse("-5"), null);

context.document.documentElement.lang = "en-US";
assert.equal(parse("1.2B"), 1200000000, "İngilizce arayüzde B = milyar");
assert.equal(parse("12,3K"), 12300);
context.document.documentElement.lang = "tr-TR";

// --- 3) Gömülü profil verisinden takipçi sayısı ----------------------------

const findInJson = vm.runInContext("findFollowerCountInJson", context);

const universalData = {
  __DEFAULT_SCOPE__: {
    "webapp.user-detail": {
      userInfo: {
        user: { id: "1", uniqueId: "Yayinci_01", nickname: "Yayıncı" },
        stats: { followerCount: 1543, followingCount: 12, heart: 900 }
      }
    },
    "webapp.recommend-list": {
      userList: [
        {
          user: { uniqueId: "baska_hesap" },
          stats: { followerCount: 9000000 }
        }
      ]
    }
  }
};
assert.equal(findInJson(universalData, "yayinci_01"), 1543, "Hedef hesabın sayacı okunmalı");
assert.equal(findInJson(universalData, "baska_hesap"), 9000000);
assert.equal(findInJson(universalData, "kayitsiz_hesap"), null, "Başka hesabın sayacı hedefe atanmamalı");

const sigiState = {
  UserModule: {
    users: { yayinci_02: { uniqueId: "yayinci_02", id: "2" } },
    stats: { yayinci_02: { followerCount: "820", followingCount: 3 } }
  }
};
assert.equal(findInJson(sigiState, "yayinci_02"), 820, "SIGI_STATE biçimi desteklenmeli");
assert.equal(findInJson({ user: { uniqueId: "x" }, stats: {} }, "x"), null);
assert.equal(findInJson({ uniqueId: "tek", followerCount: 44 }, "tek"), 44);

// --- 3b) Yayın ekranındaki yayıncı kartından takipçi sayısı ----------------

// TikTok, yayın başlığındaki yayıncı kartına gelindiğinde takipçi sayısını
// gövdeye floating-ui portalı olarak ekler. Aşağıdaki sahte DOM, kaydedilmiş
// gerçek yayın sayfasındaki yapının aynısını kurar.
class MockNode {
  constructor(tagName, attributes = {}, text = "") {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.ownText = text;
    this.rect = { left: 10, top: 10, width: 240, height: 120 };
    this.style = { visibility: "visible", display: "block", opacity: "1" };
  }

  get className() {
    return this.attributes.class || "";
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  get innerText() {
    return this.textContent;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
    return this;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? String(this.attributes[name])
      : null;
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  descendants() {
    const all = [];
    for (const child of this.children) {
      all.push(child, ...child.descendants());
    }
    return all;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelectorList(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = new Set();
    for (const node of this.descendants()) {
      if (matchesSelectorList(node, selector)) matches.add(node);
    }
    return [...matches];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function matchesSelectorList(node, selectorList) {
  return String(selectorList)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .some((selector) => matchesDescendantSelector(node, selector));
}

function matchesDescendantSelector(node, selector) {
  const parts = selector.split(/\s+/).filter(Boolean);
  let current = node;
  if (!matchesSimpleSelector(current, parts[parts.length - 1])) return false;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    let ancestor = current.parentElement;
    while (ancestor && !matchesSimpleSelector(ancestor, parts[index])) {
      ancestor = ancestor.parentElement;
    }
    if (!ancestor) return false;
    current = ancestor;
  }
  return true;
}

function matchesSimpleSelector(node, part) {
  const tagMatch = part.match(/^[a-zA-Z][a-zA-Z0-9]*/);
  const rest = tagMatch ? part.slice(tagMatch[0].length) : part;
  if (tagMatch && node.tagName !== tagMatch[0].toUpperCase()) return false;
  const conditions = rest.match(/\[[^\]]+\]/g) || [];
  if (!tagMatch && !conditions.length) return false;
  return conditions.every((condition) => {
    const parsed = condition
      .slice(1, -1)
      .match(/^([a-zA-Z0-9_-]+)(?:(\*?=)\s*["']?([^"']*)["']?)?$/);
    if (!parsed) return false;
    const value = node.getAttribute(parsed[1]);
    if (value === null) return false;
    if (!parsed[2]) return true;
    return parsed[2] === "*=" ? value.includes(parsed[3]) : value === parsed[3];
  });
}

function buildLivePage(username, { countText = "391", label = "Takipçiler", combined = false } = {}) {
  const root = new MockNode("html");

  const header = new MockNode("div", { "data-e2e": "live-header-container" });
  const hoverTrigger = new MockNode("a", {
    href: `https://www.tiktok.com/@${username}`,
    "aria-expanded": "false",
    "aria-haspopup": "dialog"
  });
  hoverTrigger.append(new MockNode("div", { "data-e2e": "room-header-anchor-avatar" }));
  const nameCell = new MockNode("a", { href: `https://www.tiktok.com/@${username}` });
  nameCell.append(new MockNode("p", { "data-e2e": "room-header-anchor-name" }, username));
  header.append(hoverTrigger, nameCell);

  const portal = new MockNode("div", { "data-floating-ui-portal": "" });
  const dialog = new MockNode("div", { role: "dialog", class: "tux-popover-oNF64o" });
  const inner = new MockNode("div", { class: "tux-popover__inner-QJ4Cdu" });
  const card = new MockNode("div", { class: "flex flex-col min-w-[240px]" });
  const profileLink = new MockNode("a", { href: `https://www.tiktok.com/@${username}` });
  profileLink.append(new MockNode("p", {}, username));
  const followerRow = new MockNode("div", { class: "flex" });
  if (combined) {
    followerRow.append(new MockNode("p", {}, `${countText} ${label}`));
  } else {
    followerRow.append(new MockNode("p", {}, countText), new MockNode("p", {}, ` ${label}`));
  }
  card.append(profileLink, new MockNode("p", {}, username), followerRow);
  inner.append(card);
  dialog.append(inner);
  portal.append(dialog);

  root.append(header, portal);
  return { root, dialog, hoverTrigger };
}

const domState = { root: new MockNode("html") };
context.Element = MockNode;
context.HTMLElement = MockNode;
context.location = { origin: "https://www.tiktok.com", pathname: "/@yayinci/live" };
context.URL = URL;
context.getComputedStyle = (element) =>
  element?.style || { visibility: "visible", display: "block", opacity: "1" };
context.document.querySelector = (selector) => domState.root.querySelector(selector);
context.document.querySelectorAll = (selector) => domState.root.querySelectorAll(selector);

const followerLabelsSource = content.match(/const FOLLOWER_LABELS = \[[^\]]*\];/);
assert.ok(followerLabelsSource, "FOLLOWER_LABELS tanımı bulunamadı");

vm.runInContext(
  [
    followerLabelsSource[0],
    extractFunction(content, "readFollowerCountFromLivePopover"),
    extractFunction(content, "livePopoverBelongsTo"),
    extractFunction(content, "isRenderedPopover"),
    extractFunction(content, "readCombinedFollowerCount"),
    extractFunction(content, "readLabeledFollowerCount"),
    extractFunction(content, "readFollowerCountFromElement"),
    extractFunction(content, "findLiveAnchorHoverTrigger"),
    extractFunction(content, "getUsernameFromProfileLink"),
    extractFunction(content, "usernamesMatch"),
    extractFunction(content, "isVisible"),
    extractFunction(content, "clampFollowerThreshold"),
    extractFunction(content, "isReadableFollowerCount")
  ].join("\n"),
  context
);

const readPopover = vm.runInContext("readFollowerCountFromLivePopover", context);
const findTrigger = vm.runInContext("findLiveAnchorHoverTrigger", context);

const exactPage = buildLivePage("smilingwr");
domState.root = exactPage.root;
assert.equal(
  findTrigger("smilingwr"),
  exactPage.hoverTrigger,
  "Yayıncı kartını açan öğe aria-haspopup=dialog bağlantısı olmalı"
);
assert.equal(readPopover("smilingwr")?.count, 391, "Yayın kartındaki takipçi sayısı okunmalı");
assert.match(
  readPopover("smilingwr").source,
  /yayın kartı/,
  "Sayaç kaynağı yayın kartı olarak işaretlenmeli"
);
assert.equal(
  readPopover("baska_hesap"),
  null,
  "Başka yayıncıya ait açık kart hedef hesabın sayacı sanılmamalı"
);

exactPage.dialog.style.opacity = "0";
assert.equal(readPopover("smilingwr"), null, "Kapanmakta olan görünmez kart okunmamalı");
exactPage.dialog.style.opacity = "1";

domState.root = buildLivePage("kisaltmali", { countText: "12,3B" }).root;
assert.equal(readPopover("kisaltmali")?.count, 12300, "Türkçe kısaltmalı sayaç çözülmeli");

domState.root = buildLivePage("birlesik", { combined: true }).root;
assert.equal(readPopover("birlesik")?.count, 391, "Tek düğümde birleşmiş sayaç da okunmalı");

domState.root = buildLivePage("ingilizce", { countText: "48K", label: "Followers", combined: true }).root;
assert.equal(readPopover("ingilizce")?.count, 48000, "İngilizce arayüzdeki kart da okunmalı");

const stalePage = buildLivePage("onceki_yayinci");
domState.root = stalePage.root;
assert.equal(
  findTrigger("yeni_yayinci"),
  null,
  "Başlık hâlâ önceki yayıncıyı gösteriyorsa kart açılmamalı"
);
assert.equal(
  findTrigger("onceki_yayinci"),
  stalePage.hoverTrigger,
  "Başlıktaki hesap hedefle eşleşince kart tetikleyicisi bulunmalı"
);

domState.root = new MockNode("html");
assert.equal(findTrigger("yayinci"), null, "Yayın başlığı yoksa kart tetikleyicisi bulunmamalı");
assert.equal(readPopover("yayinci"), null, "Kart yoksa sayaç okunmamalı");

const clampThreshold = vm.runInContext("clampFollowerThreshold", context);
assert.equal(clampThreshold(1000), 1000);
assert.equal(clampThreshold("2500"), 2500);
assert.equal(clampThreshold(0), 0);
assert.equal(clampThreshold(-5), 0);
assert.equal(clampThreshold(""), 0);
assert.equal(clampThreshold(null), 0);
assert.equal(clampThreshold(2000000000), 1000000000);

const readableCount = vm.runInContext("isReadableFollowerCount", context);
assert.equal(readableCount(0), true);
assert.equal(readableCount(null), false);
assert.equal(readableCount(undefined), false);
assert.equal(readableCount("500"), false, "Metin yanıt sayaç sanılmamalı");

// --- 4) Arka plan eşiği: eşiğin altındaki hesaba DM ekranı açılmaz ---------

function createBackgroundContext(settings) {
  const calls = { reads: [], reloads: 0, statuses: [] };
  const stored = {
    settings,
    runtime: { running: false },
    publisherHistory: { entries: {}, updatedAt: "" }
  };
  const backgroundContext = {
    console,
    URL,
    structuredClone,
    // Testin gerçek zamanlı beklemelerde takılmaması için gecikmeler kısaltılır.
    setTimeout: (callback, ms) => setTimeout(callback, Math.min(Number(ms) || 0, 5)),
    clearTimeout,
    chrome: {
      runtime: {
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        getManifest: () => ({ version: "test" })
      },
      storage: {
        local: {
          get: async () => structuredClone(stored),
          set: async (patch) => Object.assign(stored, structuredClone(patch))
        }
      },
      webNavigation: { getAllFrames: async () => [{ frameId: 0, url: "https://www.tiktok.com/" }] },
      tabs: {
        onUpdated: { addListener: () => {}, removeListener: () => {} },
        get: async (tabId) => ({ id: tabId, status: "complete" }),
        update: async () => {
          calls.reloads += 1;
        },
        reload: async () => {
          calls.reloads += 1;
        },
        sendMessage: async (_tabId, message) => {
          calls.reads.push(message);
          const reply = calls.replies.shift();
          if (reply instanceof Error) throw reply;
          return reply;
        }
      }
    }
  };
  calls.replies = [];
  vm.runInNewContext(background, backgroundContext);
  return { backgroundContext, calls, stored };
}

(async () => {
  const belowThreshold = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  belowThreshold.calls.replies = [{ ok: true, count: 500, source: "script#SIGI_STATE" }];
  const belowResult = await belowThreshold.backgroundContext.enforceFollowerThreshold(
    5,
    "kucuk_hesap",
    "https://www.tiktok.com/@kucuk_hesap"
  );
  assert.deepEqual(
    { skip: belowResult.skip, reason: belowResult.reason, count: belowResult.count },
    { skip: true, reason: "low_followers", count: 500 },
    "Eşiğin altındaki hesap atlanmalı"
  );
  assert.equal(belowThreshold.calls.reads.length, 1);
  assert.equal(belowThreshold.calls.reads[0].type, "BTG_READ_FOLLOWER_COUNT");

  const atThreshold = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  atThreshold.calls.replies = [{ ok: true, count: 1000 }];
  const atResult = await atThreshold.backgroundContext.enforceFollowerThreshold(5, "tam_esik", "");
  assert.equal(atResult.skip, false, "Eşiğe eşit takipçi sayısı geçmeli");

  const aboveThreshold = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  aboveThreshold.calls.replies = [{ ok: true, count: 12500 }];
  const aboveResult = await aboveThreshold.backgroundContext.enforceFollowerThreshold(5, "buyuk", "");
  assert.deepEqual(
    { skip: aboveResult.skip, count: aboveResult.count },
    { skip: false, count: 12500 },
    "Eşiğin üstündeki hesaba DM akışı devam etmeli"
  );

  const unreadable = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  unreadable.calls.replies = [
    { ok: false, error: "Profil sayfasında takipçi sayısı bulunamadı." },
    { ok: false, error: "Profil sayfasında takipçi sayısı bulunamadı." }
  ];
  const unreadableResult = await unreadable.backgroundContext.enforceFollowerThreshold(
    5,
    "okunamayan",
    "https://www.tiktok.com/@okunamayan"
  );
  assert.deepEqual(
    { skip: unreadableResult.skip, reason: unreadableResult.reason, count: unreadableResult.count },
    { skip: true, reason: "follower_unknown", count: null },
    "Okunamayan sayaç güvenli tarafta kalıp atlanmalı"
  );
  assert.equal(unreadable.calls.reads.length, 2, "Sayaç okunamazsa profil bir kez yenilenip yeniden denenmeli");
  assert.equal(unreadable.calls.reloads, 1);

  const nullCount = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  nullCount.calls.replies = [{ ok: true, count: null }, { ok: true, count: null }];
  const nullCountResult = await nullCount.backgroundContext.enforceFollowerThreshold(5, "bos_sayac", "");
  assert.equal(
    nullCountResult.reason,
    "follower_unknown",
    "Boş sayaç yanıtı 0 takipçi sanılmamalı"
  );

  const lateReading = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  lateReading.calls.replies = [{ ok: false, error: "henüz hazır değil" }, { ok: true, count: 4000 }];
  const lateResult = await lateReading.backgroundContext.enforceFollowerThreshold(5, "geciken", "");
  assert.deepEqual(
    { skip: lateResult.skip, count: lateResult.count },
    { skip: false, count: 4000 },
    "Yenilemeden sonra okunan sayaç kabul edilmeli"
  );

  // Yayın kartından okunan sayaç profil sekmesinde ikinci kez sorgulanmamalı.
  const preRead = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  const preReadResult = await preRead.backgroundContext.enforceFollowerThreshold(
    5,
    "yayin_kartindan",
    "https://www.tiktok.com/@yayin_kartindan",
    4200
  );
  assert.deepEqual(
    { skip: preReadResult.skip, count: preReadResult.count },
    { skip: false, count: 4200 },
    "Yayın kartından okunan sayaç eşiği geçerse akış devam etmeli"
  );
  assert.equal(
    preRead.calls.reads.length,
    0,
    "Sayaç önceden okunduysa profil sekmesine takipçi sorgusu gönderilmemeli"
  );
  assert.equal(preRead.calls.reloads, 0, "Sayaç önceden okunduysa profil yenilenmemeli");

  const preReadLow = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  const preReadLowResult = await preReadLow.backgroundContext.enforceFollowerThreshold(
    5,
    "yayin_kartindan_dusuk",
    "",
    120
  );
  assert.deepEqual(
    { skip: preReadLowResult.skip, reason: preReadLowResult.reason, count: preReadLowResult.count },
    { skip: true, reason: "low_followers", count: 120 },
    "Yayın kartından okunan düşük sayaç profil sorgusu olmadan elenmeli"
  );
  assert.equal(preReadLow.calls.reads.length, 0);

  const preReadInvalid = createBackgroundContext({ mode: "live", minFollowers: 1000 });
  preReadInvalid.calls.replies = [{ ok: true, count: 7000 }];
  const preReadInvalidResult = await preReadInvalid.backgroundContext.enforceFollowerThreshold(
    5,
    "okunamadi",
    "",
    null
  );
  assert.deepEqual(
    { skip: preReadInvalidResult.skip, count: preReadInvalidResult.count },
    { skip: false, count: 7000 },
    "Yayın kartı okunamadıysa sayaç profil sekmesinden okunmalı"
  );
  assert.equal(
    preReadInvalid.calls.reads.length,
    1,
    "Yayın kartı okunamadıysa profil sekmesi yedek olarak sorgulanmalı"
  );

  const filterOff = createBackgroundContext({ mode: "live", minFollowers: 0 });
  const filterOffResult = await filterOff.backgroundContext.enforceFollowerThreshold(5, "filtresiz", "");
  assert.equal(filterOffResult.skip, false);
  assert.equal(filterOff.calls.reads.length, 0, "Filtre boşsa takipçi sayısı sorulmamalı");

  const otherMode = createBackgroundContext({ mode: "foryou", minFollowers: 1000 });
  const otherModeResult = await otherMode.backgroundContext.enforceFollowerThreshold(5, "sizin_icin", "");
  assert.equal(otherModeResult.skip, false);
  assert.equal(otherMode.calls.reads.length, 0, "Filtre yalnız CANLI Yayın modunda çalışmalı");

  console.log("CANLI Yayın takipçi filtresi testleri geçti.");
})();

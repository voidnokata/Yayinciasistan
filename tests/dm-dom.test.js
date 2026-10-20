const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/content/tiktok-content.js"), "utf8");

function extractFunction(name) {
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

class MockElement {
  constructor(tagName, attributes = {}, rect = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.innerText = "";
    this.textContent = "";
    this.className = attributes.class || "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name)
    };
    this.clicked = false;
    this.rect = {
      left: 0,
      top: 0,
      width: 40,
      height: 40,
      ...rect
    };
  }

  append(...elements) {
    for (const element of elements) {
      element.parentElement = this;
      this.children.push(element);
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? String(this.attributes[name])
      : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  contains(element) {
    if (element === this) return true;
    return this.children.some((child) => child.contains(element));
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height
    };
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (matchesSelectorList(child, selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    if (selector === "svg path") {
      return this.querySelectorAll("path")[0] || null;
    }
    return this.querySelectorAll(selector)[0] || null;
  }

  click() {
    this.clicked = true;
  }

  scrollIntoView(options) {
    this.scrolledIntoView = options || true;
  }
}

class MockSvgElement extends MockElement {}

function matchesSelectorList(element, selectorList) {
  return selectorList.split(",").some((selector) => matchesSelector(element, selector.trim()));
}

function matchesSelector(element, selector) {
  if (selector === "form") return element.tagName === "FORM";
  if (selector === "a[href]") {
    return element.tagName === "A" && element.hasAttribute("href");
  }
  if (selector === '[data-e2e="recommend-list-item-container"]') {
    return element.getAttribute("data-e2e") === "recommend-list-item-container";
  }
  if (selector === 'a[data-e2e="video-author-avatar"][href*="/@"]') {
    return (
      element.tagName === "A" &&
      element.getAttribute("data-e2e") === "video-author-avatar" &&
      (element.getAttribute("href") || "").includes("/@")
    );
  }
  if (selector === 'a[href*="/@"]') {
    return element.tagName === "A" && (element.getAttribute("href") || "").includes("/@");
  }
  if (selector === 'a[href*="/business-suite/messages"]') {
    return (
      element.tagName === "A" &&
      (element.getAttribute("href") || "").includes("/business-suite/messages")
    );
  }
  if (selector === "button") return element.tagName === "BUTTON";
  if (selector === "svg") return element.tagName === "SVG";
  if (selector === "path") return element.tagName === "PATH";
  if (selector === "[role='button']" || selector === '[role="button"]') {
    return element.getAttribute("role") === "button";
  }
  if (selector === '[data-e2e="dm-new-chat-bottom"]') {
    return element.getAttribute("data-e2e") === "dm-new-chat-bottom";
  }
  if (selector === '[data-e2e="message-input-area"]') {
    return element.getAttribute("data-e2e") === "message-input-area";
  }
  if (selector === '[class*="DivMessageInputAndSendButton"]') {
    return element.className.includes("DivMessageInputAndSendButton");
  }
  if (selector.includes("data-e2e") && selector.includes("send")) {
    return (element.getAttribute("data-e2e") || "").toLowerCase().includes("send");
  }
  if (selector.includes("data-testid") && selector.includes("send")) {
    return (element.getAttribute("data-testid") || "").toLowerCase().includes("send");
  }
  if (selector.includes("class*='SendButton'") || selector.includes('class*="SendButton"')) {
    return element.className.includes("SendButton");
  }
  if (selector.includes("class*='send-button'") || selector.includes('class*="send-button"')) {
    return element.className.includes("send-button");
  }
  return false;
}

const context = {
  console,
  URL,
  window: { innerWidth: 900, innerHeight: 700 },
  document: { querySelector: () => null, querySelectorAll: () => [], elementFromPoint: () => null },
  location: { pathname: "/", href: "https://www.tiktok.com/", origin: "https://www.tiktok.com" },
  Element: MockElement,
  HTMLElement: MockElement,
  SVGElement: MockSvgElement,
  getComputedStyle: () => ({ visibility: "visible", display: "block", opacity: "1" })
};

const names = [
  "findDmComposer",
  "scoreComposer",
  "findDmSendButton",
  "findDmActionRoot",
  "collectDmActionControls",
  "isAvailableDmActionControl",
  "getSendControlMarker",
  "scoreSendButton",
  "describeSendButton",
  "activateDmSendControl",
  "findProfileMessageButton",
  "findProfileBusinessMessageUrl",
  "findOpenConversationUsername",
  "usernamesMatch",
  "isMessageActionLabel",
  "scoreProfileMessageButton",
  "clickNextLiveButton",
  "clickNextForYouButton",
  "getLiveUsername",
  "getLiveHeaderUsername",
  "getForYouUsername",
  "findVisibleForYouArticle",
  "getUsernameFromProfileLink",
  "getProfileUsername",
  "isManualSkipUsername",
  "isVisible",
  "compactText",
  "composerTextMatches"
];
vm.runInNewContext(
  `${names.map(extractFunction).join("\n")}\nthis.api = { ${names.join(", ")} };`,
  context
);

function buildFixture({ includeSend = true, labelledSend = false } = {}) {
  const root = new MockElement(
    "div",
    { class: "css-6fmtan--DivMessageInputAndSendButton e1xqqiqx1" },
    { left: 90, top: 290, width: 480, height: 62 }
  );
  const inputArea = new MockElement(
    "div",
    { "data-e2e": "message-input-area" },
    { left: 100, top: 300, width: 400, height: 52 }
  );
  const editorContainer = new MockElement(
    "div",
    { "data-e2e": "dm-new-input-editor" },
    { left: 100, top: 300, width: 350, height: 50 }
  );
  const composer = new MockElement(
    "div",
    {
      "aria-label": "Mesaj gönder...",
      contenteditable: "true",
      role: "textbox"
    },
    { left: 100, top: 300, width: 350, height: 50 }
  );
  const emoji = new MockElement(
    "div",
    {
      role: "button",
      "aria-label": "Emoji eklemek için tıklayın",
      "data-e2e": "dm-new-emoji-btn"
    },
    { left: 455, top: 305, width: 40, height: 40 }
  );
  emoji.append(new MockSvgElement("svg"));
  editorContainer.append(composer);
  inputArea.append(editorContainer, emoji);
  root.append(inputArea);

  let send = null;
  if (includeSend) {
    send = new MockElement(
      "div",
      labelledSend ? { "data-e2e": "dm-new-send-button" } : {},
      { left: 510, top: 305, width: 42, height: 42 }
    );
    send.append(new MockSvgElement("svg"));
    root.append(send);
  }

  return { root, inputArea, composer, emoji, send };
}

{
  const fixture = buildFixture();
  const found = context.api.findDmSendButton(fixture.composer);
  assert.equal(found, fixture.send, "etiketsiz sağ gönder sarmalayıcısı bulunmalı");
  assert.notEqual(found, fixture.emoji, "emoji düğmesi gönder düğmesi sayılmamalı");
}

{
  const fixture = buildFixture({ includeSend: false });
  const found = context.api.findDmSendButton(fixture.composer);
  assert.equal(found, null, "yalnızca emoji varsa gönder düğmesi bulunmamalı");
}

{
  const fixture = buildFixture({ labelledSend: true });
  const found = context.api.findDmSendButton(fixture.composer);
  assert.equal(found, fixture.send, "etiketli TikTok gönder düğmesi öncelikli bulunmalı");
  assert.equal(context.api.describeSendButton(found), "etiketli-gönder-düğmesi");
}

{
  const fixture = buildFixture({ includeSend: false });
  const tiktokSendSvg = new MockSvgElement(
    "svg",
    {
      "data-e2e": "dm-new-send-btn",
      role: "button",
      "aria-label": "Gönder"
    },
    { left: 0, top: 0, width: 0, height: 0 }
  );
  fixture.root.append(tiktokSendSvg);
  const found = context.api.findDmSendButton(fixture.composer);
  assert.equal(
    found,
    tiktokSendSvg,
    "TikTok'un 0×0 raporlanan dm-new-send-btn kontrolü yine de bulunmalı"
  );
  context.api.activateDmSendControl(found);
  assert.equal(tiktokSendSvg.clicked, true, "0×0 TikTok gönder kontrolü tetiklenmeli");
}

{
  const businessAnchor = new MockElement("a", {
    href: "https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=7616812834928837652"
  });
  const messageButton = new MockElement(
    "button",
    { "data-e2e": "message-button", "data-testid": "tux-web-button" },
    { left: 360, top: 170, width: 108, height: 44 }
  );
  messageButton.innerText = "Mesaj";
  businessAnchor.append(messageButton);
  context.document.querySelectorAll = (selector) => {
    return selector.includes("message") || selector === "button" ? [messageButton] : [];
  };
  assert.equal(
    context.api.findProfileMessageButton(),
    messageButton,
    "gerçek profil message-button seçicisi bulunmalı"
  );
  assert.equal(
    context.api.findProfileBusinessMessageUrl(messageButton),
    "https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=7616812834928837652",
    "Mesaj düğmesini saran gerçek Business Suite hedefi okunmalı"
  );
}

{
  const normalMessagesAnchor = new MockElement("a", {
    href: "https://www.tiktok.com/messages?lang=tr-TR&u=7414463207228195848"
  });
  const messageButton = new MockElement(
    "button",
    { "data-e2e": "message-button", "data-testid": "tux-web-button" },
    { left: 740, top: 160, width: 76, height: 44 }
  );
  messageButton.innerText = "Mesaj";
  normalMessagesAnchor.append(messageButton);
  assert.equal(
    context.api.findProfileBusinessMessageUrl(messageButton),
    "https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=7414463207228195848",
    "yeni normal Mesaj bağlantısı hedef kimliği korunarak Business Suite adresine dönüştürülmeli"
  );
}

{
  const uniqueId = new MockElement(
    "p",
    { "data-e2e": "chat-uniqueid" },
    { left: 600, top: 120, width: 120, height: 22 }
  );
  uniqueId.innerText = "@chenzy.exe";
  context.document.querySelectorAll = (selector) => {
    return selector === '[data-e2e="chat-uniqueid"]' ? [uniqueId] : [];
  };
  assert.equal(context.api.findOpenConversationUsername(), "chenzy.exe");
  assert.equal(context.api.usernamesMatch("chenzy.exe", "@chenzy.exe"), true);
  assert.equal(context.api.usernamesMatch("chenzy.exe", "dll.luis"), false);
}

{
  const switchRoot = new MockElement(
    "div",
    { "data-live-inner-switch-btn": "" },
    { left: 700, top: 250, width: 40, height: 92 }
  );
  const up = new MockElement(
    "div",
    { class: "pointer-events-none" },
    { left: 700, top: 250, width: 40, height: 40 }
  );
  const down = new MockElement(
    "div",
    { class: "pointer-events-auto" },
    { left: 700, top: 302, width: 40, height: 40 }
  );
  const downSvg = new MockSvgElement("svg");
  downSvg.append(
    new MockSvgElement("path", {
      d: "m24 28.75 13.67-13.67a1 1 0 0 1 1.41 0"
    })
  );
  down.append(downSvg);
  switchRoot.append(up, down);
  context.document.querySelectorAll = (selector) => {
    return selector === "[data-live-inner-switch-btn]" ? [switchRoot] : [];
  };
  assert.equal(context.api.clickNextLiveButton(), true, "gerçek LIVE aşağı düğmesi bulunmalı");
  assert.equal(down.clicked, true, "aşağı yönlü kontrol tıklanmalı");
  assert.equal(up.clicked, false, "devre dışı yukarı kontrol tıklanmamalı");
}

context.location.pathname = "/@chenzy.exe/live";
assert.equal(context.api.getLiveUsername(), "chenzy.exe");
context.location.pathname = "/@chenzy.exe";
assert.equal(context.api.getProfileUsername(), "chenzy.exe");

{
  const article = new MockElement(
    "article",
    { "data-e2e": "recommend-list-item-container" },
    { left: 300, top: 40, width: 420, height: 620 }
  );
  const videoOwner = new MockElement("a", {
    "data-e2e": "video-author-avatar",
    href: "https://www.tiktok.com/@16arbeyy"
  });
  article.append(videoOwner);
  context.document.elementFromPoint = () => videoOwner;
  context.document.querySelectorAll = (selector) =>
    selector === '[data-e2e="recommend-list-item-container"]' ? [article] : [];
  assert.equal(
    context.api.getForYouUsername(),
    "16arbeyy",
    "Sizin İçin kartındaki gerçek profil bağlantısından kullanıcı adı okunmalı"
  );
}

{
  const up = new MockElement(
    "button",
    {},
    { left: 810, top: 270, width: 48, height: 48 }
  );
  const down = new MockElement(
    "button",
    {},
    { left: 810, top: 330, width: 48, height: 48 }
  );
  up.append(new MockSvgElement("svg"));
  down.append(new MockSvgElement("svg"));
  context.document.elementFromPoint = () => null;
  context.document.querySelectorAll = (selector) =>
    selector === "button, [role='button']" ? [up, down] : [];
  assert.equal(
    context.api.clickNextForYouButton(),
    true,
    "Sizin İçin akışındaki sağ alt geçiş kontrolü bulunmalı"
  );
  assert.equal(down.clicked, true, "sağdaki alt kontrol tıklanmalı");
  assert.equal(up.clicked, false, "sağdaki üst kontrol tıklanmamalı");
}

for (const username of [
  "memousta58",
  "mustix_ryzen",
  "desperato30",
  "ege3310",
  "jerryfc_",
  "zynowq",
  "noxain4",
  "alionfrooy",
  "uvlog.2026",
  "esma_nuurss",
  "novazzzy",
  "2032_hafiz_ali",
  "flexinvll"
]) {
  assert.equal(
    context.api.isManualSkipUsername(`@${username.toUpperCase()}`),
    true,
    `${username} özel geçme listesinde bulunmalı`
  );
}
assert.equal(context.api.isManualSkipUsername("listede_yok"), false);

assert.equal(
  context.api.composerTextMatches(
    "Birinci satır\n\nİkinci satır   😄",
    "Birinci satır\r\nİkinci satır 😄"
  ),
  true,
  "Draft.js satır sonu ve boşluk farkları aynı mesajı başarısız göstermemeli"
);
assert.equal(
  context.api.composerTextMatches("Farklı mesaj", "Beklenen mesaj"),
  false
);

{
  const setComposerTextSource = extractFunction("setComposerText");
  const sendProfileDmSource = extractFunction("sendProfileDm");
  assert.doesNotMatch(
    setComposerTextSource,
    /element\.textContent\s*=\s*value/,
    "Draft.js DOM metni doğrudan zorlanmamalı"
  );
  assert.match(setComposerTextSource, /method: "execCommand-insertText"/);
  assert.match(setComposerTextSource, /new ClipboardEvent\("paste"/);
  assert.match(setComposerTextSource, /await waitFor\(/);
  assert.doesNotMatch(
    sendProfileDmSource,
    /sendWithEnter\(/,
    "Gönder düğmesi yokken yapay Enter kullanılmamalı"
  );
  assert.doesNotMatch(
    sendProfileDmSource,
    /await delay\(1000\)/,
    "Metin kabul edildikten sonra kısa ömürlü sohbet penceresi bir saniye bekletilmemeli"
  );
  assert.match(sendProfileDmSource, /findMessagePageError\(\).*return \{ pageError: true \}/s);
  assert.match(source, /BTG_PREPARE_PROFILE_DM/);
  assert.match(source, /BTG_VERIFY_PROFILE_DM_TEXT/);
  assert.match(source, /BTG_VERIFY_PROFILE_DM_SENT/);
  assert.match(source, /messageButtonPoint: getTopViewportPoint\(button\)/);
  assert.match(source, /type: "BTG_ACTIVATE_CONTROLLER"/);
  assert.match(source, /Canlı yayın sekmesine dönülüyor/);
  assert.match(source, /await interruptibleDelay\(500\)/);
}

console.log("TikTok profil, LIVE ve DM DOM testleri geçti.");

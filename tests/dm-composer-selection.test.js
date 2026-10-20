const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Bu test, gerçek bir TikTok DM sayfası kaydından (26.08.2026) doğrulanan bir
// hatayı yeniden üretir: TikTok'un mesaj kutusu çevirisi bozulduğunda
// (yer tutucu "Bir mesaj yazın" yerine ham "im_hint_send_msg" anahtarını
// gösterdiğinde), gerçek contenteditable yazı alanının aria-label'ı da bu ham
// anahtarı taşıyordu. Eskiden findDmComposer() bu durumda yazı alanını değil,
// onu saran ve data-e2e'sinde "message" geçen kapsayıcı öğeyi seçiyordu;
// kapsayıcının içindeki yer tutucu metni okunca "kullanıcı zaten yazmış"
// sanılıp gönderim boşuna durduruluyordu.

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

class MockNode {
  constructor(tagName, attributes = {}, text = "", rect = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.ownText = text;
    this.rect = { left: 0, top: 0, width: 200, height: 40, ...rect };
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

  contains(other) {
    if (other === this) return true;
    return this.children.some((child) => child.contains(other));
  }

  descendants() {
    const all = [];
    for (const child of this.children) all.push(child, ...child.descendants());
    return all;
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

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelectorList(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

class MockTextArea extends MockNode {}
class MockInput extends MockNode {}

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

const domState = { root: new MockNode("body") };
const context = {
  console,
  window: { innerWidth: 900, innerHeight: 800 },
  document: {
    querySelector: (selector) => domState.root.querySelector(selector),
    querySelectorAll: (selector) => domState.root.querySelectorAll(selector)
  },
  Element: MockNode,
  HTMLElement: MockNode,
  HTMLTextAreaElement: MockTextArea,
  HTMLInputElement: MockInput,
  getComputedStyle: (element) => element?.style || { visibility: "visible", display: "block", opacity: "1" }
};
vm.createContext(context);

vm.runInContext(
  [
    extractFunction("findDmComposer"),
    extractFunction("scoreComposer"),
    extractFunction("isVisible"),
    extractFunction("readComposerText"),
    extractFunction("compactText")
  ].join("\n"),
  context
);

const findComposer = vm.runInContext("findDmComposer", context);
const scoreComposer = vm.runInContext("scoreComposer", context);
const readComposerText = vm.runInContext("readComposerText", context);
const compactText = vm.runInContext("compactText", context);

// --- 1) Gerçek TikTok kaydındaki bozuk çeviri durumu ------------------------
// (data-e2e="message-input-area" kapsayıcısı, içinde ham "im_hint_send_msg"
// yer tutucusu ve aria-label'ı da aynı ham anahtarı taşıyan boş yazı alanı.)

function buildBrokenTranslationDom() {
  const container = new MockNode(
    "div",
    { "data-e2e": "message-input-area" },
    "",
    { left: 660, top: 680, width: 220, height: 44 }
  );
  const editorWrap = new MockNode("div", { "data-e2e": "dm-new-input-editor" });
  const placeholderRoot = new MockNode("div", { class: "public-DraftEditorPlaceholder-root" });
  const placeholderInner = new MockNode(
    "div",
    { class: "public-DraftEditorPlaceholder-inner" },
    "im_hint_send_msg"
  );
  placeholderRoot.append(placeholderInner);

  const editorContainer = new MockNode("div", { class: "DraftEditor-editorContainer" });
  const leaf = new MockNode(
    "div",
    {
      contenteditable: "true",
      role: "textbox",
      "aria-label": "im_hint_send_msg",
      "aria-describedby": "placeholder-5vdl2",
      class: "notranslate public-DraftEditor-content"
    },
    "",
    { left: 664, top: 684, width: 210, height: 36 }
  );
  editorContainer.append(leaf);
  editorWrap.append(placeholderRoot, editorContainer);
  container.append(editorWrap);

  const chatBottom = new MockNode("div", { "data-e2e": "dm-new-chat-bottom" });
  chatBottom.append(container);
  const root = new MockNode("body");
  root.append(chatBottom);
  return { root, container, leaf };
}

const broken = buildBrokenTranslationDom();
domState.root = broken.root;

const resolved = findComposer();
assert.equal(
  resolved,
  broken.leaf,
  "Çeviri bozulduğunda bile gerçek yazılabilir öğe (kapsayıcı değil) seçilmeli"
);
assert.notEqual(
  resolved,
  broken.container,
  "data-e2e'sinde \"message\" geçen kapsayıcı asla composer olarak seçilmemeli"
);

assert.ok(
  scoreComposer(broken.leaf) > scoreComposer(broken.container),
  "Gerçek yazı alanı, etiketi bozuk olsa bile kapsayıcıdan yüksek puan almalı"
);

const leafText = readComposerText(resolved);
assert.equal(
  compactText(leafText),
  "",
  "Doğru öğeden okunduğunda kutu boş sayılmalı; yer tutucu metni karışmamalı"
);

// Yanlış (kapsayıcı) öğeden okunsaydı ham yer tutucu metni sızardı — bu,
// önceki hatanın tam mekanizmasını belgeler.
assert.match(
  compactText(readComposerText(broken.container)),
  /im_hint_send_msg/,
  "Kapsayıcıdan okumanın neden yanlış olduğu: yer tutucu metnini de içeriyor"
);

// --- 2) Çeviri bozuk değilken de aynı sonuç (regresyon güvenliği) ----------

function buildHealthyTranslationDom() {
  const container = new MockNode(
    "div",
    { "data-e2e": "message-input-area" },
    "",
    { left: 660, top: 680, width: 220, height: 44 }
  );
  const editorWrap = new MockNode("div", { "data-e2e": "dm-new-input-editor" });
  const editorContainer = new MockNode("div", { class: "DraftEditor-editorContainer" });
  const leaf = new MockNode(
    "div",
    { contenteditable: "true", role: "textbox", "aria-label": "Bir mesaj yazın" },
    "",
    { left: 664, top: 684, width: 210, height: 36 }
  );
  editorContainer.append(leaf);
  editorWrap.append(editorContainer);
  container.append(editorWrap);
  const chatBottom = new MockNode("div", { "data-e2e": "dm-new-chat-bottom" });
  chatBottom.append(container);
  const root = new MockNode("body");
  root.append(chatBottom);
  return { root, container, leaf };
}

const healthy = buildHealthyTranslationDom();
domState.root = healthy.root;
assert.equal(
  findComposer(),
  healthy.leaf,
  "Çeviri sağlamken de gerçek yazı alanı seçilmeli"
);

// --- 3) Sarmalayan kapsayıcı olmayan tek başına giriş alanı ---------------
// (Eski/basit arayüzde tek aday varsa ata-eleme onu yanlışlıkla elemesin.)

function buildStandaloneInputDom() {
  const input = new MockInput(
    "input",
    { placeholder: "Mesaj yaz", type: "text" },
    "",
    { left: 664, top: 684, width: 300, height: 36 }
  );
  const root = new MockNode("body");
  root.append(input);
  return { root, input };
}

const standalone = buildStandaloneInputDom();
domState.root = standalone.root;
assert.equal(
  findComposer(),
  standalone.input,
  "Tek başına duran giriş alanı ata-eleme yüzünden kaybolmamalı"
);

console.log("DM yazı alanı seçimi (bozuk çeviri) regresyon testleri geçti.");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/ui/popup-layout.js"), "utf8");
const STORAGE_KEY = "btg.popup.layout";
const panelIds = ["flowPanel", "messagesPanel", "recordsPanel"];
const messageIds = ["message", "message2", "message3"];
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({ saved = {}, delayed = false, rejected = false } = {}) {
  const nodes = new Map();
  const writes = [];
  const reads = [];
  let document;
  let resolveRestore;

  function node(id, extra = {}) {
    const attributes = new Map();
    const listeners = new Map();
    const element = {
      id, value: "", textContent: "", hidden: false, checked: false,
      tabIndex: -1, dataset: {}, style: {},
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      focus() { document.activeElement = this; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      ...extra
    };
    element.fire = (type, extraEvent = {}) => {
      const event = {
        target: element, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...extraEvent
      };
      for (const listener of listeners.get(type) || []) listener(event);
      return event;
    };
    nodes.set(id, element);
    return element;
  }

  const content = node("workspaceContent", { scrollTop: 0 });
  const tabs = panelIds.map((id, index) => {
    node(id, { hidden: index !== 0 });
    const tab = node(`${id}Tab`, { dataset: { panel: id }, tabIndex: index === 0 ? 0 : -1 });
    tab.setAttribute("aria-selected", String(index === 0));
    return tab;
  });
  const originals = ["  Selamlar,\nBirinci mesaj.  ", "İkinci mesaj\n\nBTG desteği.", "  "];
  const variants = messageIds.map((id, index) => {
    const textarea = node(id, { value: originals[index], style: { height: "127px" } });
    const editor = node(`${id}Editor`);
    const toggle = node(`${id}Toggle`);
    toggle.setAttribute("aria-controls", editor.id);
    const preview = node(`${id}Preview`, { hidden: true });
    const label = node(`${id}Label`, { textContent: `Mesaj ${index + 1}` });
    return node(`${id}Variant`, {
      dataset: { message: id },
      querySelector(selector) {
        return { textarea, "[data-message-toggle]": toggle, ".message-preview": preview, label }[selector] || null;
      }
    });
  });

  node("messageSize", { value: "compact" });
  node("foldAllMessages", { textContent: "Tümünü katla" });
  node("maxPerSession", { value: "50" });
  const modes = ["live", "mobile", "manual", "collect"].map((value, index) => node(`mode-${value}`, { value, checked: index === 0 }));
  for (const id of ["operationSummary", "messageUnavailable", "messageGroup", "activityText", "timingText", "activityDetailsText", "activityDetails"]) node(id);
  const toolsButtons = [node("teamPlanButton"), node("outputFolderButton")];
  const toolsSummary = node("toolsSummary");
  const tools = node("toolsMenu", {
    open: false,
    querySelector: selector => selector === "summary" ? toolsSummary : null,
    querySelectorAll: selector => selector === "button" ? toolsButtons : [],
    contains: element => element === tools || element === toolsSummary || toolsButtons.includes(element)
  });
  const rootStyle = { "--message-height": "52px" };
  document = node("document", {
    activeElement: null,
    documentElement: { style: { setProperty(name, value) { rootStyle[name] = value; } } },
    getElementById: id => nodes.get(id) || null,
    querySelector(selector) {
      if (selector === ".workspace-content") return content;
      if (selector === ".tools-menu") return tools;
      if (selector === "input[name='mode']:checked") return modes.find(mode => mode.checked);
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".section-tabs [role='tab']") return tabs;
      if (selector === ".message-variant") return variants;
      if (selector === "input[name='mode'], #maxPerSession") return [...modes, nodes.get("maxPerSession")];
      return [];
    }
  });
  const getResult = delayed
    ? new Promise(resolve => { resolveRestore = resolve; })
    : rejected ? Promise.reject(new Error("Storage unavailable")) : Promise.resolve(saved);
  const context = {
    document, window: {}, chrome: { storage: { local: {
      get(key) { reads.push(key); return getResult; },
      set(patch) { writes.push(JSON.parse(JSON.stringify(patch))); return Promise.resolve(); }
    } } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    get: id => nodes.get(id), tabs, content, originals, document, rootStyle, reads, writes,
    restore(value) { resolveRestore(value); },
    lastSaved() { return writes.at(-1)?.[STORAGE_KEY]; }
  };
}

function assertPanel(f, selected) {
  for (const tab of f.tabs) {
    const active = tab.dataset.panel === selected;
    assert.equal(tab.getAttribute("aria-selected"), String(active));
    assert.equal(tab.tabIndex, active ? 0 : -1);
    assert.equal(f.get(tab.dataset.panel).hidden, !active);
  }
}

function assertFold(f, id, folded) {
  assert.equal(f.get(`${id}Editor`).hidden, folded);
  assert.equal(f.get(`${id}Preview`).hidden, !folded);
  assert.equal(f.get(`${id}Toggle`).getAttribute("aria-expanded"), String(!folded));
}

test("Restores a valid panel, size and known folded messages without rewriting storage", async () => {
  const f = fixture({ saved: { [STORAGE_KEY]: {
    panel: "messagesPanel", messageSize: "large", folded: ["message", "unknown", "message3", "message"]
  } } });
  await settle();
  assert.deepEqual(f.reads, [STORAGE_KEY]);
  assertPanel(f, "messagesPanel");
  assert.equal(f.get("messageSize").value, "large");
  assert.equal(f.rootStyle["--message-height"], "150px");
  assertFold(f, "message", true);
  assertFold(f, "message2", false);
  assertFold(f, "message3", true);
  assert.equal(f.get("messagePreview").textContent, "Selamlar, Birinci mesaj.");
  assert.equal(f.get("message3Preview").textContent, "Boş mesaj · gönderimde kullanılmaz");
  assert.equal(f.writes.length, 0);
});

test("Panel, size and fold interactions each prevent a delayed restore from replacing the user's choice", async () => {
  const stale = { [STORAGE_KEY]: { panel: "recordsPanel", messageSize: "large", folded: messageIds } };
  for (const interaction of ["panel", "size", "fold"]) {
    const f = fixture({ delayed: true });
    if (interaction === "panel") f.tabs[1].fire("click");
    if (interaction === "size") {
      f.get("messageSize").value = "normal";
      f.get("messageSize").fire("change");
    }
    if (interaction === "fold") f.get("message2Toggle").fire("click");
    const expected = f.lastSaved();
    f.restore(stale);
    await settle();
    assertPanel(f, expected.panel);
    assert.equal(f.get("messageSize").value, expected.messageSize);
    assert.equal(f.rootStyle["--message-height"], interaction === "size" ? "94px" : "52px");
    for (const id of messageIds) {
      // Panels and size can be used before the first fold render.
      if (interaction === "fold") assertFold(f, id, expected.folded.includes(id));
      else assert.equal(f.get(`${id}Editor`).hidden, false);
    }
    assert.deepEqual(f.lastSaved(), expected);
    assert.equal(f.writes.length, 1);
  }
});

test("Invalid or unavailable storage keeps safe defaults and controls remain usable", async () => {
  const corrupt = [
    {},
    { [STORAGE_KEY]: null },
    { [STORAGE_KEY]: "not an object" },
    { [STORAGE_KEY]: { panel: "__proto__", messageSize: "toString", folded: "message" } },
    { [STORAGE_KEY]: { panel: 42, messageSize: {}, folded: [null, 7, "missing"] } },
    null
  ];
  for (const saved of corrupt) {
    const f = fixture({ saved });
    await settle();
    assertPanel(f, "flowPanel");
    assert.equal(f.get("messageSize").value, "compact");
    assert.equal(f.rootStyle["--message-height"], "52px");
    for (const id of messageIds) assert.equal(f.get(`${id}Editor`).hidden, false);
    assert.equal(f.writes.length, 0);
    f.tabs[2].fire("click");
    assertPanel(f, "recordsPanel");
    assert.equal(f.lastSaved().panel, "recordsPanel");
  }
  const rejected = fixture({ rejected: true });
  await settle();
  rejected.get("foldAllMessages").fire("click");
  for (const id of messageIds) assertFold(rejected, id, true);
  assert.deepEqual(rejected.lastSaved().folded, messageIds);
});

test("Resizing, folding individual messages and folding all retain exact textarea contents", async () => {
  const f = fixture();
  await settle();
  const contents = () => messageIds.map(id => f.get(id).value);
  for (const [size, height] of [["large", "150px"], ["normal", "94px"], ["compact", "52px"]]) {
    f.get("messageSize").value = size;
    f.get("messageSize").fire("change");
    assert.equal(f.rootStyle["--message-height"], height);
    for (const id of messageIds) assert.equal(f.get(id).style.height, "");
    assert.deepEqual(contents(), f.originals);
  }
  f.get("messageToggle").fire("click");
  assertFold(f, "message", true);
  assertFold(f, "message2", false);
  assert.deepEqual(contents(), f.originals);
  f.get("foldAllMessages").fire("click");
  for (const id of messageIds) assertFold(f, id, true);
  assert.equal(f.get("foldAllMessages").textContent, "Tümünü aç");
  assert.equal(f.get("foldAllMessages").getAttribute("aria-expanded"), "false");
  assert.deepEqual(f.lastSaved().folded, messageIds);
  assert.deepEqual(contents(), f.originals);
  f.get("foldAllMessages").fire("click");
  for (const id of messageIds) assertFold(f, id, false);
  assert.equal(f.get("foldAllMessages").textContent, "Tümünü katla");
  assert.equal(f.get("foldAllMessages").getAttribute("aria-expanded"), "true");
  assert.deepEqual(f.lastSaved().folded, []);
  assert.deepEqual(contents(), f.originals);
});

test("Arrow keys wrap, Home and End select and focus tabs, and unrelated keys leave state alone", async () => {
  const f = fixture();
  await settle();
  const moves = [
    [0, "ArrowRight", 1],
    [1, "ArrowRight", 2],
    [2, "ArrowRight", 0],
    [0, "ArrowLeft", 2],
    [2, "Home", 0],
    [0, "End", 2]
  ];
  for (const [from, key, to] of moves) {
    const event = f.tabs[from].fire("keydown", { key });
    assert.equal(event.defaultPrevented, true);
    assertPanel(f, panelIds[to]);
    assert.equal(f.document.activeElement, f.tabs[to]);
    assert.equal(f.lastSaved().panel, panelIds[to]);
  }
  const count = f.writes.length;
  const event = f.tabs[2].fire("keydown", { key: "Tab" });
  assert.equal(event.defaultPrevented, false);
  assertPanel(f, "recordsPanel");
  assert.equal(f.writes.length, count);
});

test("Returning to a panel restores that panel's scroll position", async () => {
  const f = fixture();
  await settle();
  f.content.scrollTop = 125;
  f.tabs[1].fire("click");
  assert.equal(f.content.scrollTop, 0);
  f.content.scrollTop = 240;
  f.tabs[0].fire("click");
  assert.equal(f.content.scrollTop, 125);
  f.tabs[1].fire("click");
  assert.equal(f.content.scrollTop, 240);
});

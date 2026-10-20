(() => {
  "use strict";
  const STORAGE_KEY = "btg.popup.layout";
  const tabs = [...document.querySelectorAll(".section-tabs [role='tab']")];
  const variants = [...document.querySelectorAll(".message-variant")];
  const content = document.querySelector(".workspace-content");
  const sizePicker = document.getElementById("messageSize");
  const foldAllButton = document.getElementById("foldAllMessages");
  const panelIds = tabs.map(tab => tab.dataset.panel);
  const heights = { compact: 52, normal: 94, large: 150 };
  const state = { panel: "flowPanel", messageSize: "compact", folded: [] };
  const scrollPositions = new Map();
  let interacted = false;

  function save() {
    interacted = true;
    chrome.storage.local.set({ [STORAGE_KEY]: { ...state, folded: [...state.folded] } }).catch(() => {});
  }

  function selectPanel(id) {
    if (!panelIds.includes(id)) return;
    scrollPositions.set(state.panel, content.scrollTop);
    state.panel = id;
    for (const tab of tabs) {
      const selected = tab.dataset.panel === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.dataset.panel).hidden = !selected;
    }
    content.scrollTop = scrollPositions.get(id) || 0;
  }

  function setSize(value) {
    if (!Object.hasOwn(heights, value)) return;
    state.messageSize = value;
    sizePicker.value = value;
    document.documentElement.style.setProperty("--message-height", `${heights[value]}px`);
    for (const variant of variants) variant.querySelector("textarea").style.height = "";
  }

  function renderFolds() {
    for (const variant of variants) {
      const id = variant.dataset.message;
      const folded = state.folded.includes(id);
      const toggle = variant.querySelector("[data-message-toggle]");
      const preview = variant.querySelector(".message-preview");
      const label = variant.querySelector("label").textContent;
      document.getElementById(toggle.getAttribute("aria-controls")).hidden = folded;
      preview.hidden = !folded;
      preview.textContent = document.getElementById(id).value.trim().replace(/\s+/g, " ") || "Boş mesaj · gönderimde kullanılmaz";
      toggle.setAttribute("aria-expanded", String(!folded));
      toggle.setAttribute("aria-label", `${label} alanını ${folded ? "aç" : "katla"}`);
    }
    const allFolded = variants.every(variant => state.folded.includes(variant.dataset.message));
    foldAllButton.textContent = allFolded ? "Tümünü aç" : "Tümünü katla";
    foldAllButton.setAttribute("aria-expanded", String(!allFolded));
  }

  function refresh() {
    renderFolds();
    const names = { live: "CANLI", mobile: "Mobil", manual: "Liste", collect: "İsim toplama", personal: "Kişisel mesaj" };
    const mode = document.querySelector("input[name='mode']:checked")?.value || "live";
    const limit = document.getElementById("maxPerSession").value;
    const tikleap = mode === "personal" && document.getElementById("personalSource")?.value === "tikleap";
    document.getElementById("operationSummary").textContent = [names[mode], tikleap ? "Tikleap" : limit ? `${limit} kişi` : ""].filter(Boolean).join(" · ");
    const unavailable = document.getElementById("messageUnavailable");
    unavailable.hidden = !document.getElementById("messageGroup").hidden;
    unavailable.textContent = mode === "collect"
      ? "İsim toplama akışında DM gönderilmez. Uygun yayıncılar Excel’e kaydedilir."
      : mode === "personal"
        ? "Kişisel mesaj akışında DM gönderilmez. Mesajları model yazar; gönderim Listeden Kontrol’deki özel davet Excel’i ile yapılır."
      : "Bu listede kişiye özel Excel mesajları kullanılıyor. Ortak mesajlara dönmek için Akış sekmesindeki özel mesajları kaldırın.";
    const activity = document.getElementById("activityText").textContent;
    document.getElementById("activityDetailsText").textContent = activity;
    document.getElementById("activityDetails").hidden = !activity && !document.getElementById("timingText").textContent;
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => { selectPanel(tab.dataset.panel); save(); });
    tab.addEventListener("keydown", event => {
      const index = tabs.indexOf(tab);
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      selectPanel(tabs[next].dataset.panel);
      tabs[next].focus();
      save();
    });
  }
  sizePicker.addEventListener("change", () => { setSize(sizePicker.value); save(); });
  for (const variant of variants) {
    const id = variant.dataset.message;
    variant.querySelector("[data-message-toggle]").addEventListener("click", () => {
      state.folded = state.folded.includes(id) ? state.folded.filter(value => value !== id) : [...state.folded, id];
      renderFolds();
      save();
    });
    document.getElementById(id).addEventListener("input", renderFolds);
  }
  foldAllButton.addEventListener("click", () => {
    state.folded = variants.every(variant => state.folded.includes(variant.dataset.message)) ? [] : variants.map(variant => variant.dataset.message);
    renderFolds();
    save();
  });
  for (const input of document.querySelectorAll("input[name='mode'], #maxPerSession")) input.addEventListener("input", refresh);

  const tools = document.querySelector(".tools-menu");
  tools.querySelectorAll("button").forEach(button => button.addEventListener("click", () => { tools.open = false; }));
  document.addEventListener("click", event => { if (!tools.contains(event.target)) tools.open = false; });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && tools.open) { tools.open = false; tools.querySelector("summary").focus(); }
  });

  window.BTGPopupLayout = { refresh };
  chrome.storage.local.get(STORAGE_KEY).then(saved => {
    if (interacted) return;
    const restored = saved[STORAGE_KEY] || {};
    if (panelIds.includes(restored.panel)) selectPanel(restored.panel);
    if (Object.hasOwn(heights, restored.messageSize)) setSize(restored.messageSize);
    if (Array.isArray(restored.folded)) state.folded = variants.map(variant => variant.dataset.message).filter(id => restored.folded.includes(id));
    refresh();
  }).catch(() => {});
})();

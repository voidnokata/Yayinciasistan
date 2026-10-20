const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/background/background.js"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);
const stored = {
  settings: {},
  runtime: {
    running: false,
    processed: [
      { username: "ipekcedin", result: "dm_failed", time: "2026-07-28T12:32:21.468Z" },
      { username: "smy1243", result: "not_eligible", time: "2026-07-28T12:30:19.066Z" }
    ]
  },
  publisherHistory: {
    entries: {
      ipekcedin: {
        username: "ipekcedin",
        result: "dm_failed",
        checkedAt: "2026-07-28T12:32:21.468Z"
      },
      smy1243: {
        username: "smy1243",
        result: "not_eligible",
        checkedAt: "2026-07-28T12:30:19.066Z"
      },
      basarili: {
        username: "basarili",
        result: "sent",
        checkedAt: "2026-07-28T12:20:00.000Z"
      }
    },
    updatedAt: "2026-07-28T12:32:21.468Z"
  }
};

let installedListener;
let lastProbeMessage;
const context = {
  console,
  URL,
  setTimeout,
  clearTimeout,
  chrome: {
    runtime: {
      onInstalled: { addListener: (listener) => { installedListener = listener; } },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} }
    },
    storage: {
      local: {
        get: async () => structuredClone(stored),
        set: async (patch) => Object.assign(stored, structuredClone(patch))
      }
    },
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0, url: "https://www.tiktok.com/messages" }]
    },
    tabs: {
      sendMessage: async (_tabId, message) => {
        lastProbeMessage = message;
        return { ok: true, hasComposer: false, pageError: true };
      }
    }
  }
};

vm.runInNewContext(source, context);
assert.equal(typeof installedListener, "function");

(async () => {
  stored.runtime.processed.push({
    username: "flamefrags082",
    result: "profile_load_failed",
    time: "2026-07-29T06:22:44.337Z"
  });
  stored.publisherHistory.entries.flamefrags082 = {
    username: "flamefrags082",
    result: "profile_load_failed",
    checkedAt: "2026-07-29T06:22:44.337Z"
  };
  stored.runtime.processed.push({
    username: "wessros",
    result: "business_redirect",
    time: "2026-07-29T06:38:10.808Z"
  });
  stored.publisherHistory.entries.wessros = {
    username: "wessros",
    result: "business_redirect",
    checkedAt: "2026-07-29T06:38:10.808Z"
  };
  stored.runtime.processed.push({
    username: "omr34340",
    result: "dm_surface",
    time: "2026-07-29T06:45:00.000Z"
  });
  stored.publisherHistory.entries.omr34340 = {
    username: "omr34340",
    result: "dm_surface",
    checkedAt: "2026-07-29T06:45:00.000Z"
  };

  await installedListener({ reason: "update", previousVersion: "0.1.27" });

  assert.equal(
    Object.prototype.hasOwnProperty.call(stored.publisherHistory.entries, "ipekcedin"),
    false,
    "eski dm_failed kaydı kaldırılmalı"
  );
  assert.equal(stored.publisherHistory.entries.smy1243.result, "not_eligible");
  assert.equal(stored.publisherHistory.entries.basarili.result, "sent");
  assert.equal(
    Object.prototype.hasOwnProperty.call(stored.publisherHistory.entries, "flamefrags082"),
    false,
    "eski profile_load_failed kaydı kaldırılmalı"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(stored.publisherHistory.entries, "wessros"),
    false,
    "eski business_redirect kaydı kaldırılmalı"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(stored.publisherHistory.entries, "omr34340"),
    false,
    "eski dm_surface kaydı kaldırılmalı"
  );
  assert.deepEqual(
    stored.runtime.processed.map((item) => item.result),
    ["not_eligible"],
    "çalışma listesindeki dm_failed kaydı da geri eklenmemeli"
  );

  stored.runtime = {
    ...stored.runtime,
    running: true,
    mode: "manual",
    controllerTabId: 404,
    backstageTabId: 78,
    sent: 1,
    listIndex: 2,
    listTotal: 85,
    status: "[2/85] @ornek uygun; Backstage sohbetinden mesaj gönderiliyor"
  };
  await installedListener({ reason: "update", previousVersion: "0.4.4" });
  assert.equal(stored.runtime.running, false);
  assert.equal(stored.runtime.sent, 1, "yeniden yükleme doğrulanmış sayacı korumalı");
  assert.equal(stored.runtime.listIndex, 2, "yeniden yükleme liste ilerlemesini korumalı");
  assert.match(stored.runtime.status, /yarım kalan işlem/);

  stored.runtime = {
    ...stored.runtime,
    running: true,
    controllerTabId: 404,
    lastActivityAt: new Date().toISOString()
  };
  context.chrome.tabs.get = async () => { throw new Error("No tab"); };
  const reconciled = await context.getState();
  assert.equal(reconciled.runtime.running, false);
  assert.equal(reconciled.runtime.sent, 1);
  assert.match(reconciled.runtime.status, /artık açık değil/);

  assert.match(source, /BTG_CONTROLLER_PING/);
  assert.match(source, /chrome\.tabs\?\.onRemoved\?\.addListener/);

  assert.equal(context.isForYouUrl("https://www.tiktok.com/"), true);
  assert.equal(context.isForYouUrl("https://www.tiktok.com/foryou"), true);
  assert.equal(context.isForYouUrl("https://www.tiktok.com/tr-TR/"), true);
  assert.equal(context.isForYouUrl("https://www.tiktok.com/@chenzy.exe/live"), false);
  assert.equal(context.sanitizeSettings({ mode: "foryou" }).mode, "foryou");
  assert.equal(context.sanitizeSettings({ mode: "list" }).mode, "list");
  assert.equal(context.sanitizeSettings({ mode: "mobile" }).mode, "mobile");
  assert.equal(context.sanitizeSettings({ mode: "manual" }).mode, "manual");
  assert.equal(context.sanitizeSettings({ mode: "live", liveProfileMessaging: true }).liveProfileMessaging, true);
  assert.equal(context.sanitizeSettings({ mode: "manual", liveProfileMessaging: true }).liveProfileMessaging, true);
  assert.equal(context.sanitizeSettings({ mode: "collect", liveProfileMessaging: true }).liveProfileMessaging, false);
  assert.equal(context.usesBackstageInstantMessages("manual", false), true);
  assert.equal(context.usesBackstageInstantMessages("manual", true), false);
  const noticeInput = { mode: "manual", usePersonalizedMessages: true, personalizedMessages: { star_one: "Selamlar" }, existingCreatorNotice: true };
  assert.equal(context.sanitizeSettings(noticeInput).existingCreatorNotice, true);
  assert.equal(context.sanitizeSettings({ ...noticeInput, liveProfileMessaging: true }).existingCreatorNotice, false);
  assert.equal(context.sanitizeSettings({ ...noticeInput, usePersonalizedMessages: false }).existingCreatorNotice, false);
  assert.equal(context.sanitizeSettings({ ...noticeInput, mode: "live" }).existingCreatorNotice, false);
  assert.equal(context.isExistingCreatorNoticeRun({ mode: "manual", existingCreatorNotice: true }), true);
  assert.equal(context.isExistingCreatorNoticeRun({ mode: "manual", existingCreatorNotice: true, liveProfileMessaging: true }), false);
  assert.equal(context.isExistingCreatorNoticeRun({ mode: "live", existingCreatorNotice: true }), false);
  assert.equal(context.sanitizeSettings({ mode: "bilinmeyen" }).mode, "live");
  assert.deepEqual(
    Array.from(context.sanitizeSettings({
      mode: "list",
      listUsernames: ["@ornek", "ORNEK", "gecersiz isim", "ikinci.kisi"]
    }).listUsernames),
    ["ornek", "ikinci.kisi"]
  );
  assert.deepEqual(
    Array.from(context.sanitizeSettings({
      mode: "manual",
      listUsernames: ["resool0728\u200b", "miar_mobel\ufeff", "@miranalan21"] ,
      manualUsernamesText: "resool0728\nmiar_mobel\nmiranalan21"
    }).listUsernames),
    ["resool0728", "miar_mobel", "miranalan21"]
  );
  assert.equal(context.isListControllerUrl("https://www.tiktok.com/"), true);
  assert.equal(context.isListControllerUrl("https://www.tiktok.com/@ornek"), true);
  assert.equal(context.isListControllerUrl("https://www.tiktok.com/messages"), false);
  assert.equal(context.isListControllerUrl("https://live-backstage.tiktok.com/portal/anchor/relation"), false);
  assert.doesNotMatch(
    source,
    /DM_INITIAL_WARMUP_MS/,
    "DM arayüzü için sabit 10 saniyelik bekleme kalmamalı; mesaj kutusu araması yoklayarak bekler"
  );

  const probeStartedAt = Date.now();
  const surface = await context.findTikTokDmSurface(1, 20, "dll.luis");
  assert.equal(surface.pageError, true);
  assert.equal(lastProbeMessage.username, "dll.luis");
  assert.ok(
    Date.now() - probeStartedAt >= 200,
    "geçici sayfa hatası yüzey aramasını anında bitirmemeli"
  );

  assert.match(source, /navigateToPreferredDmTarget\(\s*profileTab\.id,\s*openResult\.destinationUrl/s);
  assert.match(source, /chrome\.tabs\.update\(tabId, \{ url, active: true \}\)/);
  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /Input\.insertText/);
  assert.match(source, /Input\.dispatchKeyEvent/);
  assert.match(source, /chrome\.debugger\.detach/);
  assert.match(source, /route: "business-suite"/);
  assert.match(source, /route: "normal"/);
  assert.match(source, /recoveryUrl: normalUrl\.href/);
  assert.match(source, /clickProfileMessageAndWait/);
  assert.match(
    source,
    /await waitForMessagesUrl\(\s*tabId,\s*PROFILE_MESSAGE_CLICK_URL_TIMEOUT_MS,\s*PROFILE_MESSAGE_CLICK_SETTLE_TIMEOUT_MS\s*\)/
  );
  assert.match(
    source,
    /clickProfileMessageAndWait\(\s*tabId,\s*result\.messageButtonPoint/,
    "Yedek tıklama yeniden okunan düğme konumunu kullanmalı"
  );
  assert.doesNotMatch(
    source,
    /chrome\.tabs\.update\(profileTab\.id, \{ active: true \}\);\s+await delay\(300\);/,
    "Öne açılan profil sekmesi ikinci kez etkinleştirilip bekletilmemeli"
  );
  assert.match(source, /chrome\.tabs\.update\(profileTab\.id, \{ url: profileUrl, active: true \}\)/);
  assert.match(source, /closeProfileAndRestoreController\(profileTab\.id, controllerTabId\)/);
  assert.match(source, /case "BTG_ACTIVATE_CONTROLLER":/);
  assert.ok(manifest.permissions.includes("debugger"));
  assert.equal(
    context.isBusinessSuiteMessagesUrl(
      "https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=1"
    ),
    true
  );
  assert.equal(
    context.isBusinessSuiteMessagesUrl("https://www.tiktok.com/messages?lang=tr-TR"),
    false
  );
  assert.equal(
    context.isNormalMessagesUrl("https://www.tiktok.com/messages?lang=tr-TR"),
    true
  );
  assert.equal(
    context.isNormalMessagesUrl(
      "https://www.tiktok.com/business-suite/messages?from=homepage"
    ),
    false
  );

  const debuggerCommands = [];
  let debuggerAttached = false;
  let debuggerDetached = false;
  context.chrome.debugger = {
    attach: async () => {
      debuggerAttached = true;
    },
    sendCommand: async (_debuggee, method, params) => {
      debuggerCommands.push({ method, params });
    },
    detach: async () => {
      debuggerDetached = true;
    }
  };
  context.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type === "BTG_PREPARE_PROFILE_DM") {
      return {
        ok: true,
        ready: true,
        textReady: false,
        point: { x: 640, y: 820 }
      };
    }
    if (message.type === "BTG_VERIFY_PROFILE_DM_TEXT") {
      return { ok: true, textReady: true, currentLength: 437 };
    }
    if (message.type === "BTG_VERIFY_PROFILE_DM_SENT") {
      return { ok: true, verifiedInConversation: true, trustedInput: true };
    }
    return { ok: false, error: "Beklenmeyen test mesajı" };
  };

  const trustedResult = await context.sendDmWithTrustedInput(
    99,
    3,
    "Deneme mesajı",
    "hedef"
  );
  assert.equal(trustedResult.ok, true);
  assert.equal(debuggerAttached, true);
  assert.equal(debuggerDetached, true);
  assert.deepEqual(
    debuggerCommands.map((item) => item.method),
    [
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.insertText",
      "Input.dispatchKeyEvent",
      "Input.dispatchKeyEvent"
    ]
  );

  const tabOperations = [];
  context.chrome.tabs.get = async (tabId) => ({ id: tabId, windowId: 7 });
  context.chrome.tabs.update = async (tabId, patch) => {
    tabOperations.push({ type: "update", tabId, patch });
    return { id: tabId, ...patch };
  };
  context.chrome.tabs.remove = async (tabId) => {
    tabOperations.push({ type: "remove", tabId });
  };
  stored.runtime.controllerTabId = 42;
  const restoreResult = await context.closeProfileAndRestoreController(99, 42);
  assert.equal(restoreResult.ok, true);
  assert.equal(JSON.stringify(tabOperations), JSON.stringify([
    { type: "remove", tabId: 99 },
    { type: "update", tabId: 42, patch: { active: true } }
  ]));

  context.chrome.tabs.query = async () => [
    { id: 77, url: "https://www.tiktok.com/", active: false, lastAccessed: Date.now() - 1 },
    {
      id: 78,
      url: "https://live-backstage.tiktok.com/portal/anchor/relation",
      active: true,
      lastAccessed: Date.now()
    }
  ];
  context.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type === "BTG_START_CONTROLLER") return { ok: true };
    if (message.type === "BTG_BACKSTAGE_PING") return { ok: true, ready: true, busy: false };
    return { ok: false, error: "Beklenmeyen test mesajı" };
  };
  const listStart = await context.startAutomation({
    mode: "list",
    message: "Deneme",
    listUsernames: ["@birinci", "ikinci"]
  });
  assert.equal(listStart.ok, true);
  assert.equal(stored.runtime.controllerTabId, 77);
  assert.equal(stored.runtime.backstageTabId, 78);
  assert.equal(stored.runtime.listTotal, 2);

  let recoverySendCount = 0;
  let recoveryReloadCount = 0;
  context.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type !== "BTG_START_CONTROLLER") {
      return { ok: false, error: "Beklenmeyen test mesajı" };
    }
    recoverySendCount += 1;
    if (recoverySendCount === 1) {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    }
    return { ok: true };
  };
  context.chrome.tabs.reload = async () => {
    recoveryReloadCount += 1;
  };
  context.chrome.tabs.get = async (tabId) => ({ id: tabId, status: "complete", windowId: 7 });
  context.chrome.tabs.onUpdated = {
    addListener: () => {},
    removeListener: () => {}
  };
  const recoveredController = await context.startControllerWithRecovery(77, {
    mode: "mobile",
    message: "Deneme"
  });
  assert.equal(recoveredController.ok, true);
  assert.equal(recoverySendCount, 2);
  assert.equal(recoveryReloadCount, 1);

  stored.runtime.reportRows = [
    {
      order: 1,
      username: "resool0728",
      backstageResult: "Uygun değil — başka ajansta",
      outcome: "DM gönderilmedi",
      detail: "Backstage sonucu uygun değil",
      checkedAt: "2026-08-07T10:00:00.000Z"
    }
  ];
  const report = await context.exportReport();
  assert.equal(report.ok, true);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].backstageResult, "Uygun değil — başka ajansta");

  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:\.\d+)?$/);
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:8765/*"));
  const historyWithBackstage = context.mergeProcessedIntoHistory(
    { entries: {}, updatedAt: "" },
    [{ username: "kontrollu", result: "sent", time: "2026-08-05T10:00:00.000Z", backstageChecked: true }]
  );
  assert.equal(historyWithBackstage.entries.kontrollu.backstageChecked, true);

  const messagedPublishers = context.mergeProcessedIntoMessagedPublishers(
    { entries: {}, updatedAt: "" },
    [
      { username: "mesaj_gonderildi", result: "sent", time: "2026-08-05T11:00:00.000Z" },
      { username: "mesaj_dogrulandi", result: "already_sent", time: "2026-08-05T11:01:00.000Z" },
      { username: "yalniz_denendi", result: "not_eligible", time: "2026-08-05T11:02:00.000Z" }
    ]
  );
  assert.deepEqual(
    Object.keys(messagedPublishers.entries).sort(),
    ["mesaj_dogrulandi", "mesaj_gonderildi"],
    "Bağımsız defter yalnız gerçekten mesaj yazılmış hesapları içermeli"
  );
  assert.equal(messagedPublishers.entries.yalniz_denendi, undefined);
  assert.match(source, /if \(backstageRequired && !backstageTabs\.length\)/);
  console.log("0.2.4 liste girişi, Excel raporu, mobil köprü ve güvenli DM testleri geçti.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

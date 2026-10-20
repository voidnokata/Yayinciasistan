if (typeof importScripts === 'function') importScripts('/src/core/sender-guard.js', '/src/core/bridge-reply.js', '/src/core/output-folder.js', '/src/background/backstage-api.js', '/src/background/personal-package.js', '/src/core/feedback-package.js', '/src/background/feedback-queue.js', '/src/core/feedback-core.js', '/src/core/feedback-history.js', '/src/background/feedback-roster.js');
let feedbackQueueInstance;
let feedbackRosterInstance;
function getFeedbackRoster() {
  if (!feedbackRosterInstance) feedbackRosterInstance = BTGFeedbackRoster.create({
    tabs: chrome.tabs,
    commit: (rows, now) => BTGFeedbackHistory.createStore(chrome.storage.local, globalThis.navigator?.locks)
      .mutate(state => BTGFeedbackHistory.syncRoster(state, rows, now, BTGFeedback))
  });
  return feedbackRosterInstance;
}
let automationTransition = Promise.resolve();
function automationExclusive(fn) {
  const task = automationTransition.then(fn);
  automationTransition = task.catch(() => {});
  return task;
}
function getFeedbackQueue() {
  if (!feedbackQueueInstance) feedbackQueueInstance = BTGFeedbackQueue.create({
    storage: chrome.storage.local,
    validateRows: (pkg, rows) => BTGFeedbackPackage.validateRows(pkg, rows),
    send: (username, text, tabId, backstageTabId) => sendFeedbackBackstageInstantMessage(username, text, tabId, backstageTabId),
    lock: globalThis.navigator?.locks,
    pause: () => delay(5000)
  });
  return feedbackQueueInstance;
}
const DEFAULT_MESSAGE = `Merhabalar, ben Burak. Resmi bir TikTok canlı yayın ajansı olan BTG Teknoloji'de içerik operasyon uzmanı olarak görev alıyorum.

Yayıncılarımıza gelir artırma, izleyici büyütme, kısıtlama kaldırma ve teknik destek gibi bir çok konuda yardımcı oluyoruz, ayrıca bu süreçte bir komisyon almıyoruz.

Size destek sağlamak ve ekibimizde birlikte çalışmak isterim.

Eğer ilgileniyorsanız sunduğumuz avantajları detaylı olarak açıklayabilirim 😄`;

// Aynı metnin herkese birebir gitmemesi için ilk mesajın iki alternatifi.
// Her gönderimde dolu mesajlardan biri rastgele seçilir.
const DEFAULT_MESSAGE_VARIANTS = [
  DEFAULT_MESSAGE,
  `Merhaba, ben Burak. Resmi TikTok canlı yayın ajanslarından BTG Teknoloji'de içerik operasyon uzmanıyım.

Yayıncılarımıza gelirlerini artırma, izleyici kitlelerini büyütme, hesap ve yayın sorunlarını çözme ve teknik destek konularında yardımcı oluyoruz. Bu destek için herhangi bir komisyon almıyoruz.

Sizinle de çalışmak ve yayınlarınıza destek olmak isterim.

İlgilenirseniz avantajlarımızı detaylıca anlatabilirim 🙂`,
  `Selamlar, ben Burak. BTG Teknoloji resmi bir TikTok canlı yayın ajansı, ben de burada içerik operasyon uzmanı olarak çalışıyorum.

Gelir artırma, izleyici büyütme, kısıtlama sorunları ve teknik destek gibi pek çok konuda yayıncılarımızın yanındayız. Bu süreçte sizden komisyon almıyoruz.

Ekibimize katılmanızı ve size destek olmayı çok isterim.

Merak ederseniz sunduğumuz avantajları ayrıntılı şekilde anlatabilirim 😊`
];
const MAX_MESSAGE_VARIANTS = 3;

const DEFAULT_SETTINGS = {
  mode: "live",
  message: DEFAULT_MESSAGE,
  messages: DEFAULT_MESSAGE_VARIANTS,
  liveProfileMessaging: false,
  minFollowers: 0,
  requireFiveActiveDays: false,
  personalSource: "feed",
  minDelaySeconds: 4,
  maxDelaySeconds: 7,
  maxPerSession: 50,
  listUsernames: [],
  listFileName: "",
  manualUsernamesText: "",
  skipBackstageCheck: false
};

// Mesaj ekranında hedef sohbetin aranma süreleri: ilk açılışta, yerinde açma
// sonrasında ve tam yenileme sonrasında. Yenileme sonrasında ayrıca sabit
// bekleme yoktur; arama zaten yoklayarak bekler.
// Canlı ölçümde sohbet kendiliğinden açılıyorsa 3-5 saniyede açıldı; daha uzun
// beklemek yerine yerinde açma denenir.
const DM_SURFACE_SEARCH_MS = 5000;
// Mesaj düğmesi tıklaması artık yalnız doğrudan adres sohbet rotasına
// oturmadığında kullanılan yedek yoldur. Tıklamadan sonra sohbet adresinin
// görünmesi için tanınan süre ve adres göründükten sonra sayfanın yerleşmesi
// için tanınan toplam süre.
const PROFILE_MESSAGE_CLICK_URL_TIMEOUT_MS = 3000;
const PROFILE_MESSAGE_CLICK_SETTLE_TIMEOUT_MS = 12000;
const DM_SURFACE_SEARCH_AFTER_RECOVERY_MS = 5000;
const DM_SURFACE_SEARCH_AFTER_RELOAD_MS = 12000;
const MOBILE_BRIDGE_URL = "http://127.0.0.1:8765";
const MOBILE_BRIDGE_HEADERS = {
  "Content-Type": "application/json",
  "X-BTG-Mobile-Bridge": "1"
};

const EMPTY_RUNTIME = {
  running: false,
  status: "Hazır",
  lastStep: "",
  lastActivityAt: "",
  lastError: "",
  currentUsername: "",
  sent: 0,
  skipped: 0,
  failed: 0,
  processed: [],
  reportRows: [],
  collectionRows: [],
  personalRows: [],
  personalSeen: [],
  personalDeferred: [],
  personalQueue: [],
  personalEligible: [],
  mode: "",
  liveProfileMessaging: false,
  logs: [],
  listIndex: 0,
  listTotal: 0,
  timings: []
};

const EMPTY_PUBLISHER_HISTORY = {
  entries: {},
  updatedAt: ""
};

const EMPTY_MESSAGED_PUBLISHERS = {
  entries: {},
  updatedAt: ""
};

const MESSAGED_RESULTS = new Set(["sent", "already_sent"]);

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(["settings", "runtime", "publisherHistory", "messagedPublishers"]);
  const invalidateOldAlreadySent =
    details?.reason === "update" &&
    isVersionOlderThan(details.previousVersion, "0.1.14");
  const invalidateOldDmFailed =
    details?.reason === "update" &&
    isVersionOlderThan(details.previousVersion, "0.1.28");
  const invalidateOldProfileLoadFailed =
    details?.reason === "update" &&
    isVersionOlderThan(details.previousVersion, "0.1.28");
  const invalidateOldBusinessRedirect =
    details?.reason === "update" &&
    isVersionOlderThan(details.previousVersion, "0.1.28");
  const invalidateOldDmSurface =
    details?.reason === "update" &&
    isVersionOlderThan(details.previousVersion, "0.1.28");
  const invalidatedResults = new Set();
  if (invalidateOldAlreadySent) invalidatedResults.add("already_sent");
  if (invalidateOldDmFailed) invalidatedResults.add("dm_failed");
  if (invalidateOldProfileLoadFailed) invalidatedResults.add("profile_load_failed");
  if (invalidateOldBusinessRedirect) invalidatedResults.add("business_redirect");
  if (invalidateOldDmSurface) invalidatedResults.add("dm_surface");

  const historyBeforeMigration = normalizePublisherHistory(stored.publisherHistory);
  if (invalidatedResults.size) {
    for (const [key, entry] of Object.entries(historyBeforeMigration.entries)) {
      if (invalidatedResults.has(entry?.result)) {
        delete historyBeforeMigration.entries[key];
      }
    }
    historyBeforeMigration.updatedAt = new Date().toISOString();
  }
  const processedForMigration = invalidatedResults.size
    ? (stored.runtime?.processed || []).filter((item) => !invalidatedResults.has(item?.result))
    : stored.runtime?.processed;
  const publisherHistory = mergeProcessedIntoHistory(
    historyBeforeMigration,
    processedForMigration
  );
  const messagedPublishers = mergeProcessedIntoMessagedPublishers(
    normalizeMessagedPublishers(stored.messagedPublishers),
    [...Object.values(publisherHistory.entries), ...(processedForMigration || [])]
  );
  const restoredRuntime = stored.runtime?.running
    ? {
        ...EMPTY_RUNTIME,
        ...stored.runtime,
        running: false,
        status: "Eklenti yeniden yüklendiği için yarım kalan işlem güvenli biçimde durduruldu"
      }
    : { ...EMPTY_RUNTIME, ...(stored.runtime || {}) };
  if (invalidatedResults.size && Array.isArray(restoredRuntime.processed)) {
    restoredRuntime.processed = restoredRuntime.processed.filter(
      (item) => !invalidatedResults.has(item?.result)
    );
  }
  await chrome.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings || {}) },
    runtime: restoredRuntime,
    publisherHistory,
    messagedPublishers
  });
});

chrome.runtime.onStartup.addListener(async () => {
  const { runtime } = await chrome.storage.local.get("runtime");
  if (runtime?.running) {
    await chrome.storage.local.set({
      runtime: {
        ...runtime,
        running: false,
        status: "Tarayıcı yeniden başlatıldığı için durduruldu"
      }
    });
  }
});

chrome.tabs?.onRemoved?.addListener(async (tabId) => {
  const { runtime } = await chrome.storage.local.get("runtime");
  if (!runtime?.running) return;
  const controllerClosed = tabId === runtime.controllerTabId;
  const backstageClosed = tabId === runtime.backstageTabId;
  if (!controllerClosed && !backstageClosed) return;
  await chrome.storage.local.set({
    runtime: {
      ...EMPTY_RUNTIME,
      ...runtime,
      running: false,
      status: controllerClosed
        ? `TikTok kontrol sekmesi kapandığı için işlem durduruldu${runtime.controllerTabUrl ? ` (${runtime.controllerTabUrl})` : ""}`
        : "Backstage sekmesi kapandığı için işlem durduruldu",
      lastActivityAt: new Date().toISOString()
    }
  });
  // Kontrol sekmesi kapanınca sekmedeki kod çıkış kaydını yapamaz; toplananlar kaybolmasın.
  if (runtime.mode === "personal" && Array.isArray(runtime.personalRows) && runtime.personalRows.length) {
    await exportPersonalNotes().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
  return true;
});

// Popup-only commands. BTG_EXPORT_PERSONAL, BTG_RUNTIME_PATCH and BTG_MOBILE_SESSION_STOP are also
// sent by the TikTok content script, so they stay open to content senders.
const EXTENSION_PAGE_ONLY_MESSAGES = new Set(['BTG_CLEAR_HISTORY', 'BTG_IMPORT_HISTORY', 'BTG_EXPORT_HISTORY', 'BTG_EXPORT_DIAGNOSTICS', 'BTG_EXPORT_REPORT', 'BTG_START', 'BTG_STOP']);

async function handleMessage(message, sender) {
  if (String(message?.type || '').startsWith('BTG_FEEDBACK_')) {
    // Only extension documents can authorize the feedback queue; content scripts cannot.
    if (!isExtensionPage(sender, chrome.runtime.getURL(''))) return { ok: false, error: 'Geri bildirim panelinden başlatın.' };
    if (message.type === 'BTG_FEEDBACK_REFRESH_ROSTER') {
      // Reserve the mode before releasing the short startup mutex.
      const started = await automationExclusive(async () => {
        const { runtime } = await chrome.storage.local.get('runtime');
        if (runtime?.running || getFeedbackQueue().isActive() || getFeedbackRoster().isActive()) throw Error('Önce çalışan işlemi durdurun.');
        const windowId = sender.tab?.windowId ?? (await chrome.windows.getLastFocused()).id;
        return { task: getFeedbackRoster().refresh(windowId) };
      });
      return started.task;
    }
    const q = getFeedbackQueue();
    if (message.type === 'BTG_FEEDBACK_STATUS') return q.status();
    if (message.type === 'BTG_FEEDBACK_STOP') return q.stop();
    if (message.type === 'BTG_FEEDBACK_RESOLVE') return q.resolve(message);
    if (message.type === 'BTG_FEEDBACK_START') return automationExclusive(async () => {
      if (feedbackRosterInstance?.isActive()) throw Error('Önce yayıncı listesinin yenilenmesini bekleyin.');
      const controllerTabId = sender?.tab?.id;
      if (!Number.isInteger(controllerTabId)) throw Error('Geri bildirim sekmesi bulunamadı; sayfayı yeniden açın.');
      const {runtime} = await chrome.storage.local.get('runtime');
      if (runtime?.running) throw Error('Önce normal otomasyonu durdurun.');
      const tabs = await chrome.tabs.query({url: 'https://live-backstage.tiktok.com/*'});
      const backstageTab = tabs
        .filter(tab => {
          try { return new URL(tab.url).pathname === '/portal/anchor/instant-messages'; }
          catch { return false; }
        })
        .sort((a, b) => Number(b.windowId === (sender?.tab?.windowId ?? -1)) - Number(a.windowId === (sender?.tab?.windowId ?? -1)) ||
          Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (!backstageTab) throw Error('Gönderim için giriş yapılmış TikTok LIVE Backstage “Anlık mesajlar” sekmesini açın.');
      const ready = await prepareBackstageTab(backstageTab.id);
      if (!ready.ok) throw Error('Backstage Anlık mesajlar sayfası hazır değil. ' + ready.error);
      return q.start({...message, controllerTabId, backstageTabId: backstageTab.id});
    });
  }
  if (EXTENSION_PAGE_ONLY_MESSAGES.has(message?.type) && !isExtensionPage(sender, chrome.runtime.getURL(''))) {
    return { ok: false, error: 'Bu işlem yalnızca eklenti panelinden yapılabilir.' };
  }
  switch (message?.type) {
    case 'BTG_SAVE_OUTPUT':
      return BTGOutput.save(message.name, new Blob([new Uint8Array(message.bytes)]));
    case "BTG_GET_STATE":
      return getState();
    case "BTG_BACKSTAGE_FEEDBACK_ACTIVE":
      return {active: await isFeedbackBackstageSendActive(sender, message.username)};
    case "BTG_HISTORY_HAS":
      return hasPublisherHistory(message.username);
    case "BTG_MESSAGE_HISTORY_HAS":
      return hasMessagedPublisher(message.username);
    case "BTG_EXPORT_HISTORY":
      return exportPublisherHistory();
    case "BTG_EXPORT_DIAGNOSTICS":
      return exportDiagnostics();
    case "BTG_EXPORT_REPORT":
      return exportReport();
    case "BTG_EXPORT_PERSONAL":
      return exportPersonalNotes();
    case "BTG_PERSONAL_VISIT":
      return collectPersonalInNewTab(message.username, sender?.tab?.id);
    case "BTG_IMPORT_HISTORY":
      return importPublisherHistory(message.publishers);
    case "BTG_CLEAR_HISTORY":
      return clearPublisherHistory();
    case "BTG_START":
      if(['collect','personal'].includes(message.settings?.mode) && typeof BTGOutput!=='undefined') await BTGOutput.requireFolder();
      return automationExclusive(async () => {
        if (feedbackRosterInstance?.isActive()) return {ok:false,error:'Önce yayıncı listesinin yenilenmesini bekleyin.'};
        if (getFeedbackQueue().isActive()) return {ok:false,error:'Önce geri bildirim gönderimini durdurun.'};
        return startAutomation(message.settings);
      });
    case "BTG_STOP":
      return stopAutomation("Kullanıcı tarafından durduruldu");
    case "BTG_PROBE_BACKSTAGE_API":
      return probeBackstageAPI(message.username, sender, message.mode);
    case "BTG_CHECK_ELIGIBILITY":
      return routeEligibilityCheck(message.username);
    case "BTG_CHECK_ELIGIBILITY_BATCH":
      return routeEligibilityBatch(message.usernames);
    case "BTG_SEND_DM":
      if (feedbackRosterInstance?.isActive()) return {ok:false,error:'Yayıncı listesi yenileniyor.'};
      if (getFeedbackQueue().isActive()) return {ok:false,error:'Geri bildirim gönderimi devam ediyor.'};
      const dmState = await chrome.storage.local.get("runtime");
      if (usesBackstageInstantMessages(dmState.runtime?.mode, dmState.runtime?.liveProfileMessaging)) {
        return sendBackstageInstantMessage(message.username, message.message, sender?.tab?.id);
      }
      return sendDirectMessage(
        message.username,
        message.message,
        sender?.tab?.id,
        message.followerCount
      );
    case "BTG_ACTIVATE_CONTROLLER":
      return activateControllerTab(sender?.tab?.id);
    case "BTG_RELOAD_CONTROLLER":
      return reloadLiveControllerTab(sender?.tab?.id, message.reason);
    case "BTG_MOBILE_NEXT":
      return mobileBridgeRequest("/next", {
        request_id: String(message.requestId || "")
      });
    case "BTG_MOBILE_COMPLETE":
      return mobileBridgeRequest("/complete", {
        token: String(message.token || ""),
        username: String(message.username || ""),
        result: String(message.result || "checked"),
        advance: message.advance !== false
      });
    case "BTG_MOBILE_STATUS":
      return mobileBridgeRequest("/status", null, "GET");
    case "BTG_MOBILE_SESSION_STOP":
      return mobileBridgeRequest("/session/stop", {});
    case "BTG_RUNTIME_PATCH":
      return patchRuntime(message.patch || {}, message.log);
    case "BTG_RECORD_TIMING":
      return recordTiming(message.timing);
    default:
      return { ok: false, error: "Bilinmeyen komut" };
  }
}

async function getState() {
  const stored = await chrome.storage.local.get(["settings", "runtime", "publisherHistory", "messagedPublishers"]);
  const publisherHistory = normalizePublisherHistory(stored.publisherHistory);
  const runtime = await reconcileRunningRuntime({ ...EMPTY_RUNTIME, ...(stored.runtime || {}) });
  return {
    ok: true,
    settings: withMessageVariants({ ...DEFAULT_SETTINGS, ...(stored.settings || {}) }, stored.settings),
    runtime,
    history: {
      count: Object.keys(publisherHistory.entries).length,
      updatedAt: publisherHistory.updatedAt
    }
  };
}

async function reconcileRunningRuntime(runtime) {
  if (!runtime?.running || !runtime.controllerTabId) return runtime;
  const stopStale = async (status, detail = "") => {
    // Neden kapatıldığı kayıtlarda görünsün (sekme yeniden mi yüklendi, döngü neden bitti).
    const logs = [makeLog("error", "", detail ? `${status} — ${detail}` : status), ...(Array.isArray(runtime.logs) ? runtime.logs : [])].slice(0, 100);
    const stopped = {
      ...EMPTY_RUNTIME,
      ...runtime,
      running: false,
      status,
      logs,
      lastActivityAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ runtime: stopped });
    return stopped;
  };

  try {
    await chrome.tabs.get(runtime.controllerTabId);
  } catch {
    return stopStale("TikTok kontrol sekmesi artık açık değil; yarım kalan işlem durduruldu");
  }

  const lastActivity = Date.parse(runtime.lastActivityAt || runtime.startedAt || "");
  const inactiveMs = Number.isFinite(lastActivity) ? Date.now() - lastActivity : 0;
  if (inactiveMs < 30000) return runtime;

  try {
    const ping = await chrome.tabs.sendMessage(
      runtime.controllerTabId,
      { type: "BTG_CONTROLLER_PING" },
      { frameId: 0 }
    );
    if (!ping?.ok || !ping.running) {
      const loadedAt = Number(ping?.pageLoadedAt);
      const startedAt = Date.parse(runtime.startedAt || "");
      const reloaded = Number.isFinite(loadedAt) && Number.isFinite(startedAt) && loadedAt > startedAt;
      return stopStale(
        "TikTok kontrol işlemi artık çalışmıyor; yarım kalan oturum kapatıldı",
        `hareketsiz ${Math.round(inactiveMs / 1000)} sn; ${reloaded ? "kontrol sayfası koşu başladıktan sonra yeniden yüklenmiş" : "kontrol sayfası yeniden yüklenmemiş"}; çıkış nedeni: ${ping?.exitReason || "kayıt yok"}; adres: ${String(ping?.url || "").replace(/[?#].*$/, "").slice(0, 60)}`
      );
    }
  } catch (error) {
    return stopStale(
      "TikTok kontrol sekmesi eklentiyle bağlantısını kaybetti; yarım kalan işlem durduruldu",
      `hareketsiz ${Math.round(inactiveMs / 1000)} sn; ${readableError(error).slice(0, 80)}`
    );
  }

  if (
    inactiveMs >= 60000 &&
    usesBackstageInstantMessages(runtime.mode, runtime.liveProfileMessaging) &&
    /Backstage sohbetinden mesaj gönderiliyor|DM gönderiliyor/i.test(runtime.status || "")
  ) {
    return stopStale("Backstage mesaj işlemi 60 saniye ilerlemedi; güvenli biçimde durduruldu");
  }
  return runtime;
}

async function startAutomation(rawSettings) {
  const settings = sanitizeSettings(rawSettings);
  const backstageInstantMessages = usesBackstageInstantMessages(
    settings.mode,
    settings.liveProfileMessaging
  );
  if (settings.usePersonalizedMessages) {
    const missing = settings.listUsernames.find(name => !Object.hasOwn(settings.personalizedMessages,name.toLowerCase()));
    if (missing) return {ok:false,error:`@${missing} için özel mesaj bulunamadı; liste başlatılmadı.`};
  }
  const allTabs = await chrome.tabs.query({});
  const tikleapSource = settings.mode === "personal" && settings.personalSource === "tikleap";
  let controllerTabs = allTabs
    .filter((tab) => {
      if (["list", "manual", "mobile"].includes(settings.mode) || tikleapSource) return isListControllerUrl(tab.url);
      return settings.mode === "foryou" ? isForYouUrl(tab.url) : isLiveUrl(tab.url);
    })
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  // Kişisel mesaj yalnız uygunluk kontrolü yapar; iki Backstage sayfası da kullanılabilir.
  // Tikleap kaynağı uygunluğu 30'arlı İlişkiyi yönet sihirbazında toplu kontrol eder.
  const backstagePaths = tikleapSource
    ? ["/portal/anchor/relation"]
    : settings.mode === "personal"
    ? ["/portal/anchor/instant-messages", "/portal/anchor/relation"]
    : [backstageInstantMessages ? "/portal/anchor/instant-messages" : "/portal/anchor/relation"];
  const backstageTabs = allTabs
    .filter(
      (tab) =>
        tab.url?.startsWith("https://live-backstage.tiktok.com/") &&
        backstagePaths.some((pathname) => tab.url.includes(pathname))
    )
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastAccessed || 0) - (a.lastAccessed || 0));

  // Listeden Kontrol yalnız Anlık mesajlar araması ve sohbetini kullanır.
  // Ayrı, boş bir TikTok sekmesini döngü taşıyıcısı yapmak yerine kontrol
  // kodunu doğrudan açık Backstage sekmesinde çalıştır.
  // Profil gönderiminde ise uygunluk İlişkiyi yönet sekmesinde kontrol edilir,
  // döngü Excel listesindeki gibi ayrı bir TikTok sekmesinde çalışır.
  if (settings.mode === "manual" && backstageInstantMessages) controllerTabs = backstageTabs;

  if (["list", "manual"].includes(settings.mode) && !settings.listUsernames.length) {
    return {
      ok: false,
      error: settings.mode === "manual"
        ? "Listeden Kontrol alanında geçerli TikTok kullanıcı adı bulunamadı."
        : "Excel listesinde geçerli TikTok kullanıcı adı bulunamadı."
    };
  }

  if ((["list", "mobile"].includes(settings.mode) || (settings.mode === "manual" && !backstageInstantMessages) || tikleapSource) &&
      !controllerTabs.length) {
    try {
      const createdTab = await chrome.tabs.create({
        url: "https://www.tiktok.com/",
        active: false
      });
      await waitForTabComplete(createdTab.id, 25000);
      await delay(800);
      controllerTabs = [await chrome.tabs.get(createdTab.id)];
    } catch (error) {
      return {
        ok: false,
        error: (tikleapSource
          ? "Tikleap listesini işlemek için TikTok kontrol sekmesi açılamadı. "
          : settings.mode === "mobile"
          ? "Mobil akışı çalıştırmak için TikTok kontrol sekmesi açılamadı. "
          : settings.mode === "manual"
            ? "Listeden Kontrol profil gönderimi için TikTok kontrol sekmesi açılamadı. "
            : "Excel listesini çalıştırmak için TikTok kontrol sekmesi açılamadı. ") + readableError(error)
      };
    }
  }

  if (!controllerTabs.length) {
    return {
      ok: false,
      error:
        settings.mode === "foryou"
          ? "Önce TikTok ana sayfasında “Sizin İçin” akışını açın."
          : settings.mode === "manual"
            ? backstageInstantMessages
              ? "Listeden Kontrol için TikTok LIVE Backstage “Anlık mesajlar” sekmesini açın ve giriş yapın."
              : "Listeden Kontrol profil gönderimi için TikTok kontrol sekmesi açılamadı."
          : settings.mode === "mobile"
            ? "Mobil mod için bir TikTok kontrol sekmesi açılamadı."
            : "Önce bir TikTok LIVE yayın sekmesi açın."
    };
  }
  const backstageRequired = true;
  if (backstageRequired && !backstageTabs.length) {
    return {
      ok: false,
      error: settings.mode === "manual"
        ? backstageInstantMessages
          ? "Listeden Kontrol için TikTok LIVE Backstage “Anlık mesajlar” sekmesini açın ve giriş yapın."
          : "Listeden Kontrol profil gönderimi için TikTok LIVE Backstage “İlişkiyi yönet” sayfasını ayrı bir sekmede açın ve giriş yapın."
        : settings.mode === "live"
          ? settings.liveProfileMessaging
            ? "CANLI Yayın profil gönderimi için TikTok LIVE Backstage “İlişkiyi yönet” sayfasını ayrı bir sekmede açın ve giriş yapın."
            : "CANLI Yayın için TikTok LIVE Backstage “Anlık mesajlar” sekmesini ayrı bir sekmede açın ve giriş yapın."
          : tikleapSource
            ? "Tikleap kaynağı yayıncıları 30'arlı kontrol eder; TikTok LIVE Backstage “İlişkiyi yönet” sayfasını ayrı bir sekmede açın ve giriş yapın."
          : settings.mode === "personal"
            ? "Kişisel mesaj için TikTok LIVE Backstage “Anlık mesajlar” veya “İlişkiyi yönet” sayfasını ayrı bir sekmede açın ve giriş yapın."
            : "TikTok LIVE Backstage “İlişkiyi yönet” sayfasını ayrı bir sekmede açın ve giriş yapın."
    };
  }

  // Eklenti yenilendiyse açık Backstage sekmesinde yardımcı kod bulunmaz; başlamadan önce bağlantı kurulur.
  if (backstageRequired) {
    const backstageReadiness = await prepareBackstageTab(backstageTabs[0].id);
    if (!backstageReadiness.ok) {
      return { ok: false, error: backstageReadiness.error };
    }
  }

  let personalQueue = [];
  const startLogs = [];
  if (settings.mode === "personal") {
    startLogs.push(makeLog("info", "", `Kontrol sekmesi: ${String(controllerTabs[0].url || "").replace(/[?#].*$/, "").slice(0, 80)}`));
  }
  if (tikleapSource) {
    const tikleap = await readTikleapQueue();
    if (!tikleap.ok) return { ok: false, error: tikleap.error };
    personalQueue = tikleap.queue;
    startLogs.push(makeLog("info", "", tikleap.summary));
  }

  if (settings.mode === "mobile") {
    const bridgeStart = await mobileBridgeRequest("/session/start", {});
    if (!bridgeStart?.ok) {
      return {
        ok: false,
        error: bridgeStart?.error || "BTG Mobil Yayıncı Asistanı köprüsü başlatılamadı."
      };
    }
  }

  const runtime = {
    ...EMPTY_RUNTIME,
    mode: settings.mode,
    liveProfileMessaging: settings.liveProfileMessaging,
    existingCreatorNotice: settings.existingCreatorNotice === true,
    running: true,
    status: "Başlatılıyor",
    controllerTabId: controllerTabs[0].id,
    // Kontrol sekmesi kapanırsa hangi sekme olduğu durum satırında görünsün.
    controllerTabUrl: String(controllerTabs[0].url || "").replace(/[?#].*$/, "").slice(0, 80),
    backstageTabId: backstageRequired ? backstageTabs[0].id : null,
    listIndex: 0,
    listTotal: ["list", "manual"].includes(settings.mode) ? settings.listUsernames.length : personalQueue.length,
    personalQueue,
    logs: startLogs,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    lastStep: "Otomasyon başlatılıyor"
  };

  await chrome.storage.local.set({ settings, runtime });
  // Uzun koşuda arka plandaki kontrol ve Backstage sekmeleri bellek tasarrufuyla atılmasın.
  for (const id of [runtime.controllerTabId, runtime.backstageTabId]) {
    if (Number.isInteger(id)) chrome.tabs.update(id, { autoDiscardable: false }).catch(() => {});
  }

  try {
    const result = await startControllerWithRecovery(controllerTabs[0].id, settings);
    if (!result?.ok) {
      throw new Error(result?.error || "TikTok akış otomasyonu başlatılamadı.");
    }
  } catch (error) {
    if (settings.mode === "mobile") {
      await mobileBridgeRequest("/session/stop", {}).catch(() => {});
    }
    await chrome.storage.local.set({
      runtime: {
        ...runtime,
        running: false,
        status: "Başlatılamadı",
        failed: 1,
        logs: [makeLog("error", "", readableError(error))]
      }
    });
    return {
      ok: false,
      error:
        (settings.mode === "list"
          ? "TikTok kontrol sekmesini"
          : settings.mode === "manual"
            ? backstageInstantMessages ? "Backstage Anlık mesajlar sekmesini" : "TikTok kontrol sekmesini"
          : settings.mode === "mobile"
            ? "Mobil telefon kontrol sekmesini"
          : settings.mode === "foryou"
            ? "Sizin İçin sekmesini"
            : "Canlı yayın sekmesini") +
        " bir kez yenileyip tekrar deneyin. " +
        readableError(error)
    };
  }

  return { ok: true };
}

async function startControllerWithRecovery(tabId, settings) {
  const message = {
    type: "BTG_START_CONTROLLER",
    settings
  };
  try {
    if (settings.mode === 'collect') {
      const ready = await chrome.tabs.sendMessage(tabId, {type:'BTG_CONTROLLER_PING'}, {frameId:0});
      if (ready?.collectionDataVersion !== 1) {
        await patchRuntime({status:'İsim Toplama veri kaydı için canlı sekme güncelleniyor'});
        await chrome.tabs.reload(tabId);
        await waitForTabComplete(tabId, 25000);
        await delay(1000);
        const refreshed = await chrome.tabs.sendMessage(tabId, {type:'BTG_CONTROLLER_PING'}, {frameId:0});
        if (refreshed?.collectionDataVersion !== 1) return {ok:false,error:'Yayın verisi kayıt modülü güncel değil. Eklentiyi yeniden yükleyip TikTok canlı sekmesini yenileyin.'};
      }
    }
    if (settings.mode === 'personal') {
      const ready = await chrome.tabs.sendMessage(tabId, {type:'BTG_CONTROLLER_PING'}, {frameId:0});
      if (ready?.personalDataVersion !== 1) {
        await patchRuntime({status:'Kişisel mesaj veri modülü için canlı sekme güncelleniyor'});
        await chrome.tabs.reload(tabId);
        await waitForTabComplete(tabId, 25000);
        await delay(1000);
        const refreshed = await chrome.tabs.sendMessage(tabId, {type:'BTG_CONTROLLER_PING'}, {frameId:0});
        if (refreshed?.personalDataVersion !== 1) return {ok:false,error:'Kişisel mesaj veri modülü güncel değil. Eklentiyi yeniden yükleyip TikTok canlı sekmesini yenileyin.'};
      }
    }
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;

    await patchRuntime({
      status: "TikTok kontrol sekmesi eklentiyle yeniden bağlanmak için yenileniyor",
      lastStep: "Kontrol sekmesi yenileniyor"
    });
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId, 25000);
    await delay(1000);
    if (settings.mode === 'collect') {
      const ready = await chrome.tabs.sendMessage(tabId, {type:'BTG_CONTROLLER_PING'}, {frameId:0});
      if (ready?.collectionDataVersion !== 1) return {ok:false,error:'Yayın verisi kayıt modülü hazır değil; eklentiyi ve TikTok canlı sekmesini yenileyin.'};
    }
    if (settings.mode === 'personal') {
      const ready = await chrome.tabs.sendMessage(tabId, {type:'BTG_CONTROLLER_PING'}, {frameId:0});
      if (ready?.personalDataVersion !== 1) return {ok:false,error:'Kişisel mesaj veri modülü hazır değil; eklentiyi ve TikTok canlı sekmesini yenileyin.'};
    }
    return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  }
}

async function stopAutomation(reason) {
  const { runtime, settings } = await chrome.storage.local.get(["runtime", "settings"]);
  const nextRuntime = {
    ...EMPTY_RUNTIME,
    ...(runtime || {}),
    running: false,
    status: reason
  };
  await chrome.storage.local.set({ runtime: nextRuntime });

  if (settings?.mode === "mobile") {
    await mobileBridgeRequest("/session/stop", {}).catch(() => {});
  }

  if (runtime?.controllerTabId) {
    try {
      const controllerStop = await chrome.tabs.sendMessage(
        runtime.controllerTabId,
        { type: "BTG_STOP_CONTROLLER" },
        { frameId: 0 }
      );
      if(['collect','personal'].includes(settings?.mode) && controllerStop?.ok) return {ok:true,collectionExportHandled:true};
    } catch {
      // Sekme kapanmış veya yenilenmiş olabilir.
    }
  }
  return { ok: true };
}

async function routeEligibilityCheck(rawUsername) {
  const username = sanitizeUsername(rawUsername);
  const { runtime } = await chrome.storage.local.get("runtime");
  if (!runtime?.running) {
    return { ok: false, error: "Otomasyon artık çalışmıyor." };
  }
  if (!runtime.backstageTabId) {
    return { ok: false, error: "Backstage sekmesi bulunamadı." };
  }

  try {
    const result = await sendBackstageCheckWithRecovery(
      runtime.backstageTabId,
      username,
      runtime.mode,
      runtime.liveProfileMessaging === true,
      false,
      isExistingCreatorNoticeRun(runtime)
    );
    if (result?.ok === false && result.notFound && ['live', 'personal'].includes(runtime.mode)) {
      // İki aramada da sonuç listesi okunamadı. Bu beklenmeyen hata değildir:
      // yayıncı bu oturumda atlanır, kalıcı "kontrol edildi" sayılmaz ve akış sürer.
      return {
        ok: true,
        eligible: false,
        transientSkipped: true,
        transientResult: 'backstage_not_found',
        reason: 'Backstage araması iki denemede sonuç göstermedi — bulunamadı, atlandı.'
      };
    }
    return result;
  } catch (error) {
    if (error.code === 'BACKSTAGE_TIMEOUT' && ['live', 'personal'].includes(runtime.mode)) {
      // Gizli Backstage sekmesi Chrome tarafından yavaşlatılırsa tek bir yayıncı
      // tüm canlı akışı durdurmamalı. Bu kayıt kalıcı "uygun değil" sayılmaz;
      // yalnız bu oturumda geçici olarak atlanır ve sonraki yayına devam edilir.
      return {
        ok: true,
        eligible: false,
        transientSkipped: true,
        reason: 'Backstage yanıtı zamanında gelmedi; bu yayıncı geçici olarak atlandı.'
      };
    }
    if (error.code === 'BACKSTAGE_TIMEOUT' && runtime.mode !== 'manual') {
      await stopAutomation('Backstage yanıt vermediği için otomasyon durduruldu.');
    }
    return {
      ok: false,
      error: "Backstage sekmesine erişilemedi. Sekmeyi yenileyip giriş durumunu kontrol edin. " + readableError(error)
    };
  }
}

// Davet sihirbazı en fazla 30 kullanıcı adını tek seferde kontrol eder; davet gönderilmez.
const BATCH_WIZARD_RETRIES = 2;
const BATCH_WIZARD_ERROR = /dönülemedi|düğmesi bulunamadı|zamanında gelmedi|açılmadı/;

async function routeEligibilityBatch(rawUsernames) {
  const usernames = sanitizeUsernameList(rawUsernames).slice(0, 30);
  if (!usernames.length) return { ok: false, error: "Toplu kontrol için geçerli kullanıcı adı yok." };
  const { runtime } = await chrome.storage.local.get("runtime");
  if (!runtime?.running) return { ok: false, error: "Otomasyon artık çalışmıyor." };
  if (!runtime.backstageTabId) return { ok: false, error: "Backstage sekmesi bulunamadı." };
  const message = { type: "BTG_BACKSTAGE_BATCH_CHECK", usernames };
  try {
    let result;
    try {
      result = await sendBackstageMessage(runtime.backstageTabId, message, 45000);
    } catch (error) {
      if (!isMissingReceiverError(error) && error.code !== "BACKSTAGE_TIMEOUT") throw error;
      // Eklenti yenilenmişse ya da sihirbaz yarım kaldıysa sekme bir kez yenilenip tekrar denenir.
      await resetBackstageCheckTab(runtime.backstageTabId);
      return await sendBackstageMessage(runtime.backstageTabId, message, 45000);
    }
    // Sihirbaz bazen sonuçtan sonra 1. adıma dönmüyor ya da bir düğme geç geliyor
    // (2026-10-14: 25 gruptan sonra "kullanıcı adı ekranına geri dönülemedi" tüm koşuyu
    // durdurdu). Sayfa yenilenip aynı grup en fazla iki kez daha denenir.
    for (let retry = 0; retry < BATCH_WIZARD_RETRIES && result?.ok === false && result.code !== "BACKSTAGE_BUSY" && BATCH_WIZARD_ERROR.test(String(result.error || "")); retry += 1) {
      await resetBackstageCheckTab(runtime.backstageTabId);
      result = await sendBackstageMessage(runtime.backstageTabId, message, 45000);
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: "Backstage toplu kontrolü tamamlanamadı. İlişkiyi yönet sekmesini yenileyip giriş durumunu kontrol edin. " + readableError(error)
    };
  }
}

async function sendBackstageInstantMessage(rawUsername, rawMessage, controllerTabId) {
  const username = sanitizeUsername(rawUsername);
  const {runtime} = await chrome.storage.local.get("runtime");
  if (!runtime?.running || !usesBackstageInstantMessages(runtime.mode, runtime.liveProfileMessaging) ||
      runtime.controllerTabId !== controllerTabId || !runtime.backstageTabId) {
    return {ok: false, error: "Backstage Anlık mesajlar oturumu doğrulanamadı."};
  }
  // Mevcut yayıncılar ilk temas kaydında zaten bulunur; bilgilendirmede yinelenen
  // gönderimi sohbetteki aynı metin engeller.
  const notice = isExistingCreatorNoticeRun(runtime);
  if (!notice) {
    const previous = await hasMessagedPublisher(username);
    if (previous.messaged) return {ok: true, alreadySent: true};
  }
  try {
    // Gönderim komutu tekrar denenmez veya profil akışına yönlendirilmez.
    const result = await sendBackstageMessage(runtime.backstageTabId, {
      type: "BTG_BACKSTAGE_SEND_DM", username, message: String(rawMessage || "").trim(),
      ...(notice ? {notice: true} : {})
    });
    if (result?.ok && (result.sent || result.alreadySent)) {
      const stored = await chrome.storage.local.get("messagedPublishers");
      const messagedPublishers = mergeProcessedIntoMessagedPublishers(
        normalizeMessagedPublishers(stored.messagedPublishers),
        [{username, result: result.alreadySent ? "already_sent" : "sent", time: new Date().toISOString()}]
      );
      await chrome.storage.local.set({messagedPublishers});
      return result;
    }
    if (result?.ok && result.unavailableSkipped) return result;
    return {ok: false, error: result?.error || "Backstage gönderimi doğrulanamadı."};
  } catch (error) {
    if (runtime.mode !== "manual") {
      await stopAutomation("Backstage mesaj gönderimi doğrulanamadı; otomasyon durduruldu.");
    }
    return {ok: false, error: readableError(error)};
  }
}

async function prepareBackstageTab(tabId) {
  try {
    const ping = await sendBackstageMessage(tabId, { type: "BTG_BACKSTAGE_PING" });
    if (ping?.ok && ping.busy && ping.busyOperation !== "BTG_BACKSTAGE_CHECK") {
      return { ok: false, error: "Backstage mesaj gönderimi hâlâ sürüyor; tamamlanmasını bekleyin ve sohbeti kontrol edin." };
    }
    if (ping?.ok && ping.ready && !ping.busy && !backstageChecksNeedingReset.has(tabId)) {
      return { ok: true, reloaded: false };
    }
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      return {
        ok: false,
        error:
          "Backstage sekmesine erişilemedi. Sekmeyi yenileyip giriş durumunu kontrol edin. " +
          readableError(error)
      };
    }
  }

  try {
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId, 25000);
  } catch (error) {
    return {
      ok: false,
      error: "Backstage sekmesi yenilenemedi; sekmeyi elle yenileyip tekrar deneyin. " + readableError(error)
    };
  }

  const readiness = await waitForBackstageReady(tabId, 30000);
  if (!readiness.ok) {
    return {
      ok: false,
      error: "Backstage sayfası hazır değil. " + readiness.error
    };
  }
  backstageChecksNeedingReset.delete(tabId);
  return { ok: true, reloaded: true };
}

// Zaman aşımı yalnız arka plandaki beklemeyi bitirir; sayfadaki kontrolü bitirmez.
// Sonraki kontrol eski işlemle çakışmadan önce sayfa bir kez yenilenir.
const backstageChecksNeedingReset = new Set();

async function sendBackstageCheckWithRecovery(tabId, username, mode, liveProfileMessaging = false, feedback = false, notice = false) {
  const message = { type: "BTG_BACKSTAGE_CHECK", username, mode, liveProfileMessaging, ...(feedback ? {feedback:true} : {}), ...(notice ? {notice:true} : {}) };
  let recovered = false;
  try {
    if (backstageChecksNeedingReset.has(tabId)) {
      recovered = true;
      await resetBackstageCheckTab(tabId);
    }
    const result = await sendBackstageMessage(tabId, message);
    if (result?.code === "BACKSTAGE_BUSY" && result.busyOperation === "BTG_BACKSTAGE_CHECK" && !recovered) {
      // Kontrol yenilenebilir; devam eden mesaj gönderimi asla tekrarlanmaz.
      recovered = true;
      await resetBackstageCheckTab(tabId);
      return await sendBackstageMessage(tabId, message);
    }
    return result;
  } catch (error) {
    if (error.code === "BACKSTAGE_TIMEOUT") backstageChecksNeedingReset.add(tabId);
    // Eklenti yenilendikten sonra açık kalan Backstage sekmesinde yardımcı kod bulunmaz.
    // Bu durumda sekme bir kez yenilenir ve kontrol elle müdahale gerekmeden yeniden denenir.
    if (!isMissingReceiverError(error) || recovered) throw error;
    await resetBackstageCheckTab(tabId);
    try {
      return await sendBackstageMessage(tabId, message);
    } catch (retryError) {
      if (retryError.code === "BACKSTAGE_TIMEOUT") backstageChecksNeedingReset.add(tabId);
      throw retryError;
    }
  }
}

async function resetBackstageCheckTab(tabId) {
  await patchRuntime({
    status: "Backstage yarım kalan kontrolü temizlemek için yenileniyor",
    lastStep: "Backstage sekmesi yenileniyor"
  });
  await chrome.tabs.reload(tabId);
  await waitForTabComplete(tabId, 25000);
  const readiness = await waitForBackstageReady(tabId, 30000);
  if (!readiness.ok) throw new Error(readiness.error);
  backstageChecksNeedingReset.delete(tabId);
}

async function waitForBackstageReady(tabId, timeoutMs) {
  const started = Date.now();
  let lastError = "Backstage sayfası beklenen kontrol alanını göstermedi.";
  while (Date.now() - started < timeoutMs) {
    try {
      const ping = await sendBackstageMessage(tabId, { type: "BTG_BACKSTAGE_PING" });
      if (ping?.ok && ping.ready && !ping.busy) return { ok: true };
      if (ping?.ok) {
        lastError =
          "Backstage sayfası açıldı ancak beklenen kontrol alanı bulunamadı. Giriş durumunu kontrol edin. Doğru Backstage sekmesinin açık olduğundan emin olun.";
      }
    } catch (error) {
      lastError = readableError(error);
    }
    await delay(700);
  }
  return { ok: false, error: lastError };
}

function isMissingReceiverError(error) {
  const detail = readableError(error);
  return (
    detail.includes("Receiving end does not exist") ||
    detail.includes("Could not establish connection")
  );
}

async function sendDirectMessage(rawUsername, rawMessage, controllerTabId, knownFollowerCount, options = {}) {
  const username = sanitizeUsername(rawUsername);
  const message = String(rawMessage || "").trim();
  if (!message) {
    return { ok: false, error: "Gönderilecek mesaj boş." };
  }

  // Sohbette hazır mesajların herhangi biri görünüyorsa yeniden gönderilmez.
  // Geri bildirim mesajları ilk temas metinleriyle karşılaştırılmaz.
  const knownMessages = options.feedback ? [] : await readOutreachMessageVariants();
  let profileTab;
  const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  const dmTimer = createPhaseTimer();
  try {
    await updateActiveStatus(username, `@${username} profili açılıyor`, "Profil sekmesi açılıyor");
    // Sekme baştan öne alınır: Chrome arka plandaki sekmelerin zamanlayıcılarını
    // kısar ve profil daha geç yüklenir; sekme zaten bir sonraki adımda öne alınacaktı.
    profileTab = await createProfileTab(profileUrl, controllerTabId);
    await waitForTabComplete(profileTab.id, 20000);
    await delay(400);
    dmTimer.mark("profil");

    // Mesaj yazılmadan önce takipçi filtresi uygulanır; eşiğin altındaki hesapların DM ekranı açılmaz.
    // Sayaç CANLI Yayın ekranındaki yayıncı kartından okunduysa profil sekmesi yeniden sorgulanmaz.
    const followerGate = options.feedback ? {skip:false} : await enforceFollowerThreshold(
      profileTab.id,
      username,
      profileUrl,
      knownFollowerCount
    );
    if (followerGate.skip) {
      await closeProfileAndRestoreController(profileTab.id, controllerTabId);
      return {
        ok: true,
        timing: dmTimer.phases(),
        followerSkipped: true,
        followerReason: followerGate.reason,
        followerCount: followerGate.count,
        minFollowers: followerGate.minFollowers,
        followerDetail: followerGate.detail
      };
    }

    let sendResult;
    let reloadsRemaining = 3;
    let totalReloads = 0;
    for (let routeAttempt = 0; routeAttempt < 2; routeAttempt += 1) {
      if (routeAttempt > 0) {
        await chrome.tabs.update(profileTab.id, { url: profileUrl, active: true });
        await waitForTabComplete(profileTab.id, 20000);
        await delay(400);
      }

      // Sekme zaten öne açıldı; ikinci bir etkinleştirme ve bekleme gerekmez.
      const openAttempt = await openProfileMessageWithReloads(profileTab.id, 3, username, false);
      const openResult = openAttempt.result;
      dmTimer.mark("mesaj düğmesi");

      if (!openResult?.ok) {
        if (openResult?.profileUnavailable || openAttempt.exhausted) {
          await closeProfileAndRestoreController(profileTab.id, controllerTabId);
          return {
            ok: true,
            timing: dmTimer.phases(),
            unavailableSkipped: true,
            unavailableReason: openResult?.profileUnavailable
              ? "message_permission"
              : "profile_load_failed",
            reloadCount: openAttempt.reloadCount
          };
        }
        if (openResult?.keepTab) {
          await chrome.tabs.update(profileTab.id, { active: true });
          return { ...openResult, profileTabId: profileTab.id };
        }
        await closeProfileAndRestoreController(profileTab.id, controllerTabId);
        return openResult || { ok: false, error: "Profilde Mesaj düğmesi bulunamadı." };
      }

      if (openResult.destinationUrl) {
        // Canlı ölçümde (üç çalışma, 60 gönderim) Mesaj düğmesine gönderilen
        // Chrome fare tıklaması, sayfa tamamen yüklü olsa bile gönderimlerin
        // %30-65'inde hiç yönlendirme yapmadı; doğrudan sohbet adresine gitmek
        // ise başarılı tıklama kadar hızlı (≈1,7 sn) ve her seferinde çalıştı.
        // Bu yüzden önce doğrudan gidilir; tıklama yalnız adres sohbet rotasına
        // oturmazsa yedek olarak denenir.
        await updateActiveStatus(
          username,
          `@${username} için sohbet adresi açılıyor`,
          "Sohbet adresi açılıyor"
        );
        let dmNavigation = await navigateToPreferredDmTarget(
          profileTab.id,
          openResult.destinationUrl
        );
        if (!dmNavigation.ok) {
          await logDmStep(
            username,
            `Doğrudan sohbet adresi açılmadı (son adres: ${describeUrlPath(
              dmNavigation.finalUrl
            )}); profildeki Mesaj düğmesine tıklanacak`
          );
          dmNavigation = await clickProfileMessageFallback(
            profileTab.id,
            profileUrl,
            username,
            openResult.destinationUrl
          );
        }
        if (!dmNavigation.ok) {
          await closeProfileAndRestoreController(profileTab.id, controllerTabId);
          return {
            ok: true,
            timing: dmTimer.phases(),
            unavailableSkipped: true,
            unavailableReason: "dm_surface",
            reloadCount: totalReloads
          };
        }
        if (dmNavigation.route === "normal") {
          await updateActiveStatus(
            username,
            `@${username} için normal Mesajlar hedefi açıldı; sohbet doğrulanıyor`,
            "Normal Mesajlar hedefi doğrulanıyor"
          );
        }
        openResult.recoveryUrl = dmNavigation.recoveryUrl;
      }
      dmTimer.mark("sohbet");

      // Adres zaten tamamlanmış ve sabitlenmiş durumda; ek yerleşme beklemesi
      // yoktur. Mesaj kutusu araması yoklayarak bekler ve gerekirse sohbeti
      // yerinde açtırır.

      const surfaceAttempt = await findDmSurfaceWithReloads(
        profileTab.id,
        reloadsRemaining,
        username,
        openResult.recoveryUrl
      );
      reloadsRemaining -= surfaceAttempt.reloadCount;
      totalReloads += surfaceAttempt.reloadCount;
      const dmSurface = surfaceAttempt.surface;
      dmTimer.mark("mesaj kutusu");

      if (dmSurface.frameId === undefined && routeAttempt === 0) {
        sendResult = {
          ok: false,
          reopenProfile: true,
          error: "TikTok mesaj ekranı yenilemelere rağmen açılmadı; profil üzerinden yeniden deneniyor."
        };
      } else if (dmSurface.frameId === undefined) {
        sendResult = {
          ok: true,
          unavailableSkipped: true,
          reloadCount: totalReloads
        };
      } else {
        await updateActiveStatus(
          username,
          `@${username} mesaj kutusu bulundu; Chrome girdisi hazırlanıyor`,
          "Chrome girdisi hazırlanıyor"
        );
        sendResult = await sendDmWithTrustedInput(
          profileTab.id,
          dmSurface.frameId,
          message,
          username,
          knownMessages
        );
      }

      if (!options.feedback && !sendResult?.ok && sendResult?.retryable) {
        await delay(1500);
        const retryAttempt = await findDmSurfaceWithReloads(
          profileTab.id,
          reloadsRemaining,
          username,
          openResult.recoveryUrl
        );
        reloadsRemaining -= retryAttempt.reloadCount;
        totalReloads += retryAttempt.reloadCount;
        if (retryAttempt.surface.frameId !== undefined) {
          sendResult = await sendDmWithTrustedInput(
            profileTab.id,
            retryAttempt.surface.frameId,
            message,
            username,
            knownMessages
          );
        } else if (routeAttempt === 0) {
          sendResult = {
            ok: false,
            reopenProfile: true,
            error: "TikTok mesaj ekranı yenilemelere rağmen açılmadı; profil üzerinden yeniden deneniyor."
          };
        } else {
          sendResult = {
            ok: true,
            unavailableSkipped: true,
            reloadCount: totalReloads
          };
        }
      }

      if (sendResult?.ok) {
        dmTimer.mark("gönderim");
        // Gönderim zaten sohbet içinde doğrulandı; sekme kapatılmadan önceki
        // güvenlik payı kısaltıldı.
        await delay(250);
        await closeProfileAndRestoreController(profileTab.id, controllerTabId);
        dmTimer.mark("kapatma");
        return {
          ok: true,
          timing: dmTimer.phases(),
          alreadySent: Boolean(sendResult.alreadySent),
          verifiedInConversation: Boolean(sendResult.verifiedInConversation),
          unavailableSkipped: Boolean(sendResult.unavailableSkipped),
          unavailableReason: sendResult.unavailableSkipped ? "dm_surface" : undefined,
          reloadCount: Number(sendResult.reloadCount || totalReloads)
        };
      }

      if (!options.feedback && sendResult?.reopenProfile && routeAttempt === 0) {
        continue;
      }
      break;
    }

    await chrome.tabs.update(profileTab.id, { active: true });
    return {
      ok: false,
      keepTab: true,
      profileTabId: profileTab.id,
      error: sendResult?.error || "DM gönderimi doğrulanamadı; profil sekmesi kontrol için açık bırakıldı."
    };
  } catch (error) {
    if (profileTab?.id) {
      try {
        await chrome.tabs.update(profileTab.id, { active: true });
      } catch {
        // Sekme zaten kapanmış olabilir.
      }
    }
    return {
      ok: false,
      keepTab: Boolean(profileTab?.id),
      profileTabId: profileTab?.id,
      error: "DM işlemi tamamlanamadı. " + readableError(error)
    };
  }
}

async function readFollowerRequirement() {
  const { settings } = await chrome.storage.local.get("settings");
  const mode = ["live", "foryou", "list", "mobile", "manual"].includes(settings?.mode)
    ? settings.mode
    : "live";
  const minFollowers = clampNumber(settings?.minFollowers, 0, 1000000000, 0);
  return {
    mode,
    minFollowers,
    // Takipçi filtresi yalnızca CANLI Yayın akışında uygulanır; alan da yalnız bu modda görünür.
    active: mode === "live" && minFollowers > 0
  };
}

function isReadableFollowerCount(value) {
  // null, "" veya tanımsız yanıtlar 0 takipçi sanılmamalı; bunlar okunamamış sayaçtır.
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

async function enforceFollowerThreshold(tabId, username, profileUrl, knownCount) {
  const requirement = await readFollowerRequirement();
  if (!requirement.active) return { skip: false, minFollowers: requirement.minFollowers };

  // Sayaç yayın ekranındaki yayıncı kartından okunduysa aynı değer kullanılır;
  // profil sekmesi ikinci kez sorgulanmaz.
  if (isReadableFollowerCount(knownCount)) {
    const known = Math.max(0, Math.round(Number(knownCount)));
    if (known < requirement.minFollowers) {
      return {
        skip: true,
        reason: "low_followers",
        count: known,
        minFollowers: requirement.minFollowers,
        detail: "yayın kartı"
      };
    }
    await updateActiveStatus(
      username,
      `@${username} takipçi filtresini geçti (${known})`,
      "Takipçi filtresi geçildi"
    );
    return { skip: false, count: known, minFollowers: requirement.minFollowers };
  }

  let reading;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      // Sayaç okunamadıysa profil bir kez yenilenir; böylece geç yüklenen sayfa boşuna atlanmaz.
      await updateActiveStatus(
        username,
        `@${username} takipçi sayısı için profil yenileniyor`,
        "Takipçi sayısı için profil yenileniyor"
      );
      try {
        if (profileUrl) {
          await chrome.tabs.update(tabId, { url: profileUrl, active: false });
        } else {
          await chrome.tabs.reload(tabId);
        }
        await waitForTabComplete(tabId, 20000);
        await delay(1500);
      } catch (error) {
        return {
          skip: true,
          reason: "follower_unknown",
          count: null,
          minFollowers: requirement.minFollowers,
          detail: "Profil sekmesi takipçi sayısı için yenilenemedi. " + readableError(error)
        };
      }
    }

    await updateActiveStatus(
      username,
      `@${username} takipçi sayısı okunuyor (en az ${requirement.minFollowers})`,
      "Takipçi sayısı okunuyor"
    );
    try {
      reading = await sendTabMessageWithRetry(
        tabId,
        { type: "BTG_READ_FOLLOWER_COUNT", username },
        3,
        900,
        { frameId: 0 }
      );
    } catch (error) {
      reading = {
        ok: false,
        error: "Profil sekmesiyle takipçi sayısı için iletişim kurulamadı. " + readableError(error)
      };
    }

    if (reading?.ok && isReadableFollowerCount(reading.count)) break;
  }

  if (!reading?.ok || !isReadableFollowerCount(reading.count)) {
    return {
      skip: true,
      reason: "follower_unknown",
      count: null,
      minFollowers: requirement.minFollowers,
      detail: reading?.error || "Takipçi sayısı okunamadı."
    };
  }

  const count = Math.max(0, Math.round(Number(reading.count)));
  if (count < requirement.minFollowers) {
    return {
      skip: true,
      reason: "low_followers",
      count,
      minFollowers: requirement.minFollowers,
      detail: String(reading.source || "")
    };
  }

  await updateActiveStatus(
    username,
    `@${username} takipçi filtresini geçti (${count})`,
    "Takipçi filtresi geçildi"
  );
  return { skip: false, count, minFollowers: requirement.minFollowers };
}

async function sendDmWithTrustedInput(tabId, frameId, message, username, knownMessages = []) {
  const messageOptions = { frameId };
  const prepare = await sendTabMessageWithRetry(
    tabId,
    {
      type: "BTG_PREPARE_PROFILE_DM",
      message,
      username,
      knownMessages,
      focus: false
    },
    2,
    350,
    messageOptions
  );
  if (!prepare?.ok || prepare?.alreadySent) return prepare;

  const debuggee = { tabId };
  let attached = false;
  let inputSent = false;

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;

    const focused = await sendTabMessageWithRetry(
      tabId,
      {
        type: "BTG_PREPARE_PROFILE_DM",
        message,
        username,
        knownMessages,
        focus: true
      },
      2,
      250,
      messageOptions
    );
    if (!focused?.ok || focused?.alreadySent) return focused;

    if (focused.point && Number.isFinite(focused.point.x) && Number.isFinite(focused.point.y)) {
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: focused.point.x,
        y: focused.point.y
      });
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: focused.point.x,
        y: focused.point.y,
        button: "left",
        clickCount: 1
      });
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: focused.point.x,
        y: focused.point.y,
        button: "left",
        clickCount: 1
      });
    }

    if (!focused.textReady) {
      await chrome.debugger.sendCommand(debuggee, "Input.insertText", { text: message });
    }

    await delay(120);
    const typed = await sendTabMessageWithRetry(
      tabId,
      { type: "BTG_VERIFY_PROFILE_DM_TEXT", message, username },
      2,
      200,
      messageOptions
    );
    if (!typed?.ok) return typed;
    if (!typed.textReady) {
      return {
        ok: false,
        retryable: true,
        error:
          "Chrome metin girdisi mesaj kutusuna ulaşmadı; " +
          `alan ${Number(typed.currentLength || 0)} karakter olarak görüldü.`
      };
    }

    await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    inputSent = true;
  } catch (error) {
    return {
      ok: false,
      retryable: false,
      error:
        "Chrome fare/klavye girdisi başlatılamadı. Sekmede geliştirici araçları açıksa kapatıp yeniden deneyin. " +
        readableError(error)
    };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // Sekme kapanmış veya Chrome erişimi zaten ayırmış olabilir.
      }
    }
  }

  if (!inputSent) {
    return {
      ok: false,
      error: "Chrome Enter girdisi gönderilemedi."
    };
  }

  return sendTabMessageWithRetry(
    tabId,
    { type: "BTG_VERIFY_PROFILE_DM_SENT", message, username },
    2,
    250,
    messageOptions
  );
}

async function clickProfileMessageAndWait(tabId, point, rawDestinationUrl) {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return { ok: false, error: "Mesaj düğmesinin ekran konumu okunamadı." };
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawDestinationUrl);
  } catch {
    return { ok: false, error: "Mesaj hedef adresi geçersiz." };
  }

  const debuggee = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y
    });
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
  } catch (error) {
    return {
      ok: false,
      error: "Profil Mesaj düğmesine Chrome fare girdisi gönderilemedi. " + readableError(error)
    };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // Sekme kapanmış veya Chrome erişimi zaten ayırmış olabilir.
      }
    }
  }

  // Adres sohbet rotasına geçip yerleşir yerleşmez devam edilir; süresi içinde
  // değişmezse tıklama işe yaramamış sayılır.
  const settledTab = await waitForMessagesUrl(
    tabId,
    PROFILE_MESSAGE_CLICK_URL_TIMEOUT_MS,
    PROFILE_MESSAGE_CLICK_SETTLE_TIMEOUT_MS
  );
  const tab = settledTab || (await chrome.tabs.get(tabId));
  const finalUrl = String(tab?.url || "");
  if (isBusinessSuiteMessagesUrl(finalUrl)) {
    return {
      ok: true,
      clicked: true,
      route: "business-suite",
      url: finalUrl,
      recoveryUrl: targetUrl.href
    };
  }
  if (isNormalMessagesUrl(finalUrl)) {
    return {
      ok: true,
      clicked: true,
      route: "normal",
      url: finalUrl,
      recoveryUrl: buildNormalMessagesTargetUrl(targetUrl).href
    };
  }
  return {
    ok: false,
    clicked: true,
    finalUrl,
    error: "Mesaj düğmesine tıklandı ancak sohbet sayfası açılmadı."
  };
}

// Doğrudan adres sohbet rotasına oturmadığında yedek yol: profil yeniden
// açılır, Mesaj düğmesi yeniden bulunur ve Chrome fare tıklaması gönderilir.
async function clickProfileMessageFallback(tabId, profileUrl, username, destinationUrl) {
  try {
    await chrome.tabs.update(tabId, { url: profileUrl, active: true });
    await waitForTabComplete(tabId, 20000);
    await delay(400);
  } catch (error) {
    return { ok: false, finalUrl: "", error: readableError(error) };
  }
  const reopen = await openProfileMessageWithReloads(tabId, 1, username, true);
  const result = reopen.result;
  if (!result?.ok || !result.messageButtonPoint) {
    return {
      ok: false,
      finalUrl: profileUrl,
      error: result?.error || "Mesaj düğmesi yeniden bulunamadı."
    };
  }
  return clickProfileMessageAndWait(
    tabId,
    result.messageButtonPoint,
    result.destinationUrl || destinationUrl
  );
}

async function navigateToPreferredDmTarget(tabId, rawDestinationUrl) {
  let targetUrl;
  try {
    targetUrl = new URL(rawDestinationUrl);
  } catch {
    return { ok: false, finalUrl: "" };
  }

  const direct = await navigateTabAndReadFinalUrl(tabId, targetUrl.href);
  if (isBusinessSuiteMessagesUrl(direct.url)) {
    return {
      ok: true,
      route: "business-suite",
      url: direct.url,
      recoveryUrl: targetUrl.href,
      bootstrapped: false
    };
  }

  const baseUrl = new URL("/business-suite/messages", targetUrl.origin);
  baseUrl.searchParams.set("from", "homepage");
  baseUrl.searchParams.set("lang", targetUrl.searchParams.get("lang") || "tr-TR");
  const base = await navigateTabAndReadFinalUrl(tabId, baseUrl.href);
  if (isBusinessSuiteMessagesUrl(base.url)) {
    const restored = await navigateTabAndReadFinalUrl(tabId, targetUrl.href);
    if (isBusinessSuiteMessagesUrl(restored.url)) {
      return {
        ok: true,
        route: "business-suite",
        url: restored.url,
        recoveryUrl: targetUrl.href,
        bootstrapped: true
      };
    }
  }

  const normalUrl = buildNormalMessagesTargetUrl(targetUrl);
  const normal = await navigateTabAndReadFinalUrl(tabId, normalUrl.href);
  return isNormalMessagesUrl(normal.url)
    ? {
        ok: true,
        route: "normal",
        url: normal.url,
        recoveryUrl: normalUrl.href,
        bootstrapped: false
      }
    : { ok: false, finalUrl: normal.url || base.url || direct.url };
}

function buildNormalMessagesTargetUrl(targetUrl) {
  const normalUrl = new URL("/messages", targetUrl.origin);
  normalUrl.searchParams.set("lang", targetUrl.searchParams.get("lang") || "tr-TR");
  const targetUserId = targetUrl.searchParams.get("u");
  if (targetUserId) normalUrl.searchParams.set("u", targetUserId);
  return normalUrl;
}

async function navigateTabAndReadFinalUrl(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: true });
  const started = Date.now();
  let lastUrl = "";
  let stableSince = Date.now();
  let lastTab = null;

  while (Date.now() - started < 20000) {
    lastTab = await chrome.tabs.get(tabId);
    const currentUrl = String(lastTab?.url || "");
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      stableSince = Date.now();
    }
    if (lastTab?.status === "complete" && Date.now() - stableSince >= 1000) {
      return { url: currentUrl, status: lastTab.status };
    }
    await delay(200);
  }

  return {
    url: String(lastTab?.url || ""),
    status: lastTab?.status || "unknown"
  };
}

// Sekme adresi Business Suite veya normal Mesajlar rotasına geçene kadar bekler.
// Adres urlTimeoutMs içinde rotaya geçmezse null döner. Geçtikten sonra sayfa
// tamamlanmış ve adres en az 600 ms boyunca değişmemiş olmalıdır (en fazla
// settleTimeoutMs); böylece profil → business-suite → normal yönlendirme
// zinciri yarıda yakalanmaz.
async function waitForMessagesUrl(tabId, urlTimeoutMs, settleTimeoutMs) {
  const started = Date.now();
  const urlLimit = Math.max(0, Number(urlTimeoutMs) || 0);
  const settleLimit = Math.max(urlLimit, Number(settleTimeoutMs) || 0);
  let lastUrl = "";
  let matchedSince = 0;
  while (Date.now() - started < settleLimit) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
    const url = String(tab?.url || "");
    const matches = isBusinessSuiteMessagesUrl(url) || isNormalMessagesUrl(url);
    if (!matches) {
      matchedSince = 0;
      if (Date.now() - started >= urlLimit) return null;
    } else if (url !== lastUrl || !matchedSince) {
      matchedSince = Date.now();
    }
    lastUrl = url;
    if (matches && tab?.status === "complete" && Date.now() - matchedSince >= 600) {
      return tab;
    }
    await delay(150);
  }
  return null;
}

function isBusinessSuiteMessagesUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const isTikTok =
      url.hostname === "tiktok.com" ||
      url.hostname.endsWith(".tiktok.com");
    return isTikTok && url.pathname === "/business-suite/messages";
  } catch {
    return false;
  }
}

function isNormalMessagesUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const isTikTok =
      url.hostname === "tiktok.com" ||
      url.hostname.endsWith(".tiktok.com");
    return isTikTok && url.pathname === "/messages";
  } catch {
    return false;
  }
}

async function patchRuntime(patch, log) {
  const {
    runtime,
    publisherHistory: storedHistory,
    messagedPublishers: storedMessagedPublishers
  } = await chrome.storage.local.get([
    "runtime",
    "publisherHistory",
    "messagedPublishers"
  ]);
  const current = { ...EMPTY_RUNTIME, ...(runtime || {}) };
  const logs = Array.isArray(current.logs) ? [...current.logs] : [];
  if (log) {
    logs.unshift(makeLog(log.level, log.username, log.message));
  }
  const next = {
    ...current,
    ...patch,
    lastActivityAt: new Date().toISOString(),
    lastStep: patch.lastStep || (patch.status ? patch.status : current.lastStep),
    logs: logs.slice(0, 100)
  };
  const publisherHistory = mergeProcessedIntoHistory(
    normalizePublisherHistory(storedHistory),
    patch.processed
  );
  const messagedPublishers = mergeProcessedIntoMessagedPublishers(
    normalizeMessagedPublishers(storedMessagedPublishers),
    patch.processed
  );
  await chrome.storage.local.set({ runtime: next, publisherHistory, messagedPublishers });
  return { ok: true, runtime: next };
}

async function updateActiveStatus(username, status, lastStep) {
  try {
    const { runtime } = await chrome.storage.local.get("runtime");
    if (!runtime?.running) return;
    await patchRuntime(
      {
        currentUsername: username,
        status,
        lastStep
      }
    );
  } catch {
    // Tanılama güncellemesi ana DM akışını durdurmamalıdır.
  }
}

// İçerik betiğinin her yayıncı için ölçtüğü aşama süreleri; eklenti penceresinde
// gösterilir ve tanılama dosyasına eklenir. Son 100 kayıt tutulur.
async function recordTiming(rawTiming) {
  const { runtime } = await chrome.storage.local.get("runtime");
  const current = { ...EMPTY_RUNTIME, ...(runtime || {}) };
  const timings = Array.isArray(current.timings) ? current.timings : [];
  const rawDetails =
    rawTiming?.details && typeof rawTiming.details === "object" ? rawTiming.details : {};
  const timing = {
    username: String(rawTiming?.username || "").slice(0, 64),
    outcome: String(rawTiming?.outcome || "").slice(0, 40),
    total: sanitizeDurationMs(rawTiming?.total),
    phases: sanitizeDurationMap(rawTiming?.phases),
    details: Object.fromEntries(
      Object.entries(rawDetails)
        .slice(0, 10)
        .map(([key, value]) => [String(key).slice(0, 32), sanitizeDurationMap(value)])
    ),
    time: new Date().toISOString()
  };
  await chrome.storage.local.set({
    runtime: { ...current, timings: [...timings, timing].slice(-100) }
  });
  return { ok: true };
}

function sanitizeDurationMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : 0;
}

function sanitizeDurationMap(raw) {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw)
      .slice(0, 20)
      .map(([key, value]) => [String(key).slice(0, 32), sanitizeDurationMs(value)])
  );
}

async function hasPublisherHistory(rawUsername) {
  const username = sanitizeUsername(rawUsername);
  const { publisherHistory: storedHistory } = await chrome.storage.local.get("publisherHistory");
  const publisherHistory = normalizePublisherHistory(storedHistory);
  const entry = publisherHistory.entries[normalizeUsernameKey(username)];
  return { ok: true, found: Boolean(entry), entry: entry || null };
}

async function hasMessagedPublisher(rawUsername) {
  const username = sanitizeUsername(rawUsername);
  const { messagedPublishers: storedMessagedPublishers } = await chrome.storage.local.get(
    "messagedPublishers"
  );
  const messagedPublishers = normalizeMessagedPublishers(storedMessagedPublishers);
  const entry = messagedPublishers.entries[normalizeUsernameKey(username)];
  return { ok: true, messaged: Boolean(entry), entry: entry || null };
}

async function exportPublisherHistory() {
  const { publisherHistory: storedHistory } = await chrome.storage.local.get("publisherHistory");
  const publisherHistory = normalizePublisherHistory(storedHistory);
  const publishers = Object.values(publisherHistory.entries)
    .sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)));
  return {
    ok: true,
    data: {
      format: "btg-denenmis-yayincilar",
      version: 1,
      exportedAt: new Date().toISOString(),
      total: publishers.length,
      publishers
    }
  };
}

async function exportDiagnostics() {
  const stored = await chrome.storage.local.get([
    "settings",
    "runtime",
    "publisherHistory"
  ]);
  const runtime = { ...EMPTY_RUNTIME, ...(stored.runtime || {}) };
  const publisherHistory = normalizePublisherHistory(stored.publisherHistory);
  const tabIds = [
    ["controller", runtime.controllerTabId],
    ["backstage", runtime.backstageTabId]
  ];
  const tabs = {};

  for (const [name, tabId] of tabIds) {
    if (!tabId) continue;
    try {
      const tab = await chrome.tabs.get(tabId);
      tabs[name] = {
        id: tab.id,
        status: tab.status,
        url: tab.url || "",
        active: Boolean(tab.active)
      };
    } catch {
      tabs[name] = { id: tabId, missing: true };
    }
  }

  return {
    ok: true,
    data: {
      format: "btg-tanilama",
      version: 1,
      extensionVersion: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      runtime,
      settings: {
        mode: ["live", "foryou", "list", "mobile", "manual", "collect", "personal"].includes(stored.settings?.mode)
          ? stored.settings.mode
          : "live",
        liveProfileMessaging: stored.settings?.liveProfileMessaging === true,
        minFollowers: clampNumber(stored.settings?.minFollowers, 0, 1000000000, 0),
        minDelaySeconds: stored.settings?.minDelaySeconds,
        maxDelaySeconds: stored.settings?.maxDelaySeconds,
        maxPerSession: stored.settings?.maxPerSession,
        listFileName: String(stored.settings?.listFileName || ""),
        manualUsernameCount: sanitizeUsernameList(
          String(stored.settings?.manualUsernamesText || "").split(/\r?\n/)
        ).length,
        listUsernameCount: Array.isArray(stored.settings?.listUsernames)
          ? stored.settings.listUsernames.length
          : 0,
        messageLength: String(stored.settings?.message || "").length
      },
      publisherHistoryCount: Object.keys(publisherHistory.entries).length,
      reportRowCount: Array.isArray(runtime.reportRows) ? runtime.reportRows.length : 0,
      tabs
    }
  };
}

// Kişisel mesaj kayıtlarından Sonnet/Haiku için model notu yazar. Kayıtlar
// silinmez; klasör izni yoksa düğmeyle yeniden denenebilir.
async function exportPersonalNotes() {
  const { runtime } = await chrome.storage.local.get("runtime");
  const rows = Array.isArray(runtime?.personalRows) ? runtime.personalRows : [];
  if (!rows.length) return { ok: false, error: "Model notu için toplanmış yayıncı yok." };
  try {
    if (typeof BTGPersonalPackage === "undefined" || typeof BTGOutput === "undefined") {
      throw new Error("Model notu modülü yüklenemedi; eklentiyi yeniden yükleyin.");
    }
    const now = new Date();
    const text = BTGPersonalPackage.buildMarkdown(rows, { createdAt: now });
    const saved = await BTGOutput.save(
      BTGPersonalPackage.fileName(now, { tikleap: rows.some((row) => row?.tikleap) }),
      new Blob([text], { type: "text/markdown;charset=utf-8" })
    );
    await patchRuntime({}, {
      level: "success",
      username: "",
      message: `${rows.length} yayıncılık model notu çıktı klasörüne kaydedildi: ${saved.name}`
    });
    return { ok: true, name: saved.name, count: rows.length };
  } catch (error) {
    const detail = readableError(error);
    await patchRuntime({}, {
      level: "error",
      username: "",
      message: `${rows.length} yayıncı korunuyor; model notu kaydedilemedi: ${detail}. Çıktı klasörü iznini kontrol edip “Model notu” düğmesiyle tekrar kaydedin.`
    });
    return { ok: false, error: detail };
  }
}

async function exportReport() {
  const { runtime, settings } = await chrome.storage.local.get(["runtime", "settings"]);
  if (settings?.mode === "collect") {
    const rows = Array.isArray(runtime?.collectionRows)
      ? runtime.collectionRows.map((row) => ({
          username: sanitizeReportText(row?.username, 64),
          classId: [0, 1, 2, 3].includes(row?.classId) ? row.classId : null,
          followerCount: row?.followerCount ?? null,
          checkedAt: validIsoDate(row?.checkedAt) || '',
          assessment: row?.assessment || null,
          summary: sanitizeReportText(row?.assessment?.summary || row?.summary || "Değerlendirme kaydı yok.", 240)
        }))
      : [];
    return { ok: true, mode: "collect", exportedAt: new Date().toISOString(), rows };
  }
  if (settings?.mode === "personal") {
    const rows = Array.isArray(runtime?.personalRows) ? runtime.personalRows : [];
    return { ok: true, mode: "personal", exportedAt: new Date().toISOString(), count: rows.length };
  }
  const rows = Array.isArray(runtime?.reportRows)
    ? runtime.reportRows.map((row, index) => ({
        order: Number(row?.order || index + 1),
        username: sanitizeReportText(row?.username, 64),
        backstageResult: sanitizeReportText(row?.backstageResult, 500),
        outcome: sanitizeReportText(row?.outcome, 200),
        detail: sanitizeReportText(row?.detail, 1000),
        checkedAt: validIsoDate(row?.checkedAt) || ""
      }))
    : [];
  return {
    ok: true,
    mode: String(settings?.mode || ""),
    exportedAt: new Date().toISOString(),
    rows
  };
}

function sanitizeReportText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, maxLength);
}

async function importPublisherHistory(rawPublishers) {
  if (!Array.isArray(rawPublishers)) {
    return { ok: false, error: "Geçmiş dosyasında yayıncı listesi bulunamadı." };
  }

  const {
    publisherHistory: storedHistory,
    messagedPublishers: storedMessagedPublishers
  } = await chrome.storage.local.get(["publisherHistory", "messagedPublishers"]);
  let publisherHistory = normalizePublisherHistory(storedHistory);
  let imported = 0;
  for (const rawEntry of rawPublishers) {
    try {
      const username = sanitizeUsername(
        typeof rawEntry === "string" ? rawEntry : rawEntry?.username
      );
      const key = normalizeUsernameKey(username);
      if (!publisherHistory.entries[key]) imported += 1;
      const existing = publisherHistory.entries[key];
      publisherHistory.entries[key] = {
        username,
        result: String(rawEntry?.result || existing?.result || "imported"),
        checkedAt: validIsoDate(rawEntry?.checkedAt) || existing?.checkedAt || new Date().toISOString(),
        backstageChecked: rawEntry?.backstageChecked === true || existing?.backstageChecked === true
      };
    } catch {
      // Geçersiz satırlar atlanır.
    }
  }
  publisherHistory.updatedAt = new Date().toISOString();
  const messagedPublishers = mergeProcessedIntoMessagedPublishers(
    normalizeMessagedPublishers(storedMessagedPublishers),
    rawPublishers
  );
  await chrome.storage.local.set({ publisherHistory, messagedPublishers });
  return {
    ok: true,
    imported,
    count: Object.keys(publisherHistory.entries).length
  };
}

async function clearPublisherHistory() {
  await chrome.storage.local.set({ publisherHistory: { ...EMPTY_PUBLISHER_HISTORY } });
  return { ok: true, count: 0 };
}

function normalizePublisherHistory(rawHistory) {
  const entries = rawHistory?.entries && typeof rawHistory.entries === "object"
    ? { ...rawHistory.entries }
    : {};
  return {
    entries,
    updatedAt: validIsoDate(rawHistory?.updatedAt) || ""
  };
}

function normalizeMessagedPublishers(rawMessagedPublishers) {
  const entries = rawMessagedPublishers?.entries && typeof rawMessagedPublishers.entries === "object"
    ? { ...rawMessagedPublishers.entries }
    : {};
  return {
    entries,
    updatedAt: validIsoDate(rawMessagedPublishers?.updatedAt) || ""
  };
}

function mergeProcessedIntoMessagedPublishers(messagedPublishers, rawProcessed) {
  if (!Array.isArray(rawProcessed)) return messagedPublishers;
  let changed = false;
  for (const item of rawProcessed) {
    try {
      const result = String(item?.result || "");
      if (!MESSAGED_RESULTS.has(result)) continue;
      const username = sanitizeUsername(item?.username);
      const key = normalizeUsernameKey(username);
      const messagedAt =
        validIsoDate(item?.messagedAt || item?.time || item?.checkedAt) || new Date().toISOString();
      const existing = messagedPublishers.entries[key];
      if (!existing || String(existing.messagedAt) < messagedAt) {
        messagedPublishers.entries[key] = { username, result, messagedAt };
        changed = true;
      }
    } catch {
      // Geçersiz hesaplar mesaj yazılmış hesaplar defterine alınmaz.
    }
  }
  if (changed) messagedPublishers.updatedAt = new Date().toISOString();
  return messagedPublishers;
}

function mergeProcessedIntoHistory(history, rawProcessed) {
  if (!Array.isArray(rawProcessed)) return history;
  let changed = false;
  for (const item of rawProcessed) {
    try {
      const username = sanitizeUsername(item?.username);
      const key = normalizeUsernameKey(username);
      const checkedAt = validIsoDate(item?.time) || new Date().toISOString();
      const existing = history.entries[key];
      if (!existing || String(existing.checkedAt) < checkedAt) {
        history.entries[key] = {
          username,
          result: String(item?.result || "checked"),
          checkedAt,
          backstageChecked: item?.backstageChecked === true || existing?.backstageChecked === true
        };
        changed = true;
      }
    } catch {
      // Geçersiz çalışma kayıtları kalıcı geçmişe alınmaz.
    }
  }
  if (changed) history.updatedAt = new Date().toISOString();
  return history;
}

function normalizeUsernameKey(username) {
  return String(username || "").toLocaleLowerCase("tr");
}

function validIsoDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isVersionOlderThan(value, target) {
  const left = String(value || "").split(".").map((part) => Number(part) || 0);
  const right = String(target || "").split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

// Tek mesajlı eski kayıtlarda mesaj birinci kutuya konur. Hazır alternatifler
// yalnız kayıtlı mesaj varsayılan metinse eklenir: kendi adıyla mesaj yazmış
// bir kullanıcıya başka imzalı metin gitmemeli; kutuları kendisi doldurur.
function withMessageVariants(settings, storedSettings) {
  if (Array.isArray(storedSettings?.messages)) return settings;
  const first = String(storedSettings?.message || DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;
  return {
    ...settings,
    messages: first === DEFAULT_MESSAGE.trim() ? [...DEFAULT_MESSAGE_VARIANTS] : [first, "", ""]
  };
}

// Alan sırası korunur (boş alan boş kalır); böylece günlükteki “Mesaj 2”
// eklenti penceresindeki ikinci kutuyu gösterir.
function sanitizeMessageVariants(rawMessages, fallback) {
  const variants = Array.isArray(rawMessages)
    ? rawMessages.slice(0, MAX_MESSAGE_VARIANTS).map((value) => (typeof value === "string" ? value.trim() : ""))
    : [];
  if (variants.some(Boolean)) return variants;
  return [String(fallback || DEFAULT_MESSAGE).trim()];
}

async function readOutreachMessageVariants() {
  const { settings } = await chrome.storage.local.get("settings");
  return sanitizeMessageVariants(settings?.messages, settings?.message).filter(Boolean);
}

function sanitizeSettings(raw) {
  const input = raw || {};
  const messages = sanitizeMessageVariants(input.messages, input.message);
  const min = clampNumber(input.minDelaySeconds, 2, 120, DEFAULT_SETTINGS.minDelaySeconds);
  const max = clampNumber(input.maxDelaySeconds, min, 180, DEFAULT_SETTINGS.maxDelaySeconds);
  const mode = ["live", "foryou", "list", "mobile", "manual", "collect", "personal"].includes(input.mode) ? input.mode : "live";
  return {
    mode,
    message: messages.find(Boolean),
    messages,
    liveProfileMessaging: ["live", "manual"].includes(mode) && input.liveProfileMessaging === true,
    minFollowers: clampNumber(input.minFollowers, 0, 1000000000, DEFAULT_SETTINGS.minFollowers),
    requireFiveActiveDays: input.requireFiveActiveDays === true,
    personalSource: mode === "personal" && input.personalSource === "tikleap" ? "tikleap" : "feed",
    minDelaySeconds: min,
    maxDelaySeconds: max,
    maxPerSession: clampNumber(input.maxPerSession, 1, 500, DEFAULT_SETTINGS.maxPerSession),
    listUsernames: sanitizeUsernameList(input.listUsernames),
    usePersonalizedMessages: mode === 'manual' && input.usePersonalizedMessages === true,
    personalizedMessages: mode === 'manual' && input.usePersonalizedMessages === true ? sanitizePersonalizedMessages(input.personalizedMessages) : {},
    // Ajansın mevcut yayıncılarına bilgilendirme: yalnız özel Excel ve Anlık mesajlar ile.
    existingCreatorNotice: mode === 'manual' && input.usePersonalizedMessages === true &&
      input.liveProfileMessaging !== true && input.existingCreatorNotice === true,
    listFileName: String(input.listFileName || "").trim().slice(0, 180),
    manualUsernamesText: String(input.manualUsernamesText || "").slice(0, 200000),
    skipBackstageCheck: false
  };
}

function sanitizePersonalizedMessages(raw) {
  const output = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return output;
  for (const [name, value] of Object.entries(raw).slice(0,10000)) {
    try {
      const key = sanitizeUsername(name).toLowerCase();
      if (typeof value !== 'string' || !value.trim() || value.length > 5000) continue;
      output[key] = value.replace(/\r\n?/g,'\n').trim();
    } catch { /* Invalid mapping is rejected by start validation. */ }
  }
  return output;
}

function sanitizeUsernameList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const output = [];
  const seen = new Set();
  for (const value of rawList.slice(0, 10000)) {
    try {
      const username = sanitizeUsername(value);
      const key = normalizeUsernameKey(username);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(username);
    } catch {
      // Dosya okuyucu geçersiz satırları zaten gösterir; güvenlik için burada da atlanır.
    }
  }
  return output;
}

function sanitizeUsername(value) {
  const username = String(value || "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{2,32}$/.test(username)) {
    throw new Error("Geçersiz TikTok kullanıcı adı: " + username);
  }
  return username;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function usesBackstageInstantMessages(mode, liveProfileMessaging = false) {
  return ["manual", "live"].includes(mode) && !liveProfileMessaging;
}

function isExistingCreatorNoticeRun(runtime) {
  return runtime?.mode === "manual" && runtime.existingCreatorNotice === true &&
    usesBackstageInstantMessages(runtime.mode, runtime.liveProfileMessaging);
}

async function isFeedbackBackstageSendActive(sender, rawUsername) {
  if (!sender?.tab?.id || !sender.url?.startsWith('https://live-backstage.tiktok.com/portal/anchor/instant-messages')) return false;
  let username;
  try { username = sanitizeUsername(rawUsername).toLowerCase(); }
  catch { return false; }
  const queue = getFeedbackQueue();
  if (!queue.isActive()) return false;
  const {queue: state} = await queue.status();
  const current = state?.rows?.find(row => row.status === 'in_flight');
  return state?.backstageTabId === sender.tab.id && current?.username?.toLowerCase() === username;
}

async function sendFeedbackBackstageInstantMessage(rawUsername, rawMessage, controllerTabId, backstageTabId) {
  const username = sanitizeUsername(rawUsername);
  const message = String(rawMessage || '').trim();
  if (!message) return {ok:false,error:'Gönderilecek mesaj boş.'};
  const queue = getFeedbackQueue();
  if (!queue.isActive()) return {ok:false,error:'Excel geri bildirim gönderimi artık çalışmıyor.'};
  const {queue: state} = await queue.status();
  const current = state?.rows?.find(row => row.status === 'in_flight');
  if (state?.controllerTabId !== controllerTabId || state?.backstageTabId !== backstageTabId ||
      current?.username?.toLowerCase() !== username.toLowerCase()) {
    return {ok:false,error:'Excel geri bildirim alıcısı veya Backstage sekmesi değişti; mesaj gönderilmedi.'};
  }

  // Ajansın mevcut yayıncıları için yalnız arama sonucunun tekil ve güncel
  // kullanıcı olduğunu doğrula. Davet uygunluğu bu gönderim yoluna uygulanmaz.
  const recipient = await sendBackstageCheckWithRecovery(backstageTabId, username, 'manual', false, true);
  if (!recipient?.ok) return {ok:false,error:recipient?.error || 'Backstage alıcısı doğrulanamadı.'};

  let result;
  try {
    // Excel geri bildirimi mevcut sohbeti kullanabilir; normal ilk temas akışının
    // mevcut yazışmayı atlama davranışı backstage-content.js içinde korunur.
    result = await sendBackstageMessage(backstageTabId, {
      type:'BTG_BACKSTAGE_SEND_DM', username, message, feedback:true
    });
  } catch (error) {
    return {ok:false,error:readableError(error)};
  }
  if (result?.ok && result.sent === true) {
    const stored = await chrome.storage.local.get('messagedPublishers');
    const messagedPublishers = mergeProcessedIntoMessagedPublishers(
      normalizeMessagedPublishers(stored.messagedPublishers),
      [{username,result:'sent',time:new Date().toISOString()}]
    );
    await chrome.storage.local.set({messagedPublishers});
    return {...result,verifiedInConversation:true};
  }
  if (result?.ok && (result.unavailableSkipped || result.alreadySent)) return result;
  return {ok:false,error:result?.error || 'Backstage sohbetinde mesaj gönderimi doğrulanamadı.'};
}


const TIKLEAP_START_URL = "https://www.tikleap.com/country/tr/league/a1";

// Tikleap ligleri tikleap.com sekmesinin içinde okunur: site Cloudflare
// doğrulaması kullanıyor ve çerezler yalnız o sekmede geçerli.
async function readTikleapQueue() {
  await patchRuntime({ status: "Tikleap liglerindeki yayıncılar okunuyor" });
  const existing = await chrome.tabs.query({ url: ["https://www.tikleap.com/*", "https://tikleap.com/*"] });
  let tab = existing[0];
  const created = !tab;
  let keepTab = !created;
  try {
    if (created) tab = await chrome.tabs.create({ url: TIKLEAP_START_URL, active: false });
    await waitForTabComplete(tab.id, 30000);
    let ready = false;
    for (let attempt = 0; attempt < 10 && !ready; attempt += 1) {
      const [probe] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => Boolean(document.body) && !/moment|dakika|cloudflare|attention/i.test(document.title)
      });
      ready = probe?.result === true;
      if (!ready) await delay(1500);
    }
    if (!ready) {
      keepTab = true;
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      return { ok: false, error: "tikleap.com doğrulama ekranında. Açılan Tikleap sekmesinde doğrulamayı geçip tekrar başlatın." };
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/tikleap-league.js"] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.BTGTikleap.readQueue()
    });
    const data = result?.result;
    const failed = Object.keys(data?.errors || {}).map((code) => code.toUpperCase());
    if (!data?.total) {
      keepTab = true;
      return { ok: false, error: `Tikleap ligleri okunamadı (${Object.values(data?.errors || {})[0] || "bilinmeyen hata"}). Tikleap sekmesini yenileyip tekrar deneyin.` };
    }
    // Canlı olanlar önce işlenir ve anlık yayın verisiyle yazılır; canlı olmayanlar
    // yalnız profilden okunan yayın geçmişi ve kartla devam eder.
    const liveCount = Number(data.liveCount) || 0;
    const summary = `Tikleap: ${data.queue.length} lig yayıncısı okundu; ${liveCount} kişi şu an canlı (anlık verilerle), ${data.queue.length - liveCount} kişi canlı değil (profil verisiyle)` +
      (failed.length ? `; okunamayan ligler: ${failed.join(", ")}` : "");
    return { ok: true, queue: data.queue, summary };
  } catch (error) {
    return { ok: false, error: `Tikleap ligleri okunamadı: ${readableError(error)}` };
  } finally {
    if (created && !keepTab && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function isListControllerUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!(hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"))) return false;
    if (hostname === "live-backstage.tiktok.com") return false;
    return !parsed.pathname.startsWith("/business-suite/messages") &&
      !parsed.pathname.startsWith("/messages");
  } catch {
    return false;
  }
}

function isLiveUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\/)@[A-Za-z0-9._]+\/live\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isForYouUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return (
      (hostname === "tiktok.com" || hostname === "www.tiktok.com") &&
      (
        pathname === "/" ||
        pathname === "/foryou" ||
        /^\/[a-z]{2}-[A-Z]{2}$/.test(pathname)
      )
    );
  } catch {
    return false;
  }
}

function makeLog(level, username, message) {
  return {
    time: new Date().toISOString(),
    level: level || "info",
    username: username || "",
    message: String(message || "")
  };
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error || "Bilinmeyen hata");
}

async function mobileBridgeRequest(path, body, method = "POST") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === "/next" ? 30000 : 15000);
  try {
    const response = await fetch(MOBILE_BRIDGE_URL + path, {
      method,
      headers: MOBILE_BRIDGE_HEADERS,
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
      cache: "no-store",
      signal: controller.signal
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return bridgeReplyResult(payload, response.status);
  } catch (error) {
    const detail = error?.name === "AbortError"
      ? "Mobil köprü zamanında yanıt vermedi."
      : "BTG Mobil Yayıncı Asistanı köprüsüne ulaşılamadı. Önce masaüstü uygulamasında “Köprüyü başlat” düğmesine basın.";
    return { ok: false, error: detail, error_code: "bridge_unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// DM akışındaki alt adımların sürelerini toplar; sonuç içerik betiğine döner.
function createPhaseTimer() {
  let lastAt = Date.now();
  const phases = {};
  return {
    mark(phase) {
      const now = Date.now();
      phases[phase] = (phases[phase] || 0) + (now - lastAt);
      lastAt = now;
    },
    phases() {
      return { ...phases };
    }
  };
}

// Profil sekmesi, kontrol sekmesinin yanında ve onun sekme grubunda açılır;
// böylece işlem sırasında hangi sekmenin kime ait olduğu görünür kalır ve
// sekme grubunu izleyen araçlar profil/DM adımlarını da görebilir. Kontrol
// sekmesi kullanılamıyorsa sekme eski biçimde açılır.
async function createProfileTab(url, controllerTabId) {
  if (controllerTabId) {
    try {
      const controllerTab = await chrome.tabs.get(controllerTabId);
      const created = await chrome.tabs.create({
        url,
        active: true,
        windowId: controllerTab.windowId,
        index: controllerTab.index + 1,
        openerTabId: controllerTabId
      });
      const groupId = Number(controllerTab.groupId);
      if (Number.isInteger(groupId) && groupId >= 0 && created.groupId !== groupId) {
        try {
          await chrome.tabs.group({ tabIds: created.id, groupId });
        } catch {
          // Grup kapanmış olabilir; sekme yine de kontrol sekmesinin yanındadır.
        }
      }
      return created;
    } catch {
      // Kontrol sekmesi kapanmış veya başka bir pencerede olabilir.
    }
  }
  return chrome.tabs.create({ url, active: true });
}

// Sekmedeki tüm TikTok çerçevelerine aynı iletiyi gönderir; yanıt vermeyen
// çerçeveler null sonuçla listelenir.
async function probeTikTokFrames(tabId, message) {
  let frames = [];
  try {
    frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
  } catch {
    frames = [];
  }

  const tikTokFrames = frames.filter((frame) => isTikTokUrl(frame.url));
  if (!tikTokFrames.some((frame) => frame.frameId === 0)) {
    tikTokFrames.unshift({ frameId: 0, url: "" });
  }

  return Promise.all(
    tikTokFrames.map(async (frame) => {
      try {
        const result = await chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId });
        return { frameId: frame.frameId, url: frame.url || "", result };
      } catch {
        return { frameId: frame.frameId, url: frame.url || "", result: null };
      }
    })
  );
}

async function findTikTokDmSurface(tabId, timeoutMs, username) {
  const started = Date.now();
  let pageErrorSince = 0;
  let lastProbes = [];
  while (Date.now() - started < timeoutMs) {
    const probes = await probeTikTokFrames(tabId, { type: "BTG_PROBE_DM_SURFACE", username });
    lastProbes = probes;

    const composerFrames = probes.filter((probe) => probe.result?.hasComposer);
    if (composerFrames.length) {
      composerFrames.sort((a, b) => {
        if (a.frameId === 0) return -1;
        if (b.frameId === 0) return 1;
        return a.frameId - b.frameId;
      });
      return { frameId: composerFrames[0].frameId };
    }

    if (probes.some((probe) => probe.result?.pageError)) {
      if (!pageErrorSince) pageErrorSince = Date.now();
    } else {
      pageErrorSince = 0;
    }
    await delay(250);
  }
  const diagnostics = summarizeSurfaceProbes(lastProbes);
  return pageErrorSince ? { pageError: true, diagnostics } : { diagnostics };
}

function summarizeSurfaceProbes(probes) {
  return (Array.isArray(probes) ? probes : [])
    .filter((probe) => probe?.result)
    .map((probe) => ({
      frameId: probe.frameId,
      route: String(probe.result.route || ""),
      listPresent: Boolean(probe.result.listPresent),
      listItems: Number(probe.result.listItems || 0),
      composerPresent: Boolean(probe.result.composerPresent),
      conversationUsername: String(probe.result.conversationUsername || ""),
      pageError: Boolean(probe.result.pageError)
    }));
}

// Hedef sohbet açılmadığında günlüğe yazılacak kısa özet: mesaj uygulamasını
// barındıran çerçeve seçilir; yoksa yanıt veren ilk çerçeve anlatılır.
function describeSurfaceDiagnostics(diagnostics) {
  const frames = Array.isArray(diagnostics) ? diagnostics : [];
  if (!frames.length) return "çerçevelerden yanıt alınamadı";
  const frame =
    frames.find((item) => item.listPresent) ||
    frames.find((item) => item.composerPresent) ||
    frames[frames.length - 1];
  return [
    `rota: ${frame.route || "bilinmiyor"}`,
    `sohbet listesi: ${frame.listPresent ? `${frame.listItems} sohbet` : "yok"}`,
    `açık sohbet: ${frame.conversationUsername ? `@${frame.conversationUsername}` : "yok"}`,
    `yazı alanı: ${frame.composerPresent ? "var" : "yok"}`,
    `hata metni: ${frame.pageError ? "var" : "yok"}`
  ].join("; ");
}

function readTargetUserId(rawUrl) {
  try {
    const value = String(new URL(String(rawUrl || "")).searchParams.get("u") || "").trim();
    return /^\d{3,32}$/.test(value) ? value : "";
  } catch {
    return "";
  }
}

// Hedef sohbeti, mesaj uygulamasını barındıran çerçevede yerinde açtırır.
async function recoverDmTargetInPlace(tabId, userId, username) {
  const probes = await probeTikTokFrames(tabId, {
    type: "BTG_RECOVER_DM_TARGET",
    userId,
    username
  });
  const applicable = probes.filter((probe) => probe.result?.applicable);
  if (!applicable.length) {
    return { ok: false, applicable: false, error: "Mesaj uygulaması hiçbir çerçevede bulunamadı." };
  }
  const success = applicable.find((probe) => probe.result?.ok);
  if (success) {
    return { ...success.result, ok: true, applicable: true, frameId: success.frameId };
  }
  const first = applicable[0];
  return { ...first.result, ok: false, applicable: true, frameId: first.frameId };
}

async function logDmStep(username, message) {
  try {
    await patchRuntime({}, { level: "info", username, message });
  } catch {
    // Günlük satırı ana DM akışını durdurmamalı.
  }
}

function describeUrlPath(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).pathname || "/";
  } catch {
    return "bilinmiyor";
  }
}

function formatSecondsText(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toLocaleString("tr-TR", {
    maximumFractionDigits: 1
  });
}

async function findDmSurfaceWithReloads(tabId, maxReloads, username, recoveryUrl, options = {}) {
  let reloadCount = 0;
  let surface = {};
  const targetUserId = readTargetUserId(recoveryUrl);
  const firstSearchMs = Number(options.searchMs) || DM_SURFACE_SEARCH_MS;
  const recoverySearchMs = Number(options.recoverySearchMs) || DM_SURFACE_SEARCH_AFTER_RECOVERY_MS;
  const reloadSearchMs = Number(options.reloadSearchMs) || DM_SURFACE_SEARCH_AFTER_RELOAD_MS;
  let searchMs = firstSearchMs;

  while (true) {
    await updateActiveStatus(
      username,
      `@${username} DM ekranı bekleniyor (${reloadCount + 1}/${maxReloads + 1})`,
      "DM ekranı bekleniyor"
    );
    surface = await findTikTokDmSurface(tabId, searchMs, username);
    if (surface.frameId !== undefined) {
      return { surface, reloadCount };
    }

    const detail = describeSurfaceDiagnostics(surface.diagnostics);
    const missing = `Mesaj ekranı ${formatSecondsText(searchMs)} sn içinde hedef sohbeti göstermedi (${detail})`;

    // Mesaj uygulaması yüklendiği hâlde sağdaki sohbet açılmadıysa sayfa
    // yenilenmeden önce hedef sohbet uygulamanın kendi yönlendirmesiyle yerinde
    // açtırılır; bu yol yaklaşık bir saniye sürer, tam yenileme 20-30 saniye.
    if (targetUserId && !surface.pageError) {
      await updateActiveStatus(
        username,
        `@${username} sohbeti mesaj ekranında yerinde açılıyor`,
        "Hedef sohbet yerinde açılıyor"
      );
      let recovery = await recoverDmTargetInPlace(tabId, targetUserId, username);
      if (!recovery.applicable) {
        // Mesaj uygulaması henüz hiçbir çerçevede yüklenmemiş; sayfa yalnız yavaş
        // olabilir. Yenilemeden önce bir tur daha beklenir ve yerinde açma yinelenir.
        surface = await findTikTokDmSurface(tabId, recoverySearchMs, username);
        if (surface.frameId !== undefined) {
          return { surface, reloadCount };
        }
        recovery = await recoverDmTargetInPlace(tabId, targetUserId, username);
      }
      if (recovery.ok) {
        surface = await findTikTokDmSurface(tabId, recoverySearchMs, username);
        if (surface.frameId !== undefined) {
          await logDmStep(username, `${missing}; hedef sohbet yerinde açıldı`);
          return { surface, reloadCount, recoveredInPlace: true };
        }
        await logDmStep(username, `${missing}; yerinde açma sonrası yazı alanı doğrulanamadı`);
      } else {
        await logDmStep(
          username,
          `${missing}; yerinde açma ${recovery.applicable ? "sonuç vermedi" : "uygulanamadı"}${
            recovery.error ? `: ${recovery.error}` : ""
          }`
        );
      }
    } else {
      await logDmStep(username, missing);
    }

    if (reloadCount >= maxReloads) {
      return { surface, reloadCount };
    }

    reloadCount += 1;
    await updateActiveStatus(
      username,
      `@${username} DM ekranı yenileniyor (${reloadCount}/${maxReloads})`,
      "DM ekranı yenileniyor"
    );
    if (recoveryUrl) {
      await chrome.tabs.update(tabId, { url: recoveryUrl, active: true });
    } else {
      await chrome.tabs.reload(tabId);
    }
    await waitForTabComplete(tabId, 20000);
    // Yenilemeden sonra sabit bekleme yoktur: arama yoklayarak bekler ve yazı
    // alanı gelir gelmez devam edilir.
    searchMs = reloadSearchMs;
  }
}

async function openProfileMessageWithReloads(tabId, maxReloads, username, needPoint) {
  let reloadCount = 0;
  let result;

  while (true) {
    await updateActiveStatus(
      username,
      `@${username} profilinde Mesaj düğmesi aranıyor (${reloadCount + 1}/${maxReloads + 1})`,
      "Profilde Mesaj düğmesi aranıyor"
    );
    try {
      result = await sendTabMessageWithRetry(
        tabId,
        { type: "BTG_OPEN_PROFILE_MESSAGE", needPoint: Boolean(needPoint) },
        3,
        900,
        { frameId: 0 }
      );
    } catch (error) {
      result = {
        ok: false,
        retryableProfile: true,
        error: "Profil sekmesiyle geçici olarak iletişim kurulamadı. " + readableError(error)
      };
    }

    if (result?.ok || result?.profileUnavailable || !result?.retryableProfile) {
      return { result, reloadCount, exhausted: false };
    }
    if (reloadCount >= maxReloads) {
      return { result, reloadCount, exhausted: true };
    }

    reloadCount += 1;
    await updateActiveStatus(
      username,
      `@${username} profili yenileniyor (${reloadCount}/${maxReloads})`,
      "Profil sayfası yenileniyor"
    );
    await logDmStep(
      username,
      `Profil yenileniyor (${reloadCount}/${maxReloads}): ${result?.error || "profil hazır değil"}`
    );
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId, 20000);
    await delay(1500);
  }
}

function isTikTokUrl(rawUrl) {
  try {
    if (rawUrl === "about:blank" || rawUrl === "about:srcdoc") return true;
    const hostname = new URL(rawUrl).hostname;
    return hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

async function sendTabMessageWithRetry(tabId, message, attempts, waitMs, options) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, options);
    } catch (error) {
      lastError = error;
      await delay(waitMs);
    }
  }
  throw lastError || new Error("Sekmeyle iletişim kurulamadı.");
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => finish(new Error("Profil sayfası zamanında yüklenmedi.")), timeoutMs);

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    }

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") finish();
    } catch (error) {
      finish(error);
    }
  });
}

// Tikleap kaynağında uygun yayıncının profili yeni bir TikTok sekmesinde açılır,
// veriler o sekmede toplanır ve sekme kapatılıp kontrol sekmesine dönülür.
async function collectPersonalInNewTab(username, returnTabId) {
  const clean = String(username || "").replace(/^@/, "").trim();
  if (!/^[\w.]{1,64}$/.test(clean)) return { ok: false, error: "Geçersiz kullanıcı adı." };
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: `https://www.tiktok.com/@${clean}`, active: true });
    await waitForTabComplete(tab.id, 30000).catch(() => {});
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: "BTG_COLLECT_PERSONAL", username: clean }, { frameId: 0 });
        if (result?.ok && result.profile) return { ok: true, profile: result.profile };
        return { ok: false, error: result?.error || "Profil sekmesinde veri toplanamadı." };
      } catch (error) {
        if (!isMissingReceiverError(error)) throw error;
        await delay(500);
      }
    }
    return { ok: false, error: "Profil sekmesinde eklenti kodu hazır olmadı." };
  } catch (error) {
    return { ok: false, error: readableError(error) };
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
    if (returnTabId) await chrome.tabs.update(returnTabId, { active: true }).catch(() => {});
  }
}

async function activateControllerTab(preferredTabId) {
  const { runtime } = await chrome.storage.local.get("runtime");
  const candidates = [...new Set([preferredTabId, runtime?.controllerTabId].filter(Boolean))];

  for (const tabId of candidates) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        return { ok: true, tabId, windowId: tab.windowId };
      } catch {
        if (attempt < 2) await delay(200);
      }
    }
  }

  return { ok: false, error: "TikTok yayın sekmesi etkinleştirilemedi." };
}

const MAX_CONTROLLER_RELOADS = 5;

// TikTok aşağı okla geçerken adresi yeni yayına çevirip ekranı eski yayında
// bırakabiliyor; bu durumda ok düğmesi de artık tepki vermiyor. Sekmeyi yenilemek
// yeni yayını düzgün yüklüyor (2026-09-25 canlı kaydı). Akış yenilemeden sonra
// aynı ayarlarla yeniden başlatılır; sayaçlar ve geçmiş depoda korunur.
async function reloadLiveControllerTab(senderTabId, reason) {
  const { runtime, settings } = await chrome.storage.local.get(["runtime", "settings"]);
  if (!runtime?.running || !["live", "personal"].includes(runtime.mode) || !senderTabId || runtime.controllerTabId !== senderTabId) {
    return { ok: false, error: "Canlı yayın sekmesi yenilenemedi; otomasyon oturumu doğrulanamadı." };
  }
  const reloads = Number(runtime.controllerReloads || 0);
  if (reloads >= MAX_CONTROLLER_RELOADS) {
    return {
      ok: false,
      error: `Sonraki yayına geçiş doğrulanamadı; canlı yayın sekmesi bu oturumda zaten ${MAX_CONTROLLER_RELOADS} kez yenilendi.`
    };
  }
  await patchRuntime(
    {
      controllerReloads: reloads + 1,
      status: "Canlı yayın sekmesi yenileniyor; akış kaldığı yerden sürecek",
      lastStep: "Kontrol sekmesi yenileniyor"
    },
    { level: "info", username: "", message: `${reason || "Yayın geçişi takıldı"} (${reloads + 1}/${MAX_CONTROLLER_RELOADS})` }
  );
  // Yanıt önce içerik betiğine ulaşsın; eski betik sekme yenilenince sona erer.
  restartLiveControllerAfterReload(senderTabId, settings).catch(() => {});
  return { ok: true };
}

async function restartLiveControllerAfterReload(tabId, settings) {
  await delay(300);
  try {
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId, 25000);
    await delay(1500);
    const { runtime } = await chrome.storage.local.get("runtime");
    if (!runtime?.running || runtime.controllerTabId !== tabId) return;
    const result = await startControllerWithRecovery(tabId, settings);
    if (!result?.ok) throw new Error(result?.error || "Canlı yayın akışı yeniden başlatılamadı.");
  } catch (error) {
    const { runtime } = await chrome.storage.local.get("runtime");
    if (!runtime?.running) return;
    const message = "Canlı yayın sekmesi yenilendikten sonra akış yeniden başlatılamadı: " + readableError(error);
    await patchRuntime(
      { running: false, failed: Number(runtime.failed || 0) + 1, status: message },
      { level: "error", username: "", message }
    );
  }
}

async function closeProfileAndRestoreController(profileTabId, controllerTabId) {
  await safeCloseTab(profileTabId);
  return activateControllerTab(controllerTabId);
}

async function safeCloseTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Sekme kullanıcı tarafından kapatılmış olabilir.
  }
}


// An explicit, read-only test. Kept separate from automation until live API behavior is verified.
let backstageAPIProbeBusy = false;
async function probeBackstageAPI(username, sender, mode = "worker") {
  const pageURL = chrome.runtime.getURL("src/ui/backstage-api-test.html");
  if (sender?.id !== chrome.runtime.id || sender?.url !== pageURL) {
    return { ok: false, code: "INVALID_SENDER", error: "Bu işlem yalnız doğrudan sorgu deneme ekranından kullanılabilir." };
  }
  if (backstageAPIProbeBusy) {
    return { ok: false, code: "BUSY", error: "Önceki doğrudan sorgunun tamamlanmasını bekleyin." };
  }
  backstageAPIProbeBusy = true;
  try {
    const { runtime } = await chrome.storage.local.get("runtime");
    if (runtime?.running) {
      return { ok: false, code: "AUTOMATION_RUNNING", error: "Bağlantı denemesinden önce çalışan otomasyonu durdurun." };
    }
    if (mode === "page") {
      try { username = BTGBackstageAPI.normalizeUsername(username); }
      catch { return { ok: false, code: "INVALID_USERNAME", error: "Geçerli bir kullanıcı adı yazın." }; }
      return await probeBackstagePageAPI(username, sender);
    }
    return await BTGBackstageAPI.probe(username);
  } finally {
    backstageAPIProbeBusy = false;
  }
}


async function pageAPIMessage(tabId, message, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Page API message timed out")), timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}

async function probeBackstagePageAPI(username, sender) {
  let tab;
  let result;
  const started = Date.now();
  try {
    // The trial owns this fresh tab. Existing user tabs are never reloaded or closed.
    tab = await chrome.tabs.create({
      url: "https://live-backstage.tiktok.com/portal/anchor/relation",
      active: false,
      ...(Number.isInteger(sender?.tab?.windowId) ? { windowId: sender.tab.windowId } : {})
    });
    let ready = false;
    let lastPing;
    while (Date.now() - started < 20000) {
      try {
        const ping = await pageAPIMessage(tab.id, { type: "BTG_PAGE_API_PING" }, 1000);
        lastPing = ping;
        if (ping?.ready === true && ping.contextReady === true) { ready = true; break; }
      } catch { /* Navigation or content scripts may still be starting. */ }
      await delay(300);
    }
    if (!ready) {
      result = { ok: false, code: lastPing?.ready ? "PAGE_CONTEXT_NOT_READY" : "PAGE_NOT_READY",
        error: lastPing?.ready ? "Backstage açıldı ancak ajans ve oturum başlıkları 20 saniyede öğrenilemedi."
          : "Yardımcı Backstage sekmesi 20 saniyede hazır olmadı. Backstage girişinizi kontrol edin.",
        ...(lastPing?.headerPresence ? { headerPresence: lastPing.headerPresence } : {}) };
    } else {
      result = await pageAPIMessage(tab.id, { type: "BTG_PAGE_API_CHECK", username }, 17000);
      if (!result || typeof result.ok !== 'boolean') {
        result = { ok: false, code: "INVALID_RESPONSE", error: "Yardımcı sekmeden geçerli sonuç gelmedi." };
      }
    }
  } catch {
    result = { ok: false, code: "PAGE_CONNECTION_ERROR", error: "Yardımcı Backstage sekmesiyle bağlantı tamamlanamadı." };
  } finally {
    if (tab?.id !== undefined) {
      try { await chrome.tabs.remove(tab.id); }
      catch { /* Already closed by the user or browser. */ }
    }
  }
  return { ...result, source: "page-api", username, totalElapsedMs: Date.now() - started,
    helperTabCreated: tab?.id !== undefined };
}

// Wake a silent Backstage while preserving the original pending request.
async function brieflyActivateBackstage(tabId, stillWaiting, requireRunning = false, maxVisibleMs = 3500, onReady = () => {}) {
  let previous;
  let target;
  let activated = false;
  let userChangedTab = false;
  const onActivated = info => {
    if (target && info.windowId === target.windowId && info.tabId !== tabId) userChangedTab = true;
  };
  try {
    if (requireRunning) {
      const { runtime } = await chrome.storage.local.get('runtime');
      if (!runtime?.running) return;
    }
    target = await chrome.tabs.get(tabId);
    if (!target.url?.startsWith('https://live-backstage.tiktok.com/')) return;
    const focused = await chrome.windows.getLastFocused();
    if (!focused.focused || focused.id !== target.windowId) return;
    [previous] = await chrome.tabs.query({ active: true, windowId: target.windowId });
    if (!previous || previous.id === tabId || !stillWaiting()) return;
    chrome.tabs.onActivated.addListener(onActivated);
    if (!stillWaiting()) return;
    await chrome.tabs.update(tabId, { active: true });
    activated = true;
    onReady();
    // Sabit iki saniye beklemek her hızlı yanıta gereksiz gecikme ekliyordu.
    // Yanıt gelir gelmez geri dön; yine de Backstage'e çalışması için en fazla
    // çağrının belirlediği görünür pencereyi tanı. Arama ve gönderim sırasında
    // odak kaybını önlemek için sekme yanıt gelene kadar görünür kalır.
    const visibleUntil = Date.now() + maxVisibleMs;
    while (stillWaiting() && Date.now() < visibleUntil) {
      await delay(Math.min(100, visibleUntil - Date.now()));
    }
  } catch {
    // Closing a tab or changing windows must not mask the pending query's result.
  } finally {
    // Zaten etkin sekme, farklı pencere veya erişim hatası da komutu bekletmez.
    onReady();
    try {
      if (activated && !userChangedTab && previous) {
        const [current] = await chrome.tabs.query({ active: true, windowId: target.windowId });
        if (current?.id === tabId) await chrome.tabs.update(previous.id, { active: true });
      }
    } catch { /* Previous tab may have been closed. */ }
    chrome.tabs.onActivated?.removeListener(onActivated);
  }
}

async function sendBackstageMessage(tabId, message, timeoutMs = message.type === 'BTG_BACKSTAGE_SEND_DM' ? 35000 : 20000) {
  let finished = false;
  let wakeTask;
  let deadline;
  const shouldWake = ['BTG_BACKSTAGE_CHECK', 'BTG_BACKSTAGE_BATCH_CHECK', 'BTG_BACKSTAGE_SEND_DM'].includes(message.type);
  // Arka plandaki TikTok sekmeleri zamanlayıcıları sert biçimde kısabiliyor.
  // Sekme sekiz saniye sessiz kaldıktan sonra değil, ilk 1,2 saniyede yanıt
  // vermediyse kısa süre görünür yaparak arama/gönderim işini hızlandır.
  // Backstage arama listesi yalnız kutu odaktayken açık kalır. Sekme 3,5 sn sonra
  // geri alınırsa geç gelen sonuç okunamadan kapanıyordu; kontrolde iki arama
  // denemesinin tamamı boyunca sekme görünür tutulur.
  // Sohbet, profil ve gönderim onayı yüklenirken sekme arka plana alınmamalı.
  // Gönderim komutu yalnız bir kez iletilir; yanıt veya zaman aşımı odağı geri verir.
  const isSending = message.type === 'BTG_BACKSTAGE_SEND_DM';
  const maxVisibleMs = message.type === 'BTG_BACKSTAGE_CHECK' ? 15000 : message.type === 'BTG_BACKSTAGE_BATCH_CHECK' ? 35000 : timeoutMs;
  const wakeTimer = shouldWake && !isSending ? setTimeout(() => {
    if (!finished) wakeTask = brieflyActivateBackstage(tabId, () => !finished, true, maxVisibleMs).catch(() => {});
  }, 1200) : null;
  try {
    if (isSending) {
      // Gönderimden önceki uygunluk kartı odak kaybında kapanabilir.
      // Komutu ancak sekmenin öne alınma denemesi tamamlandıktan sonra ilet.
      await new Promise(resolve => {
        wakeTask = brieflyActivateBackstage(tabId, () => !finished, !message.feedback, maxVisibleMs, resolve)
          .catch(() => resolve());
      });
    }
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) => {
        deadline = setTimeout(() => {
          const error = new Error('Backstage yanıtı zamanında gelmedi.');
          error.code = 'BACKSTAGE_TIMEOUT';
          reject(error);
        }, timeoutMs);
      })
    ]);
  } finally {
    finished = true;
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    clearTimeout(deadline);
    // Return focus before allowing the controller to continue to another creator.
    if (wakeTask) await wakeTask;
  }
}

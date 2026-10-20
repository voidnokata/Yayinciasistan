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

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} bulunamadı`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} bulunamadı`);
  return source.slice(start, end);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  // --- 1) CANLI Yayın / Sizin İçin: ayarlanan bekleme yalnız DM denemesinden sonra ---
  const liveFlow = sliceBetween(content, "async function runController()", "async function runMobileController()");
  assert.match(
    liveFlow,
    /const waitMs = attemptedDm \? randomDelayMs\(controller\.settings\) : randomSkipPacingMs\(\);/,
    "Canlı akışta bekleme DM denemesine göre seçilmeli"
  );
  assert.doesNotMatch(
    liveFlow,
    /await interruptibleDelay\(randomDelayMs\(controller\.settings\)\)/,
    "Canlı akışta her yayıncıdan sonra koşulsuz uzun bekleme kalmamalı"
  );
  assert.match(liveFlow, /attemptedDm = true;/, "DM denemesi işaretlenmeli");
  assert.ok(
    liveFlow.indexOf("attemptedDm = true;") < liveFlow.indexOf('type: "BTG_SEND_DM"'),
    "DM denemesi işareti DM gönderiminden önce konmalı"
  );
  assert.match(
    liveFlow,
    /if \(attemptedDm\) \{[\s\S]{0,400}?await interruptibleDelay\(500\);/,
    "Sekmeye dönüş beklemesi yalnız DM denemesinden sonra uygulanmalı"
  );
  assert.match(liveFlow, /timer\.mark\("backstage"\);/);
  assert.match(liveFlow, /timer\.mark\("bekleme"\);/);
  assert.match(liveFlow, /timer\.mark\("geçiş"\);/);
  assert.match(liveFlow, /await recordTiming\(username, outcome, timer\);/);
  assert.match(liveFlow, /sn bekleniyor/, "Bekleme sırasında durum satırı süreyi göstermeli");

  // --- 2) Excel Listesi / Listeden Kontrol -----------------------------------
  const listFlow = sliceBetween(content, "async function runListController()", "function makeListReportRow(");
  assert.match(
    listFlow,
    /const waitMs = attemptedDm \? randomDelayMs\(controller\.settings\) : randomSkipPacingMs\(\);/,
    "Liste akışında bekleme DM denemesine göre seçilmeli"
  );
  assert.doesNotMatch(listFlow, /await interruptibleDelay\(randomDelayMs\(controller\.settings\)\)/);
  assert.match(listFlow, /await recordTiming\(username, outcome, timer\);/);
  assert.match(
    listFlow,
    /if \(attemptedDm\) \{[\s\S]{0,400}?type: "BTG_ACTIVATE_CONTROLLER"/,
    "Liste akışında kontrol sekmesi yalnız DM sonrası öne alınmalı"
  );

  // --- 3) Mobil Telefon akışı değişmedi ---------------------------------------
  const mobileFlow = sliceBetween(content, "async function runMobileController()", "async function runListController()");
  assert.match(
    mobileFlow,
    /await interruptibleDelay\(randomDelayMs\(controller\.settings\)\)/,
    "Mobil akışta telefonun yerleşmesi için ayarlanan bekleme korunmalı"
  );

  // --- 4) Kısa geçiş aralığı, zamanlayıcı ve DM sonucu ----------------------
  assert.match(content, /const SKIP_PACING_RANGE_MS = \[600, 1200\];/);
  assert.match(content, /const LIVE_FOLLOWER_POPOVER_TIMEOUTS_MS = \[1500, 1200\];/);
  assert.match(content, /const LIVE_FOLLOWER_TRIGGER_TIMEOUT_MS = 2500;/);
  assert.match(content, /const LIVE_FOLLOWER_CARD_COOLDOWN = 5;/, "Kart başarısızlığı geçici olmalı");
  assert.doesNotMatch(content, /liveCardDisabled/, "Kart oturum boyunca kapatılmamalı");
  assert.match(
    liveFlow,
    /if \(dm\?\.ok && dm\.followerSkipped\) attemptedDm = false;/,
    "Profil sekmesinden okunan sayaçla elenen hesaptan sonra kısa aralık uygulanmalı"
  );
  const context = { console, Date, Math };
  vm.createContext(context);
  vm.runInContext(
    [
      "const SKIP_PACING_RANGE_MS = [600, 1200];",
      extractFunction(content, "randomSkipPacingMs"),
      extractFunction(content, "createPhaseTimer"),
      extractFunction(content, "describeDmOutcome"),
      extractFunction(content, "formatSeconds")
    ].join("\n"),
    context
  );

  const randomSkipPacingMs = vm.runInContext("randomSkipPacingMs", context);
  for (let index = 0; index < 300; index += 1) {
    const value = randomSkipPacingMs();
    assert.ok(Number.isInteger(value) && value >= 600 && value <= 1200, `aralık dışı: ${value}`);
  }

  const createPhaseTimer = vm.runInContext("createPhaseTimer", context);
  const timer = createPhaseTimer();
  await sleep(40);
  timer.mark("backstage");
  await sleep(40);
  timer.mark("bekleme");
  timer.detail("dm", { profil: 1200, sohbet: 900 });
  const summary = timer.summary();
  assert.ok(summary.phases.backstage >= 30, "ilk aşama ölçülmeli");
  assert.ok(summary.phases.bekleme >= 30, "ikinci aşama önceki işaretten itibaren ölçülmeli");
  assert.ok(summary.phases.bekleme < summary.total, "aşama toplamı aşmamalı");
  assert.ok(summary.total >= 70);
  // vm bağlamındaki nesnenin prototipi farklı olduğundan JSON üzerinden karşılaştırılır.
  assert.deepEqual(JSON.parse(JSON.stringify(summary.details.dm)), { profil: 1200, sohbet: 900 });

  const describeDmOutcome = vm.runInContext("describeDmOutcome", context);
  assert.equal(describeDmOutcome(null), "dm_failed");
  assert.equal(describeDmOutcome({ ok: false }), "dm_failed");
  assert.equal(describeDmOutcome({ ok: true }), "sent");
  assert.equal(describeDmOutcome({ ok: true, alreadySent: true }), "already_sent");
  assert.equal(describeDmOutcome({ ok: true, unavailableSkipped: true }), "dm_surface");
  assert.equal(
    describeDmOutcome({ ok: true, unavailableSkipped: true, unavailableReason: "message_permission" }),
    "message_permission"
  );
  assert.equal(
    describeDmOutcome({ ok: true, followerSkipped: true, followerReason: "low_followers" }),
    "low_followers"
  );
  assert.equal(describeDmOutcome({ ok: true, followerSkipped: true }), "follower_unknown");

  const formatSeconds = vm.runInContext("formatSeconds", context);
  assert.equal(formatSeconds(4321), "4,3");
  assert.equal(formatSeconds(0), "0");
  assert.equal(formatSeconds(-5), "0");

  // --- 5) Arka plan: sohbet adresi izleme, süre kaydı, kısaltılan beklemeler --
  assert.match(background, /case "BTG_RECORD_TIMING":/);
  assert.match(background, /timings: \[\]/, "Boş çalışma durumu süre listesi içermeli");
  assert.match(
    background,
    /profileTab = await createProfileTab\(profileUrl, controllerTabId\);\s*await waitForTabComplete\(profileTab\.id, 20000\);\s*await delay\(400\);/,
    "Profil sekmesi kontrol sekmesinin yanında öne açılmalı ve yükleme sonrası bekleme 400 ms olmalı"
  );
  assert.match(background, /openerTabId: controllerTabId/, "Profil sekmesi kontrol sekmesini açıcı olarak almalı");
  assert.doesNotMatch(background, /waitForTabSettled/, "Sohbet adresi yerleştikten sonra ek yerleşme beklemesi kalmamalı");
  const dmFlow = background.slice(
    background.indexOf("async function sendDirectMessage("),
    background.indexOf("async function readFollowerRequirement(")
  );
  assert.ok(
    dmFlow.indexOf("await navigateToPreferredDmTarget(") > 0 &&
      dmFlow.indexOf("await navigateToPreferredDmTarget(") < dmFlow.indexOf("clickProfileMessageFallback("),
    "Sohbet önce doğrudan adresle açılmalı, tıklama yedek olmalı"
  );
  assert.match(background, /async function clickProfileMessageFallback\(/);
  // Devralınma beklemesi yalnız yedek tıklama yolunda yapılmalı.
  assert.match(
    background,
    /openProfileMessageWithReloads\(profileTab\.id, 3, username, false\)/,
    "Ana yol düğme konumu istememeli"
  );
  assert.match(
    background,
    /openProfileMessageWithReloads\(tabId, 1, username, true\)/,
    "Yedek tıklama yolu düğme konumu istemeli"
  );
  assert.match(background, /await delay\(250\);\s*await closeProfileAndRestoreController/);
  assert.match(content, /const PROFILE_LINK_STALL_MS = 5000;/);
  assert.match(content, /return \{ linkStalled: true \};/, "Bağlantısı oluşmayan düğme erken yenilemeye yönlendirilmeli");
  assert.match(background, /timing: dmTimer\.phases\(\)/);
  assert.doesNotMatch(background, /await delay\(6000\)/, "Mesaj düğmesinden sonra sabit 6 saniye kalmamalı");

  let tabCalls = 0;
  let tabScript = () =>
    tabCalls < 3
      ? { id: 1, status: "loading", url: "https://www.tiktok.com/@ornek" }
      : {
          id: 1,
          status: "complete",
          url: "https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=123"
        };
  const store = { runtime: { running: true, timings: [] } };
  const bgContext = {
    console,
    URL,
    Date,
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
          get: async () => structuredClone(store),
          set: async (patch) => Object.assign(store, structuredClone(patch))
        }
      },
      tabs: {
        get: async () => {
          tabCalls += 1;
          return tabScript();
        }
      }
    }
  };
  vm.runInNewContext(background, bgContext);

  const startedAt = Date.now();
  const settled = await bgContext.waitForMessagesUrl(1, 6000);
  const elapsed = Date.now() - startedAt;
  assert.ok(settled && settled.url.includes("/business-suite/messages"), "sohbet adresi döndürülmeli");
  assert.ok(elapsed < 3000, `sohbet adresi görülür görülmez devam edilmeli (${elapsed} ms)`);
  assert.ok(elapsed >= 600, `adresin yerleşmesi için en az 600 ms beklenmeli (${elapsed} ms)`);

  tabCalls = 0;
  tabScript = () => ({ id: 1, status: "complete", url: "https://www.tiktok.com/@ornek" });
  const timeoutStartedAt = Date.now();
  const none = await bgContext.waitForMessagesUrl(1, 500);
  assert.equal(none, null, "sohbet adresi gelmezse null dönmeli");
  assert.ok(Date.now() - timeoutStartedAt >= 450, "süre dolana kadar beklenmeli");

  // Adres süresi dolduysa yerleşme süresi ne olursa olsun hemen vazgeçilmeli.
  tabCalls = 0;
  const abortStartedAt = Date.now();
  const aborted = await bgContext.waitForMessagesUrl(1, 400, 5000);
  assert.equal(aborted, null);
  assert.ok(Date.now() - abortStartedAt < 1500, "adres gelmeyince yerleşme süresi beklenmemeli");

  // Adres zamanında geldiyse sayfa tamamlanana kadar yerleşme süresi tanınmalı.
  tabCalls = 0;
  const loadingStartedAt = Date.now();
  tabScript = () => ({
    id: 1,
    status: Date.now() - loadingStartedAt > 1200 ? "complete" : "loading",
    url: "https://www.tiktok.com/messages?lang=tr-TR&u=123"
  });
  const settledLate = await bgContext.waitForMessagesUrl(1, 400, 5000);
  assert.ok(settledLate && settledLate.status === "complete", "adres geldikten sonra tamamlanma beklenmeli");
  assert.ok(Date.now() - loadingStartedAt >= 1200, "sayfa tamamlanmadan dönülmemeli");
  assert.match(background, /const PROFILE_MESSAGE_CLICK_URL_TIMEOUT_MS = 3000;/);
  assert.match(content, /const PROFILE_EMPTY_SHELL_MS = 4000;/);
  assert.match(content, /return \{ emptyShell: true \};/, "Boş profil kabuğu erken yenilemeye yönlendirilmeli");
  assert.match(content, /await waitFor\(\(\) => isProfileHydrated\(username\), PROFILE_HYDRATION_WAIT_MS\);/);

  await bgContext.recordTiming({
    username: "ornek",
    outcome: "not_eligible",
    total: 4321.6,
    phases: { backstage: 2900.2, bekleme: 1200, "geçiş": 221 },
    details: { dm: { profil: "abc" } }
  });
  assert.equal(store.runtime.timings.length, 1);
  assert.equal(store.runtime.timings[0].username, "ornek");
  assert.equal(store.runtime.timings[0].total, 4322);
  assert.equal(store.runtime.timings[0].phases.backstage, 2900);
  assert.equal(store.runtime.timings[0].details.dm.profil, 0, "sayı olmayan süre 0 sayılmalı");
  assert.equal(store.runtime.running, true, "süre kaydı çalışma durumunu bozmamalı");

  for (let index = 0; index < 120; index += 1) {
    await bgContext.recordTiming({ username: `u${index}`, outcome: "history", total: index });
  }
  assert.equal(store.runtime.timings.length, 100, "en fazla 100 süre kaydı tutulmalı");
  assert.equal(store.runtime.timings[99].username, "u119");

  // --- 6) Eklenti penceresi ----------------------------------------------------
  assert.match(popup, /id="timingText"/);
  assert.match(popupScript, /formatTimings\(runtime\.timings\)/);
  const popupContext = { console, Number, Math, Object, Array };
  vm.createContext(popupContext);
  vm.runInContext(
    [extractFunction(popupScript, "formatTimings"), extractFunction(popupScript, "formatSeconds")].join("\n"),
    popupContext
  );
  const formatTimings = vm.runInContext("formatTimings", popupContext);
  assert.equal(formatTimings([]), "");
  assert.equal(formatTimings(undefined), "");
  const line = formatTimings([
    { username: "eski", total: 2000, phases: { backstage: 2000 } },
    {
      username: "ornek",
      total: 24400,
      phases: { "geçmiş": 40, backstage: 2900, dm: 18000, bekleme: 5100 },
      details: { dm: { profil: 3100, sohbet: 1900, "gönderim": 60 } }
    }
  ]);
  assert.match(line, /^@ornek: 24,4 sn/);
  assert.match(line, /backstage 2,9/);
  assert.match(line, /dm 18 \[profil 3,1, sohbet 1,9\]/, "DM alt adımları köşeli ayraçta listelenmeli");
  assert.doesNotMatch(line, /geçmiş/, "100 ms altındaki aşamalar gizlenmeli");
  assert.match(line, /son 2 yayıncı ortalama 13,2 sn/);

  console.log("Bekleme/süre ölçümü testleri geçti.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

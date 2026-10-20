const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const content = fs.readFileSync(path.join(__dirname, "..", "src/content/tiktok-content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "src/background/background.js"), "utf8");

function reloadFlowSource() {
  return background.slice(
    background.indexOf("async function findDmSurfaceWithReloads("),
    background.indexOf("async function openProfileMessageWithReloads(")
  );
}

function extractFunction(source, name) {
  let start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  // async işlevlerde "async" öneki de alınmalı; aksi hâlde await geçersiz kalır.
  if (source.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} tamamlanamadı`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  // --- 1) Kaynak düzeyi: yerinde kurtarma ve tanılama bağlantıları ----------
  assert.match(content, /message\?\.type === "BTG_RECOVER_DM_TARGET"/);
  assert.match(content, /history\.pushState\(null, "", url\.pathname \+ url\.search\);/);
  assert.match(content, /new PopStateEvent\("popstate", \{ state: null \}\)/);
  assert.match(content, /composerPresent: Boolean\(composer\)/, "Yoklama yazı alanının varlığını ayrıca bildirmeli");
  assert.match(content, /listItems: countDmConversations\(\)/);
  assert.match(background, /type: "BTG_RECOVER_DM_TARGET"/);
  assert.match(background, /const DM_SURFACE_SEARCH_MS = 5000;/);
  assert.match(
    reloadFlowSource(),
    /if \(!recovery\.applicable\) \{[\s\S]{0,400}?findTikTokDmSurface\(tabId, recoverySearchMs, username\)/,
    "Mesaj uygulaması yüklenmemişse yenilemeden önce bir tur daha beklenmeli"
  );
  const reloadFlow = background.slice(
    background.indexOf("async function findDmSurfaceWithReloads("),
    background.indexOf("async function openProfileMessageWithReloads(")
  );
  assert.doesNotMatch(
    reloadFlow,
    /await delay\(DM_INITIAL_WARMUP_MS\)/,
    "Yenileme sonrasında sabit 10 saniyelik bekleme kalmamalı"
  );
  assert.ok(
    reloadFlow.indexOf("recoverDmTargetInPlace(") < reloadFlow.indexOf("chrome.tabs.update(tabId, { url: recoveryUrl"),
    "Yerinde açma tam yenilemeden önce denenmeli"
  );

  // --- 2) İçerik betiği: recoverDmTarget mesaj uygulamasını yerinde yönlendirir
  const pushed = [];
  const dispatched = [];
  const state = { conversation: "", composer: null, list: {}, error: false };
  const contentContext = {
    console,
    URL,
    setTimeout,
    Date,
    location: { href: "https://www.tiktok.com/messages?allow_label=1&lang=tr-TR&scene=business" },
    history: {
      pushState(_state, _title, url) {
        pushed.push(url);
      }
    },
    window: {
      dispatchEvent(event) {
        dispatched.push(event.type);
        // Uygulama popstate ile hedef sohbeti açar.
        state.conversation = "rynxtcm";
        state.composer = {};
      }
    },
    PopStateEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    findDmConversationList: () => state.list,
    findMessagePageError: () => state.error,
    findDmComposer: () => state.composer,
    findOpenConversationUsername: () => state.conversation,
    countDmConversations: () => 29
  };
  vm.createContext(contentContext);
  vm.runInContext(
    [
      extractFunction(content, "recoverDmTarget"),
      extractFunction(content, "usernamesMatch"),
      extractFunction(content, "waitFor"),
      extractFunction(content, "delay")
    ].join("\n"),
    contentContext
  );
  const recoverDmTarget = vm.runInContext("recoverDmTarget", contentContext);

  const invalid = await recoverDmTarget("abc", "rynxtcm");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.applicable, false, "geçersiz kimlikte yönlendirme denenmemeli");
  assert.equal(pushed.length, 0);

  state.list = null;
  const notHosting = await recoverDmTarget("7144661676356764677", "rynxtcm");
  assert.equal(notHosting.applicable, false, "mesaj uygulaması olmayan çerçeve uygulanamaz demeli");
  assert.equal(pushed.length, 0);

  state.list = {};
  const recovered = await recoverDmTarget("7144661676356764677", "rynxtcm");
  assert.equal(recovered.ok, true);
  assert.equal(recovered.applicable, true);
  assert.equal(recovered.conversationUsername, "rynxtcm");
  assert.equal(pushed.length, 1);
  assert.match(pushed[0], /^\/messages\?/, "yalnız yol ve sorgu yazılmalı");
  assert.match(pushed[0], /allow_label=1/, "mevcut parametreler korunmalı");
  assert.match(pushed[0], /u=7144661676356764677/, "hedef kullanıcı kimliği eklenmeli");
  assert.deepEqual(dispatched, ["popstate"]);

  const alreadyOpen = await recoverDmTarget("7144661676356764677", "rynxtcm");
  assert.equal(alreadyOpen.alreadyOpen, true, "hedef zaten açıksa yönlendirme tekrarlanmamalı");
  assert.equal(pushed.length, 1);

  // --- 3) Arka plan: hedef kimliği, tanılama özeti ve yerinde kurtarma akışı --
  const sent = [];
  let composerReady = false;
  let reloads = 0;
  const store = { runtime: { running: true, logs: [] } };
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
      webNavigation: {
        getAllFrames: async () => [
          { frameId: 0, url: "https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=7144661676356764677" },
          { frameId: 5, url: "https://www.tiktok.com/messages?allow_label=1&lang=tr-TR&scene=business" }
        ]
      },
      tabs: {
        sendMessage: async (_tabId, message, options) => {
          sent.push({ type: message.type, frameId: options?.frameId, userId: message.userId });
          if (message.type === "BTG_PROBE_DM_SURFACE") {
            if (options?.frameId === 5) {
              return {
                ok: true,
                hasComposer: composerReady,
                composerPresent: composerReady,
                listPresent: true,
                listItems: 29,
                conversationUsername: composerReady ? "rynxtcm" : "",
                route: "business-suite içindeki /messages çerçevesi",
                pageError: false
              };
            }
            return { ok: true, hasComposer: false, composerPresent: false, listPresent: false, listItems: 0, route: "business-suite kabuğu", pageError: false };
          }
          if (message.type === "BTG_RECOVER_DM_TARGET") {
            if (options?.frameId === 5) {
              composerReady = true;
              return { ok: true, applicable: true, conversationUsername: "rynxtcm" };
            }
            return { ok: false, applicable: false };
          }
          return null;
        },
        update: async () => {
          reloads += 1;
        },
        reload: async () => {
          reloads += 1;
        },
        get: async () => ({ id: 1, status: "complete" }),
        onUpdated: { addListener() {}, removeListener() {} }
      }
    }
  };
  vm.runInNewContext(background, bgContext);

  assert.equal(
    bgContext.readTargetUserId("https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=7144661676356764677"),
    "7144661676356764677"
  );
  assert.equal(bgContext.readTargetUserId("https://www.tiktok.com/messages?lang=tr-TR"), "");
  assert.equal(bgContext.readTargetUserId("https://www.tiktok.com/messages?u=<script>"), "");
  assert.equal(bgContext.readTargetUserId(""), "");

  const missing = await bgContext.findTikTokDmSurface(1, 30, "rynxtcm");
  assert.equal(missing.frameId, undefined);
  assert.equal(missing.diagnostics.length, 2, "her çerçevenin yoklama özeti dönmeli");
  const detail = bgContext.describeSurfaceDiagnostics(missing.diagnostics);
  assert.match(detail, /29 sohbet/);
  assert.match(detail, /açık sohbet: yok/);
  assert.match(detail, /yazı alanı: yok/);
  assert.match(detail, /business-suite içindeki \/messages çerçevesi/);
  assert.equal(bgContext.describeSurfaceDiagnostics([]), "çerçevelerden yanıt alınamadı");

  sent.length = 0;
  const attempt = await bgContext.findDmSurfaceWithReloads(
    1,
    3,
    "rynxtcm",
    "https://www.tiktok.com/business-suite/messages?from=homepage&lang=tr-TR&u=7144661676356764677",
    { searchMs: 60, recoverySearchMs: 500, reloadSearchMs: 60 }
  );
  assert.equal(attempt.surface.frameId, 5, "yerinde açma sonrası yazı alanı çerçevesi bulunmalı");
  assert.equal(attempt.recoveredInPlace, true);
  assert.equal(attempt.reloadCount, 0, "yerinde açma başarılıyken sayfa yenilenmemeli");
  assert.equal(reloads, 0);
  const recoverCalls = sent.filter((item) => item.type === "BTG_RECOVER_DM_TARGET");
  assert.ok(recoverCalls.length >= 2, "kurtarma iletisi her çerçeveye gönderilmeli");
  assert.ok(recoverCalls.every((item) => item.userId === "7144661676356764677"));
  const logs = store.runtime.logs.map((log) => log.message);
  assert.ok(
    logs.some((message) => /hedef sohbeti göstermedi/.test(message) && /yerinde açıldı/.test(message)),
    "Son işlemler bölümüne tanılama satırı yazılmalı"
  );

  // Kimlik yoksa yerinde açma denenmez; yenileme sayısı sınırı korunur.
  composerReady = false;
  sent.length = 0;
  reloads = 0;
  const noTarget = await bgContext.findDmSurfaceWithReloads(1, 1, "rynxtcm", "", {
    searchMs: 30,
    recoverySearchMs: 30,
    reloadSearchMs: 30
  });
  assert.equal(noTarget.surface.frameId, undefined);
  assert.equal(noTarget.reloadCount, 1);
  assert.equal(reloads, 1, "kimlik yokken bir kez tam yenileme yapılmalı");
  assert.equal(sent.filter((item) => item.type === "BTG_RECOVER_DM_TARGET").length, 0);

  // --- 4) Profil devralınma işareti: tıklama sayfa devralınmadan yapılmamalı --
  const hydrationContext = {
    document: { title: "tiktok.com/@enes.e.a" },
    isProfileHeaderReady: () => false
  };
  vm.createContext(hydrationContext);
  vm.runInContext(extractFunction(content, "isProfileHydrated"), hydrationContext);
  const isProfileHydrated = vm.runInContext("isProfileHydrated", hydrationContext);
  assert.equal(isProfileHydrated("enes.e.a"), false, "çıplak başlık devralınmamış sayılmalı");
  hydrationContext.document.title = "Enes (@enes.e.a) | TikTok";
  assert.equal(isProfileHydrated("enes.e.a"), true, "veriyle gelen başlık devralınmış sayılmalı");
  assert.equal(isProfileHydrated("@Enes.E.A"), true, "büyük/küçük harf ve @ önemsenmemeli");
  assert.equal(isProfileHydrated("baska"), false, "başka hesabın başlığı kabul edilmemeli");
  hydrationContext.document.title = "tiktok.com/@enes.e.a";
  hydrationContext.isProfileHeaderReady = () => true;
  assert.equal(isProfileHydrated("enes.e.a"), true, "profil başlığı görünürse devralınmış sayılmalı");
  assert.equal(isProfileHydrated(""), false);

  console.log("DM sohbet yerinde kurtarma testleri geçti.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

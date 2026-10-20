const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const background = fs.readFileSync(path.join(__dirname, "..", "src/background/background.js"), "utf8");
const backstage = fs.readFileSync(path.join(__dirname, "..", "src/content/backstage-content.js"), "utf8");

assert.match(
  backstage,
  /message\?\.type === "BTG_BACKSTAGE_PING"/,
  "Backstage yardımcı kodu hazır olduğunu bildirmeli"
);
assert.match(backstage, /ready: Boolean\(findInviteEntryPoint\(\)\)/);
assert.match(background, /async function sendBackstageCheckWithRecovery/);
assert.match(background, /async function prepareBackstageTab/);
assert.match(background, /function isMissingReceiverError/);

function createContext() {
  const calls = { messages: [], reloads: 0, replies: [] };
  const stored = {
    settings: { mode: "live", minFollowers: 0 },
    runtime: { running: true, backstageTabId: 78, controllerTabId: 77 },
    publisherHistory: { entries: {}, updatedAt: "" }
  };
  const context = {
    console,
    URL,
    structuredClone,
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
      webNavigation: { getAllFrames: async () => [] },
      tabs: {
        onUpdated: { addListener: () => {}, removeListener: () => {} },
        get: async (tabId) => ({ id: tabId, status: "complete", windowId: 1 }),
        update: async () => {},
        reload: async () => {
          calls.reloads += 1;
        },
        sendMessage: async (_tabId, message) => {
          calls.messages.push(message.type);
          // Sıradaki yanıt biterse son yanıt tekrarlanır; yoklama döngüleri böyle beslenir.
          if (calls.replies.length) calls.lastReply = calls.replies.shift();
          const reply = calls.lastReply;
          if (reply instanceof Error) throw reply;
          if (reply === undefined) throw new Error("Test yanıtı tanımlanmadı: " + message.type);
          return reply;
        }
      }
    }
  };
  vm.runInNewContext(background, context);
  return { context, calls, stored };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

const missingReceiver = () =>
  new Error("Could not establish connection. Receiving end does not exist.");

(async () => {
  // Yardımcı kod yerindeyse sekme yenilenmemeli.
  const healthy = createContext();
  healthy.calls.replies = [{ ok: true, ready: true, busy: false }];
  const healthyResult = await healthy.context.prepareBackstageTab(78);
  assert.deepEqual(plain(healthyResult), { ok: true, reloaded: false });
  assert.equal(healthy.calls.reloads, 0, "Bağlantı varsa Backstage sekmesi yenilenmemeli");
  assert.deepEqual(healthy.calls.messages, ["BTG_BACKSTAGE_PING"]);

  // Eklenti yenilendikten sonra açık kalan sekme başlatma sırasında kurtarılmalı.
  const recovered = createContext();
  recovered.calls.replies = [missingReceiver(), { ok: true, ready: true, busy: false }];
  const recoveredResult = await recovered.context.prepareBackstageTab(78);
  assert.deepEqual(plain(recoveredResult), { ok: true, reloaded: true });
  assert.equal(recovered.calls.reloads, 1, "Yardımcı kod yoksa sekme bir kez yenilenmeli");

  // Sayfa yüklendi ama davet ekranı yoksa açıklayıcı hata dönmeli.
  const notReady = createContext();
  notReady.calls.replies = [
    { ok: true, ready: false, busy: false },
    { ok: true, ready: false, busy: false },
    { ok: true, ready: false, busy: false }
  ];
  const notReadyResult = await notReady.context.waitForBackstageReady(78, 200);
  assert.equal(notReadyResult.ok, false);
  assert.match(notReadyResult.error, /Giriş durumunu kontrol edin/);

  // Kontrol sırasında bağlantı koparsa kontrol yenilemeden sonra tekrarlanmalı.
  const checkRecovered = createContext();
  checkRecovered.calls.replies = [
    missingReceiver(),
    { ok: true, ready: true, busy: false },
    { ok: true, eligible: true, reason: "Mevcut" }
  ];
  const checkResult = await checkRecovered.context.sendBackstageCheckWithRecovery(78, "kaan_ozcan6");
  assert.deepEqual(plain(checkResult), { ok: true, eligible: true, reason: "Mevcut" });
  assert.equal(checkRecovered.calls.reloads, 1);
  assert.deepEqual(checkRecovered.calls.messages, [
    "BTG_BACKSTAGE_CHECK",
    "BTG_BACKSTAGE_PING",
    "BTG_BACKSTAGE_CHECK"
  ]);

  // Bağlantı dışındaki hatalar sekmeyi yenilemeden yukarıya taşınmalı.
  const otherError = createContext();
  otherError.calls.replies = [new Error("Backstage halen önceki kullanıcıyı kontrol ediyor.")];
  await assert.rejects(
    () => otherError.context.sendBackstageCheckWithRecovery(78, "kaan_ozcan6"),
    /halen önceki kullanıcıyı/
  );
  assert.equal(otherError.calls.reloads, 0, "Bağlantı hatası dışındaki durumlarda yenileme yapılmamalı");

  // Uygunluk yönlendirmesi kurtarma yolunu kullanmalı.
  const routed = createContext();
  routed.calls.replies = [missingReceiver(), { ok: true, ready: true }, { ok: true, eligible: false, reason: "Uygun değil — başka ajansta" }];
  const routedResult = await routed.context.routeEligibilityCheck("@kaan_ozcan6");
  assert.deepEqual(plain(routedResult), { ok: true, eligible: false, reason: "Uygun değil — başka ajansta" });
  assert.equal(routed.calls.reloads, 1);

  const errorProbe = createContext().context;
  assert.equal(errorProbe.isMissingReceiverError(missingReceiver()), true);
  assert.equal(errorProbe.isMissingReceiverError(new Error("Başka bir hata")), false);

  console.log("Backstage sekmesi otomatik yeniden bağlanma testleri geçti.");
})();

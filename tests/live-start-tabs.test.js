const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/background/background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const stored = {};
const sent = [];
const tabs = [
  {id: 10, url: 'https://www.tiktok.com/@ornek_yayinci/live', active: true, lastAccessed: 30},
  {id: 20, url: 'https://live-backstage.tiktok.com/portal/anchor/instant-messages', active: false, lastAccessed: 20},
  {id: 30, url: 'https://live-backstage.tiktok.com/portal/anchor/relation', active: false, lastAccessed: 10}
];

const context = {
  console,
  URL,
  structuredClone,
  setTimeout,
  clearTimeout,
  chrome: {
    runtime: {
      onInstalled: {addListener() {}},
      onStartup: {addListener() {}},
      onMessage: {addListener() {}},
      getManifest: () => ({version: 'test'})
    },
    storage: {
      local: {
        get: async () => structuredClone(stored),
        set: async patch => Object.assign(stored, structuredClone(patch))
      }
    },
    tabs: {
      query: async () => structuredClone(tabs),
      update: async () => ({}),
      sendMessage: async (tabId, message) => {
        sent.push({tabId, type: message.type});
        if (message.type === 'BTG_BACKSTAGE_PING') return {ok: true, ready: true, busy: false};
        if (message.type === 'BTG_START_CONTROLLER') return {ok: true};
        throw new Error(`Beklenmeyen mesaj: ${message.type}`);
      },
      onUpdated: {addListener() {}, removeListener() {}}
    },
    webNavigation: {getAllFrames: async () => []}
  }
};

vm.createContext(context);
vm.runInContext(source, context);

(async () => {
  const result = await context.startAutomation({mode: 'live', message: 'Deneme'});
  assert.equal(result.ok, true);
  assert.equal(stored.runtime.controllerTabId, 10);
  assert.equal(stored.runtime.backstageTabId, 20, 'CANLI modu Anlık mesajlar sekmesini seçmeli');
  assert.deepEqual(sent, [
    {tabId: 20, type: 'BTG_BACKSTAGE_PING'},
    {tabId: 10, type: 'BTG_START_CONTROLLER'}
  ]);

  sent.length = 0;
  const profileResult = await context.startAutomation({
    mode: 'live',
    message: 'Deneme',
    liveProfileMessaging: true
  });
  assert.equal(profileResult.ok, true);
  assert.equal(stored.runtime.controllerTabId, 10);
  assert.equal(stored.runtime.backstageTabId, 30, 'Profil gönderimi İlişkiyi yönet sekmesini seçmeli');
  assert.equal(stored.runtime.liveProfileMessaging, true);
  assert.deepEqual(sent, [
    {tabId: 30, type: 'BTG_BACKSTAGE_PING'},
    {tabId: 10, type: 'BTG_START_CONTROLLER'}
  ]);

  sent.length = 0;
  const manualResult = await context.startAutomation({
    mode: 'manual',
    message: 'Deneme',
    listUsernames: ['birinci', 'ikinci']
  });
  assert.equal(manualResult.ok, true);
  assert.equal(stored.runtime.controllerTabId, 20, 'Listeden Kontrol doğrudan Anlık mesajlar sekmesinde çalışmalı');
  assert.equal(stored.runtime.backstageTabId, 20);
  assert.deepEqual(sent, [
    {tabId: 20, type: 'BTG_BACKSTAGE_PING'},
    {tabId: 20, type: 'BTG_START_CONTROLLER'}
  ]);

  sent.length = 0;
  const manualProfileResult = await context.startAutomation({
    mode: 'manual',
    message: 'Deneme',
    listUsernames: ['birinci'],
    liveProfileMessaging: true
  });
  assert.equal(manualProfileResult.ok, true);
  assert.equal(stored.runtime.controllerTabId, 10, 'Listeden Kontrol profil gönderimi TikTok sekmesinde çalışmalı');
  assert.equal(stored.runtime.backstageTabId, 30, 'Listeden Kontrol profil gönderimi İlişkiyi yönet sekmesini seçmeli');
  assert.equal(stored.runtime.liveProfileMessaging, true);
  assert.deepEqual(sent, [
    {tabId: 30, type: 'BTG_BACKSTAGE_PING'},
    {tabId: 10, type: 'BTG_START_CONTROLLER'}
  ]);
  const backstageScript = manifest.content_scripts.find(entry =>
    entry.matches.includes('https://live-backstage.tiktok.com/*')
  );
  assert.ok(backstageScript.js.includes('src/content/tiktok-content.js'), 'Liste kontrol döngüsü Backstage sekmesine yüklenmeli');
  console.log('CANLI başlangıcı gönderim seçimine göre doğru Backstage sekmesini seçti.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

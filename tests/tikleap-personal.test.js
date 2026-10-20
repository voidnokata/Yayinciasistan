const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const Tikleap = require('../src/content/tikleap-league.js');
const Package = require('../src/background/personal-package.js');
const plain = value => JSON.parse(JSON.stringify(value));

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} bulunamadı`);
  let depth = 0;
  // Gövde parametrelerden sonra başlar; `options = {}` gibi varsayılanlar atlanır.
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} kapanmadı`);
}

// tikleap.com satır yapısı (2026-10-08 canlı sayfasından, sadeleştirilmiş).
const row = (rank, handle, live) => `
  <a class="ranklist-table-row${live ? ' is-live' : ''}" href="/profile/${handle}?x=1">
    <div class="ranklist-table-item ranklist-table-item-place"><div class="ranklist-place-wrapper"><span class="ranklist-place-number">${rank}</span></div></div>
    <div class="ranklist-table-item ranklist-table-item-userinfo${live ? ' live' : ''}">
      <div class="avatar-wrapper"><img src="a.jpg">${live ? '<span class="ranklist-live-badge">LIVE</span>' : ''}</div>
      <div class="ranklist-userinfo"><span class="ranklist-username">Ad</span><span class="ranklist-handle">@${handle}</span></div>
    </div>
    <div class="ranklist-table-item"><div class="ranklist-diamonds-wrapper"><span>102.4K</span></div></div>
  </a>`;
const page = rows => `<html><head><title>League TikTok Turkey</title></head><body><div class="ranklist-live-now-filter">2 Live Now</div>${rows.join('')}</body></html>`;

test('a league page yields every row with rank and live flag', () => {
  const parsed = Tikleap.parseLeagueHtml(page([row(1, 'ilk', false), row(2, 'canl&#305;.biri', true), row(3, 'son_kisi', true)]), 'b2');
  assert.equal(parsed.challenge, false);
  assert.deepEqual(parsed.rows, [
    { username: 'ilk', league: 'B2', rank: 1, live: false },
    { username: 'canlı.biri', league: 'B2', rank: 2, live: true },
    { username: 'son_kisi', league: 'B2', rank: 3, live: true }
  ]);
});

test('a Cloudflare page is recognised instead of read as an empty league', () => {
  const parsed = Tikleap.parseLeagueHtml('<html><head><title>Just a moment...</title></head><body></body></html>', 'a1');
  assert.deepEqual(parsed, { rows: [], challenge: true });
});

test('the queue keeps everyone: live streamers first, then the rest, league by league, without duplicates', () => {
  const queue = Tikleap.buildQueue({
    a2: [{ username: 'z', league: 'A2', rank: 9, live: true }, { username: 'y', league: 'A2', rank: 3, live: true }, { username: 'idle2', league: 'A2', rank: 1, live: false }],
    a1: [{ username: 'x', league: 'A1', rank: 5, live: true }, { username: 'off', league: 'A1', rank: 1, live: false }],
    b1: [{ username: 'Y', league: 'B1', rank: 1, live: true }, { username: 'off', league: 'B1', rank: 2, live: false }]
  }, ['a1', 'a2', 'b1']);
  assert.deepEqual(queue, [
    { username: 'x', league: 'A1', rank: 5, live: true },
    { username: 'y', league: 'A2', rank: 3, live: true },
    { username: 'z', league: 'A2', rank: 9, live: true },
    { username: 'off', league: 'A1', rank: 1, live: false },
    { username: 'idle2', league: 'A2', rank: 1, live: false }
  ]);
});

test('every league is read, a flaky league is retried and a dead league is reported', async () => {
  const calls = {};
  const fetch = async url => {
    const code = url.split('/').pop();
    calls[code] = (calls[code] || 0) + 1;
    if (code === 'b1') return { ok: false, status: 503, text: async () => '' };
    if (code === 'a2' && calls[code] < 2) return { ok: true, text: async () => '<title>Just a moment...</title>' };
    return { ok: true, text: async () => page([row(1, `${code}_bir`, true), row(2, `${code}_iki`, false)]) };
  };
  const result = await Tikleap.readQueue({ fetch, wait: async () => {}, leagues: ['a1', 'a2', 'b1'] });
  assert.equal(calls.a2, 2);
  assert.equal(calls.b1, 3);
  assert.deepEqual(result.errors, { b1: 'HTTP 503' });
  assert.equal(result.total, 4);
  assert.equal(result.liveCount, 2);
  assert.deepEqual(result.queue.map(item => item.username), ['a1_bir', 'a2_bir', 'a1_iki', 'a2_iki']);
  assert.deepEqual(result.queue.map(item => item.live), [true, true, false, false]);
});

function controllerHarness({ queue, live = {}, eligible = {}, messaged = [], visitFails = false, blocked = [] }) {
  const content = read('src/content/tiktok-content.js');
  const runtime = { running: true, personalQueue: queue, personalRows: [], personalSeen: [], skipped: 0, logs: [] };
  const patches = [];
  const backstage = [];
  const finished = [];
  const visits = [];
  const localCollects = [];
  const delays = [];
  const ctx = {
    console, Number, Math, String, Array, Set, Infinity, Date,
    controller: { running: true, settings: { personalSource: 'tikleap', minFollowers: 0 } },
    PERSONAL_PROFILE_RETRY_WAITS_MS: [45000, 90000, 180000],
    PERSONAL_BLOCKED_STREAK_LIMIT: 2,
    TIKLEAP_BATCH_SIZE: 30,
    BACKSTAGE_BATCH_TIMEOUT_MS: 290000,
    window: {
      BTGPersonalProfile: {
        readBasics: async username => ({ data: { liveRoom: { status: live[username] ? 2 : 4 } }, followers: 5000 }),
        collect: async username => { localCollects.push(username); return { followers: 5000, history: { days14: 9, days30: 20 }, angles: ['duzen'], missing: [], source: 'kontrol' }; }
      }
    },
    createPhaseTimer: () => ({ mark() {} }),
    getState: async () => ({ runtime: JSON.parse(JSON.stringify(runtime)) }),
    runtimePatch: async (patch, log) => { Object.assign(runtime, patch); patches.push({ patch, log }); },
    sendRuntimeMessageWithTimeout: async message => {
      if (message.type === 'BTG_MESSAGE_HISTORY_HAS') return { messaged: messaged.includes(message.username) };
      if (message.type === 'BTG_CHECK_ELIGIBILITY') throw new Error('Tikleap akışı tek tek Backstage kontrolü yapmamalı');
      if (message.type === 'BTG_CHECK_ELIGIBILITY_BATCH') {
        backstage.push([...message.usernames]);
        const results = {};
        for (const username of message.usernames) {
          if (username === 'okunamadi') continue;
          results[username] = eligible[username] === true
            ? { eligible: true, reason: 'Mevcut' }
            : { eligible: false, reason: 'Uygun değil Başka bir ajansta' };
        }
        return { ok: true, results };
      }
      if (message.type === 'BTG_PERSONAL_VISIT') {
        visits.push(message.username);
        if (blocked.includes(message.username)) return { ok: true, profile: { followers: null, history: null, angles: [], missing: ['profil'], source: 'engelli' } };
        return visitFails ? { ok: false, error: 'sekme açılamadı' } : { ok: true, profile: { followers: 5000, history: { days14: 9, days30: 20 }, angles: ['duzen'], missing: [], source: 'profil sekmesi' } };
      }
      throw new Error(`beklenmeyen mesaj ${message.type}`);
    },
    isManualSkipUsername: () => false,
    clampFollowerThreshold: value => Number(value) || 0,
    stopWithError: async message => { throw new Error(message); },
    interruptibleDelay: async ms => { delays.push(ms); },
    randomSkipPacingMs: () => 0,
    randomCollectPacingMs: () => 5555,
    recordTiming: async () => {},
    finishPersonalCollection: async message => { finished.push(message); ctx.controller.running = false; },
    formatFollowerCount: value => String(value),
    readLiveFollowerCount: async () => { throw new Error('Tikleap akışında canlı sayfa okunmamalı'); },
    isReadableFollowerCount: () => true
  };
  vm.createContext(ctx);
  for (const name of ['runTikleapPersonalController', 'runTikleapSegment', 'processPersonalCandidate', 'rememberPersonalSeen', 'describePersonalProfile', 'collectPersonalProfile', 'runTikleapBatchPhase', 'personalKey', 'personalDoneKeys', 'skipPersonalCandidate']) {
    vm.runInContext(extractFunction(content, name), ctx);
  }
  return { ctx, runtime, patches, backstage, finished, visits, localCollects, delays };
}

test('the Tikleap loop handles live streamers first, then the rest, and collects every eligible one', async () => {
  const h = controllerHarness({
    queue: [
      { username: 'bitti', league: 'A1', rank: 4, live: true },
      { username: 'eski', league: 'A1', rank: 7, live: true },
      { username: 'degil', league: 'B1', rank: 2, live: true },
      { username: 'uygun', league: 'A2', rank: 15, live: false },
      { username: 'okunamadi', league: 'B2', rank: 9, live: false },
      { username: 'sessiz', league: 'C3', rank: 21, live: false }
    ],
    // 'bitti': Tikleap canlı gösterdi ama yayın bu arada bitti; yine de verisi toplanır.
    live: { bitti: false, eski: true, degil: true },
    eligible: { bitti: true, uygun: true, sessiz: true },
    messaged: ['eski']
  });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.backstage), [['bitti', 'degil'], ['uygun', 'okunamadi', 'sessiz']]);
  assert.deepEqual(plain(h.runtime.personalEligible), ['bitti', 'uygun', 'sessiz']);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['bitti', 'uygun', 'sessiz']);
  assert.deepEqual(plain(h.runtime.personalRows[1].tikleap), { league: 'A2', rank: 15 });
  assert.deepEqual(plain(h.visits), ['bitti', 'uygun', 'sessiz']);
  assert.deepEqual(plain(h.localCollects), []);
  assert.equal(h.runtime.personalRows[0].profile.source, 'profil sekmesi');
  assert.deepEqual(plain(h.runtime.personalSeen), ['eski', 'degil', 'bitti', 'okunamadi', 'uygun', 'sessiz']);
  assert.deepEqual(h.finished, ['Tikleap listesindeki 6 yayıncı kontrol edildi; 3 uygun yayıncı işlendi']);
  assert.ok(h.patches.some(entry => /Uygun değil — Uygun değil Başka bir ajansta/.test(entry.log?.message || '')));
  assert.ok(h.patches.some(entry => /toplu kontrolde sonuç okunamadı/.test(entry.log?.message || '')));
  assert.ok(!h.patches.some(entry => /Yayın bitmiş|not_live/.test(`${entry.log?.message || ''}${entry.patch?.lastSkipReason || ''}`)));
  assert.ok(h.patches.some(entry => entry.patch.listIndex === 1 && entry.patch.listTotal === 1));
  assert.ok(h.patches.some(entry => entry.patch.listIndex === 2 && entry.patch.listTotal === 2));
});

test('a queue without any live streamer still runs the offline group', async () => {
  const h = controllerHarness({
    queue: [{ username: 'bir', league: 'D1', rank: 1, live: false }, { username: 'iki', league: 'D1', rank: 2, live: false }],
    eligible: { iki: true }
  });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.backstage), [['bir', 'iki']]);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['iki']);
  assert.deepEqual(h.finished, ['Tikleap listesindeki 2 yayıncı kontrol edildi; 1 uygun yayıncı işlendi']);
});

test('a long live list is checked thirty at a time', async () => {
  const queue = Array.from({ length: 65 }, (_, index) => ({ username: `yayinci${index}`, league: 'C1', rank: index + 1 }));
  const h = controllerHarness({ queue, eligible: {} });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.backstage.map(batch => batch.length)), [30, 30, 5]);
  assert.equal(new Set(h.backstage.flat()).size, 65);
  assert.equal(h.runtime.personalRows.length, 0);
  assert.deepEqual(h.finished, ['Tikleap listesindeki 65 yayıncı kontrol edildi; 0 uygun yayıncı işlendi']);
});

test('if the profile tab fails, the data is still read from the control tab', async () => {
  const h = controllerHarness({
    queue: [{ username: 'uygun', league: 'C1', rank: 3 }],
    live: { uygun: true },
    eligible: { uygun: true },
    visitFails: true
  });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.visits), ['uygun']);
  assert.deepEqual(plain(h.localCollects), ['uygun']);
  assert.equal(h.runtime.personalRows[0].profile.source, 'kontrol');
  assert.ok(h.patches.some(entry => /Profil sekmesinde veri toplanamadı \(sekme açılamadı\)/.test(entry.log?.message || '')));
});

test('the background opens the profile in a new tab, collects there and closes it', () => {
  const background = read('src/background/background.js');
  assert.match(background, /case "BTG_PERSONAL_VISIT":\s*return collectPersonalInNewTab\(message\.username, sender\?\.tab\?\.id\);/);
  const visit = extractFunction(background, 'collectPersonalInNewTab');
  assert.match(visit, /chrome\.tabs\.create\(\{ url: `https:\/\/www\.tiktok\.com\/@\$\{clean\}`, active: true \}\)/);
  assert.match(visit, /type: "BTG_COLLECT_PERSONAL"/);
  assert.match(visit, /finally \{[\s\S]*chrome\.tabs\.remove\(tab\.id\)[\s\S]*chrome\.tabs\.update\(returnTabId, \{ active: true \}\)/);
  assert.match(read('src/content/tiktok-content.js'), /message\?\.type === "BTG_COLLECT_PERSONAL"[\s\S]*window\.BTGPersonalProfile\.collect\(message\.username\)/);
});

test('a resumed Tikleap run continues after the streamers already handled', async () => {
  const h = controllerHarness({
    queue: [{ username: 'bir', league: 'A1', rank: 1 }, { username: 'iki', league: 'A1', rank: 2 }],
    live: { bir: true, iki: true },
    eligible: { bir: true, iki: true }
  });
  h.runtime.personalSeen = ['bir'];
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.backstage), [['iki']]);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['iki']);
});

test('a resumed run after the batch phase goes straight to collecting', async () => {
  const h = controllerHarness({
    queue: [{ username: 'bir', league: 'A1', rank: 1 }, { username: 'iki', league: 'A1', rank: 2 }],
    live: { bir: true, iki: true },
    eligible: { bir: true, iki: true }
  });
  Object.assign(h.runtime, { personalEligible: ['iki'], personalSeen: ['bir'] });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.backstage), []);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['iki']);
});

test('the Backstage batch check reads the wizard status column and never invites', () => {
  const backstage = read('src/content/backstage-content.js');
  const batch = extractFunction(backstage, 'checkCreatorsBatch');
  assert.match(batch, /location\.pathname !== "\/portal\/anchor\/relation"/);
  assert.match(batch, /usernames\.length > BATCH_CHECK_LIMIT/);
  assert.match(batch, /setNativeValue\(input, usernames\.join\("\\n"\)\)/);
  assert.match(batch, /findUniqueVisibleByExactText\("İleri"[\s\S]*findUniqueVisibleByExactText\("Geri"/);
  assert.doesNotMatch(batch, /Davet et|Gönder|Ön izleme"/);
  assert.match(backstage, /const BATCH_CHECK_LIMIT = 30;/);
  const status = extractFunction(backstage, 'readBatchStatus');
  assert.match(status, /\^\(Mevcut\|Uygun değil\|Bulunamadı\|Desteklenmeyen bölge\)/);
  assert.match(status, /!text\.toLocaleLowerCase\("tr"\)\.includes\(normalized\)/);
  const background = read('src/background/background.js');
  assert.match(background, /case "BTG_CHECK_ELIGIBILITY_BATCH":\s*return routeEligibilityBatch\(message\.usernames\);/);
  assert.match(extractFunction(background, 'routeEligibilityBatch'), /sanitizeUsernameList\(rawUsernames\)\.slice\(0, 30\)[\s\S]*type: "BTG_BACKSTAGE_BATCH_CHECK"/);
  assert.match(extractFunction(background, 'startAutomation'), /backstagePaths = tikleapSource\s*\? \["\/portal\/anchor\/relation"\]/);
});

test('a streamer who was offline is written up as a last stream, with no live viewer or gift lines', () => {
  const offline = { collectedLabel: '14 Ekim 09:00', followers: 900, angles: [], notes: [], live: { isLive: false, game: 'Arena Breakout', visitors: 1200, viewersNow: null, gifters: null } };
  const online = { collectedLabel: '14 Ekim 09:00', followers: 900, angles: [], notes: [], live: { isLive: true, viewersNow: 80, visitors: 400, gifters: 3 } };
  const md = Package.buildMarkdown([{ username: 'kapali', profile: offline }, { username: 'acik', profile: online }]);
  const [offCard, onCard] = md.split('### 1. kapali')[1].split('### 2. acik');
  assert.match(offCard, /\*\*Son yayın \(veri toplanırken yayın kapalıydı\)\*\*/);
  assert.match(offCard, /Son yayına uğrayan: 1\.200/);
  assert.doesNotMatch(offCard, /Aynı anda izleyen|Hediye atan/);
  assert.match(onCard, /Aynı anda izleyen: 80 · Bu yayına uğrayan: 400 · Hediye atan: 3 kişi/);
  assert.match(md, /Son yayın \(veri toplanırken yayın kapalıydı\)” başlıklı kartlarda yayıncı o an canlı değildi/);
});

test('the model note shows the league as background only and names the file after Tikleap', () => {
  const profile = { collectedLabel: '8 Ekim 15:30', followers: 1200, live: {}, angles: [] };
  const md = Package.buildMarkdown([{ username: 'uygun', profile, tikleap: { league: 'A2', rank: 15 } }], { createdAt: new Date('2026-10-08T12:30:00Z') });
  assert.match(md, /Türkiye ligi: A2, 15\. sıra \(yalnız arka plan bilgisi, mesajda kullanma\)/);
  assert.match(md, /Mesajda lig, sıra, sıralama, Tikleap veya kazanç bilgisinden bahsetme/);
  assert.doesNotMatch(Package.buildMarkdown([{ username: 'akis', profile }]), /Türkiye ligi/);
  assert.equal(Package.fileName(new Date('2026-10-08T12:30:00Z'), { tikleap: true }), 'Kişisel_Mesaj_Tikleap_Ekim_8_15-30.md');
});

test('the extension can read Tikleap and offers it as a personal message source', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.host_permissions.includes('https://www.tikleap.com/*'));
  const background = read('src/background/background.js');
  const reader = extractFunction(background, 'readTikleapQueue');
  assert.match(reader, /files: \["src\/content\/tikleap-league\.js"\]/);
  assert.match(reader, /globalThis\.BTGTikleap\.readQueue\(\)/);
  assert.match(reader, /doğrulama ekranında/);
  assert.match(background, /personalSource: mode === "personal" && input\.personalSource === "tikleap" \? "tikleap" : "feed"/);
  assert.match(extractFunction(background, 'startAutomation'), /tikleapSource[\s\S]*readTikleapQueue\(\)[\s\S]*personalQueue,/);
  const popup = read('src/ui/popup.html');
  assert.match(popup, /<select id="personalSource"><option value="feed">Canlı akış \(kaydırarak\)<\/option><option value="tikleap">Tikleap ligleri \(A1–D5\)<\/option><\/select>/);
  assert.match(read('src/ui/popup.js'), /personalSource: mode === "personal" && elements\.personalSource\.value === "tikleap" \? "tikleap" : "feed"/);
  const content = read('src/content/tiktok-content.js');
  assert.match(extractFunction(content, 'isControllerPage'), /mode === "personal" && personalSource === "tikleap"/);
  assert.match(extractFunction(content, 'runPersonalMessageController'), /personalSource === "tikleap"[\s\S]*runTikleapPersonalController\(\)/);
});

test('after a collected streamer the loop waits longer than after a skipped one', async () => {
  const h = controllerHarness({
    queue: [{ username: 'bir', league: 'A1', rank: 1, live: false }, { username: 'iki', league: 'A1', rank: 2, live: false }],
    eligible: { bir: true }
  });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['bir']);
  assert.deepEqual(plain(h.delays), [5555]);
});

test('a TikTok block waits in growing steps, writes no empty card and the loop keeps going', async () => {
  const h = controllerHarness({
    queue: [{ username: 'engelli', league: 'A1', rank: 1, live: false }, { username: 'saglam', league: 'A1', rank: 2, live: false }],
    eligible: { engelli: true, saglam: true },
    blocked: ['engelli']
  });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.delays.slice(0, 3)), [45000, 90000, 180000]);
  assert.deepEqual(plain(h.visits), ['engelli', 'engelli', 'engelli', 'engelli', 'saglam']);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['saglam']);
  assert.ok(h.patches.some(entry => /Profil verisi okunamadı \(TikTok engeli\) — atlandı/.test(entry.log?.message || '')));
  assert.deepEqual(h.finished, ['Tikleap listesindeki 2 yayıncı kontrol edildi; 2 uygun yayıncı işlendi']);
});

test('when TikTok keeps blocking, the run stops after two streamers in a row and the note is saved', async () => {
  const h = controllerHarness({
    queue: ['a', 'b', 'c'].map((username, i) => ({ username, league: 'B1', rank: i + 1, live: false })),
    eligible: { a: true, b: true, c: true },
    blocked: ['a', 'b', 'c']
  });
  await vm.runInContext('runTikleapPersonalController()', h.ctx);
  assert.deepEqual(plain(h.visits.filter((name, index, all) => all.indexOf(name) === index)), ['a', 'b']);
  assert.equal(h.runtime.personalRows.length, 0);
  assert.equal(h.finished.length, 1);
  assert.match(h.finished[0], /TikTok profil isteklerini engelliyor \(2 yayıncı üst üste okunamadı\)/);
});

function batchRouter(responses) {
  const background = read('src/background/background.js');
  const calls = { sent: 0, resets: 0 };
  const ctx = {
    console, Error, Object, String, RegExp,
    BATCH_WIZARD_RETRIES: 2,
    BATCH_WIZARD_ERROR: /dönülemedi|düğmesi bulunamadı|zamanında gelmedi|açılmadı/,
    chrome: { storage: { local: { get: async () => ({ runtime: { running: true, backstageTabId: 7 } }) } } },
    sanitizeUsernameList: list => list,
    isMissingReceiverError: () => false,
    readableError: error => error.message,
    resetBackstageCheckTab: async () => { calls.resets += 1; },
    sendBackstageMessage: async () => { const next = responses[Math.min(calls.sent, responses.length - 1)]; calls.sent += 1; return next; }
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(background, 'routeEligibilityBatch'), ctx);
  return { ctx, calls };
}

test('a Backstage wizard hiccup reloads the tab and retries the same group instead of stopping the run', async () => {
  const failure = { ok: false, error: 'Backstage kullanıcı adı ekranına geri dönülemedi.' };
  const success = { ok: true, results: { a: { eligible: true } } };
  const recovered = batchRouter([failure, success]);
  assert.deepEqual(plain(await vm.runInContext("routeEligibilityBatch(['a'])", recovered.ctx)), success);
  assert.deepEqual(plain(recovered.calls), { sent: 2, resets: 1 });
  const stuck = batchRouter([failure]);
  const result = await vm.runInContext("routeEligibilityBatch(['a'])", stuck.ctx);
  assert.equal(result.ok, false);
  assert.deepEqual(plain(stuck.calls), { sent: 3, resets: 2 });
  const unrelated = batchRouter([{ ok: false, error: 'Toplu kontrol için 1–30 geçerli kullanıcı adı gerekli.' }]);
  await vm.runInContext("routeEligibilityBatch(['a'])", unrelated.ctx);
  assert.deepEqual(plain(unrelated.calls), { sent: 1, resets: 0 });
});

test('an unexpected controller error is recorded as that error, not swallowed by the stale-session check', async () => {
  const content = read('src/content/tiktok-content.js');
  const patches = [];
  const messages = [];
  const ctx = {
    console, Error, String, Number,
    controller: { running: true, exitReason: '' },
    isMobileMode: () => false,
    getCurrentUsername: () => 'x',
    // getState arka planda PING atıp oturumu kapatabildiği için hata yolunda çağrılmamalı.
    getState: async () => { throw new Error('getState hata yolunda çağrılmamalı'); },
    sendRuntimeMessageWithTimeout: async message => { messages.push(message.type); },
    chrome: { storage: { local: { get: async () => ({ runtime: { running: true, failed: 2 } }) } } },
    runtimePatch: async (patch, log) => { patches.push({ patch, log }); }
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(content, 'reportUnexpectedControllerError'), ctx);
  await vm.runInContext("reportUnexpectedControllerError(new Error('Backstage toplu kontrolü zamanında tamamlanmadı.'))", ctx);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].patch.running, false);
  assert.equal(patches[0].patch.failed, 3);
  assert.match(patches[0].patch.status, /beklenmeyen bir hatayla durdu: Backstage toplu kontrolü zamanında tamamlanmadı/);
  assert.equal(ctx.controller.exitReason, 'Backstage toplu kontrolü zamanında tamamlanmadı.');
  assert.match(content, /const BACKSTAGE_BATCH_TIMEOUT_MS = 290000;/);
});

test('when the stale-session check stops a run it records why (reload, exit reason, idle time)', async () => {
  const background = read('src/background/background.js');
  const saved = [];
  const ctx = {
    console, Date, Number, Math, String, Array, Object, Error,
    EMPTY_RUNTIME: { logs: [] },
    makeLog: (level, username, message) => ({ level, username, message }),
    readableError: error => error.message,
    usesBackstageInstantMessages: () => false,
    chrome: {
      tabs: {
        get: async () => ({}),
        sendMessage: async () => ({ ok: true, running: false, pageLoadedAt: Date.parse('2026-10-14T10:30:00Z'), exitReason: '', url: 'https://www.tiktok.com/?lang=tr' })
      },
      storage: { local: { set: async value => { saved.push(value.runtime); } } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(background, 'reconcileRunningRuntime'), ctx);
  const runtime = { running: true, controllerTabId: 3, startedAt: '2026-10-14T10:00:00Z', lastActivityAt: '2026-10-14T10:05:00Z', logs: [] };
  const result = await vm.runInContext('reconcileRunningRuntime(' + JSON.stringify(runtime) + ')', ctx);
  assert.equal(result.running, false);
  assert.match(result.status, /artık çalışmıyor/);
  assert.match(result.logs[0].message, /kontrol sayfası koşu başladıktan sonra yeniden yüklenmiş; çıkış nedeni: kayıt yok; adres: https:\/\/www\.tiktok\.com\/$/);
  assert.equal(saved.length, 1);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const Profile = require('../src/core/personal-profile.js');
const Package = require('../src/background/personal-package.js');
const Invitations = require('../src/core/invitation-core.js');

const NOW = Date.parse('2026-10-07T12:30:00Z'); // İstanbul 15:30
const NOW_S = NOW / 1000;
const ago = hours => Math.round(NOW_S - hours * 3600);
const RIVAL = '7123456789012345678';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} kapanmadı`);
}

function fixtureResponses(overrides = {}) {
  const user = {
    statusCode: 0,
    data: {
      user: {
        id: '6998518877542368262', uniqueId: 'the_tester', nickname: '🔥Tester🔥', secUid: 'MS4w', roomId: '7693794711504489217',
        signature: 'Oyun ve sohbet 🎮\nİş birliği: mail@test.com\nİG: @someone\nHer gün 21:00 https://x.com/abc +90 532 123 45 67'
      },
      stats: { followerCount: 12400 },
      liveRoom: { title: 'Gece yayını', startTime: Math.round(NOW_S - 95 * 60), status: 2 }
    }
  };
  const roomText = JSON.stringify({
    status_code: 0,
    data: {
      status: 2, title: 'Gece yayını', user_count: 42, stats: { total_user: 1240 },
      hashtag: { title: 'Gaming' }, game_tag: [{ show_name: 'Arena Breakout' }],
      link_mic: { rival_anchor_id: '__RIVAL__' }, linker_map: { [RIVAL]: 1 }
    }
  }).replace('"__RIVAL__"', RIVAL);
  const history = [
    { start_time: ago(27), end_time: ago(26), like_cnt: 1000, title: 'Dün', room_id: '1' },
    { start_time: ago(26) + 240, end_time: ago(26) + 240 + 1800, like_cnt: 500, title: '', room_id: '2' },
    { start_time: ago(120), end_time: ago(120) + 60, like_cnt: 10, title: 'Kısa', room_id: '3' },
    { start_time: ago(72), end_time: ago(70), like_cnt: 9000, title: 'Rekor gece', room_id: '4' },
    { start_time: ago(480), end_time: ago(478), like_cnt: 3000, title: 'Eski', room_id: '5' },
    { start_time: ago(960), end_time: ago(958), like_cnt: 99999, title: 'Pencere dışı', room_id: '6' }
  ];
  const card = {
    status_code: 0,
    data: {
      live_dynamic_anchor: { about_me: 'Hafta içi her akşam' },
      live_dynamic_revenue_info: {
        live_dynamic_fans_club: { fans_club_count: 85 },
        live_dynamic_gift_gallery: { lighted_gift_count: 12, total_gift_count: 40 }
      },
      live_dynamic_history_room_list: history
    }
  };
  const audience = { status_code: 0, data: { total: 40, ranks: [{ score: 30 }, { score: 5 }, { score: 0 }, { score: 0 }] } };
  const videos = {
    statusCode: 0,
    itemList: [
      { createTime: ago(48), desc: 'Yeni bölüm geldi', stats: { playCount: 48000, diggCount: 3000 }, textExtra: [{ hashtagName: 'fyp' }, { hashtagName: 'ArenaBreakout' }] },
      { createTime: ago(24 * 40), desc: 'eski', stats: { playCount: 90000 }, textExtra: [{ hashtagName: 'arenabreakout' }, { hashtagName: 'gaming' }] }
    ]
  };
  const cohost = { status_code: 0, data: { display_id: 'partner_x', nickname: 'P', follow_info: { follower_count: 32000 } } };
  return {
    'api-live/user/room': JSON.stringify(user),
    'room/info': roomText,
    'live_dynamic/detail': JSON.stringify(card),
    'ranklist/online_audience': JSON.stringify(audience),
    'creator/item_list': JSON.stringify(videos),
    'webcast/user/?': JSON.stringify(cohost),
    ...overrides
  };
}

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find(part => url.includes(part));
    const raw = key ? responses[key] : null;
    const body = typeof raw === 'function' ? raw() : raw;
    if (body === null || body === undefined || body === 500) return { ok: false, status: 500, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, calls };
}

test('collect reads every source, keeps 19-digit co-host ids and summarizes the streamer', async () => {
  const { fetch, calls } = fakeFetch(fixtureResponses());
  const profile = await Profile.collect('the_tester', { fetch, now: NOW, wait: async () => {} });
  assert.ok(calls.every(call => call.init.credentials === 'include'));
  assert.ok(calls.some(call => call.url.includes(`target_uid=${RIVAL}`)), 'Eşli yayın kimliği hassasiyet kaybetmeden okunmalı');
  assert.ok(calls.some(call => call.url.includes('anchor_id=6998518877542368262') && call.url.includes('live_dynamic')));
  assert.ok(calls.some(call => call.url.includes('secUid=MS4w') && call.url.includes('count=15')));
  assert.deepEqual(profile.missing, []);

  assert.equal(profile.followers, 12400);
  assert.equal(profile.bio, 'Oyun ve sohbet 🎮 / Her gün 21:00');
  assert.equal(profile.collectedLabel, '7 Ekim 15:30');
  assert.equal(profile.live.isLive, true);
  assert.equal(profile.live.minutesLive, 95);
  assert.equal(profile.live.visitors, 1240);
  assert.equal(profile.live.viewersNow, 42);
  assert.equal(profile.live.gifters, 2);
  assert.equal(profile.live.category, 'Gaming');
  assert.equal(profile.live.game, 'Arena Breakout');
  assert.deepEqual(profile.card, { about: 'Hafta içi her akşam', fansClub: 85, giftsLit: 12, giftsTotal: 40 });

  // Yeniden bağlanma parçası birleşir, 1 dakikalık deneme ve 30 gün dışı sayılmaz; bugünkü canlı yayın gün sayılır.
  assert.equal(profile.history.streams30, 3);
  assert.equal(profile.history.days7, 3);
  assert.equal(profile.history.days14, 3);
  assert.equal(profile.history.days30, 4);
  assert.equal(profile.history.avgLikes, 4500);
  assert.equal(profile.history.avgMinutes, 111);
  assert.deepEqual(profile.history.best, { date: '4 Ekim', minutes: 120, likes: 9000, title: 'Rekor gece' });
  assert.equal(profile.history.capped, false);
  assert.equal(profile.history.coverageDays, 30);

  assert.equal(profile.videos.best.plays, 48000);
  assert.equal(profile.videos.posted30, 1);
  assert.deepEqual(profile.videos.hashtags, ['arenabreakout', 'gaming']);
  assert.deepEqual(profile.cohost, { username: 'partner_x', followers: 32000 });
  assert.deepEqual(profile.angles, ['hediye', 'trafik', 'video', 'esli']);
});

test('a failed source is reported as missing instead of zero', async () => {
  const { fetch } = fakeFetch(fixtureResponses({ 'creator/item_list': 500, 'ranklist/online_audience': JSON.stringify({ status_code: 4003 }) }));
  const profile = await Profile.collect('the_tester', { fetch, now: NOW, wait: async () => {} });
  assert.equal(profile.videos, null);
  assert.equal(profile.live.gifters, null);
  assert.deepEqual(profile.missing.sort(), ['izleyici sıralaması', 'videolar'].sort());
  assert.ok(!profile.angles.includes('hediye'), 'Sıralama okunamadıysa hediye yorumu yapılmamalı');
  assert.match(profile.notes.join(' '), /Okunamayan kaynaklar/);
});

test('a profile answer for another account is never used', async () => {
  const responses = fixtureResponses();
  responses['api-live/user/room'] = responses['api-live/user/room'].replace('"the_tester"', '"someone_else"');
  const { fetch, calls } = fakeFetch(responses);
  const profile = await Profile.collect('the_tester', { fetch, now: NOW, wait: async () => {} });
  assert.equal(calls.length, 1);
  assert.deepEqual(profile.missing, ['profil']);
  assert.equal(profile.followers, null);
  assert.equal(profile.live.isLive, false);
});

test('a short TikTok 403 burst is waited out and retried', async () => {
  const responses = fixtureResponses();
  const profileBody = responses['api-live/user/room'];
  let profileCalls = 0;
  responses['api-live/user/room'] = () => (++profileCalls < 3 ? 500 : profileBody);
  const waits = [];
  const { fetch } = fakeFetch(responses);
  const profile = await Profile.collect('the_tester', { fetch, now: NOW, wait: async ms => { waits.push(ms); } });
  assert.equal(profileCalls, 3);
  assert.deepEqual(waits, [3000, 8000]);
  assert.deepEqual(profile.missing, []);
  assert.equal(profile.followers, 12400);
});

test('a full history list limits the stated coverage window', () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ start_time: ago(2 + i * 2), end_time: ago(1 + i * 2), like_cnt: 100 }));
  const profile = Profile.summarize({ card: { live_dynamic_history_room_list: history } }, { username: 'x', now: NOW });
  assert.equal(profile.history.capped, true);
  assert.equal(profile.history.coverageDays, 8);
  assert.match(profile.notes.join(' '), /100 kayıtla sınırlı; yalnız son 8 günü/);
});

test('redaction removes contact details, links and other accounts', () => {
  assert.equal(Profile.redact('Yayın saatleri 20:00\nWhatsApp 0532 000 00 00\nİletişim için DM'), 'Yayın saatleri 20:00');
  assert.equal(Profile.redact('Takip et @baska.hesap www.site.com ve 0 (532) 123-45-67'), 'Takip et ve');
  assert.equal(Profile.redact('Otel tatili vlogu'), 'Otel tatili vlogu');
});

test('the model note carries the output contract, rules and redacted cards in order', async () => {
  const { fetch } = fakeFetch(fixtureResponses());
  const profile = await Profile.collect('the_tester', { fetch, now: NOW, wait: async () => {} });
  const second = Profile.summarize({}, { username: 'second.one', now: NOW, missing: ['profil'] });
  const md = Package.buildMarkdown([
    { username: 'the_tester', profile },
    { username: 'second.one', profile: second }
  ], { createdAt: new Date(NOW) });
  assert.match(md, /\| Kullanıcı Adı \| Davet Mesajı \| Kullanılan Bilgiler \|/);
  assert.match(md, /tam olarak “Selamlar\. Ben burak, resmi tiktok canlı yayın ajansı BTG Teknoloji’de çalışıyorum\.” cümlesiyle başlasın/);
  assert.match(md, /Yayıncının ismini, takma adını veya kullanıcı adını yazma/);
  assert.match(md, /son paragrafı her mesajda aynen şu kapanış olsun:\n    “Müsait olduğunda sana ajansımız hakkında kısaca bilgi vermek isterim\.”/);
  assert.doesNotMatch(md, /Bizimle çalışmayı düşünür müsün|😊/);
  assert.equal(md.match(/> Müsait olduğunda sana ajansımız hakkında kısaca bilgi vermek isterim\./g).length, 2);
  assert.match(md, /> Selamlar\. Ben burak, resmi tiktok canlı yayın ajansı BTG Teknoloji’de çalışıyorum\.\n>\n> Yayınlarına baktım son yayınlarından biri 5 bin civarı beğeni almış\. Baya ilgi görüyorsun\.\n>\n> Bu ivmeni/);
  assert.match(md, /aynen “Desteğimiz tamamen ücretsiz\.” yaz/);
  assert.match(md, /Emoji kullanma\./);
  assert.match(md, /iyi görünen tek bir şeyi seç ve tanıtımdan sonraki paragrafta konuşur gibi anlat: önce “Yayınlarına baktım”/);
  assert.match(md, /3a\. Abartma\./);
  assert.match(md, /Mesajda eksik veya zayıf bir yönden bahsetme/);
  assert.match(md, /Uzunluk 35-60 kelime/);
  assert.match(md, /> Yayınlarına baktım son bir ayda 17 gün yayın açmışsın\. Baya düzenlisin\./);
  assert.match(md, /“son 30 günde” yerine “son bir ayda”/);
  assert.match(md, /tarih yazma, “son yayınlarından birine” de/);
  assert.doesNotMatch(md, /> [^\n]*iyi gidiyorsun/);
  assert.doesNotMatch(md, /> [^\n]*(gerçekten emek istiyor|izleyicinin seni sevdiğini)[^\n]*\n>/);
  assert.match(md, /Mesajın tamamında “sen” diye hitap et, “siz” kullanma/);
  assert.doesNotMatch(md, /> [^\n]*(olduğunuzda|size )/);
  assert.match(md, /Listeden Kontrol/);
  assert.match(md, /Oluşturulma: 7 Ekim 2026 15:30 \(İstanbul\) · Yayıncı sayısı: 2/);
  assert.ok(md.indexOf('### 1. the_tester') < md.indexOf('### 2. second.one'));
  assert.match(md, /Hediye fırsatı: yayına 1\.240 kişi uğramış ama hediye tarafı henüz açılmamış/);
  assert.match(md, /farklı gün yayın açmış \(son 14 günde/);
  assert.match(md, /hediye atan kişi sayısını asla yazma/);
  assert.match(md, /Suçlayıcı veya eksik arayan ton kullanma/);
  assert.match(md, /Yayın sayısı yazma/);
  assert.match(md, /gözlemi verip bırakma, mutlaka ajansa bağla[\s\S]*“Bu kadar emek verdiğin yayınların daha fazla karşılık bulmasını sağlayabiliriz\.”/);
  assert.match(md, /özel hayatına, yaşadığı hesap sorunlarına/);
  for (const field of ['Görünen ad:', 'Biyografi:', 'Başlık:', 'Canlı yayın tanıtımı:', 'Sık etiketler:', 'Tester🔥']) assert.ok(!md.includes(field), field);
  assert.match(md, /En çok beğeni alan: 4 Ekim, 120 dk, 9\.000 beğeni/);
  assert.match(md, /@partner_x ile eşli yayındaydı/);
  assert.match(md, /Okunamayan kaynaklar: profil\./);
  for (const secret of ['mail@test.com', '532 123', '@someone', 'https://']) assert.ok(!md.includes(secret), secret);
  assert.doesNotMatch(md, /jeton: \d/i);
});

test('the note file name is an Istanbul stamp accepted by the output folder', () => {
  const name = Package.fileName(new Date(NOW));
  assert.equal(name, 'Kişisel_Mesaj_Ekim_7_15-30.md');
  assert.match(name, /^[^\\/:*?"<>|]+\.(xlsx|json|txt|md)$/i);
});

test('the Excel the model returns loads in Listeden Kontrol özel davet', () => {
  const rows = [
    Package.HEADERS,
    ['the_tester', 'Selamlar 😊 7 Ekim’deki yayınına 1.200’den fazla kişi uğramış.', 'uğrayan 1.240, hediye atan 2'],
    ['second.one', '', 'Profil okunamadı']
  ];
  const imported = Invitations.readMessages(rows);
  assert.deepEqual(imported.usernames, ['the_tester']);
  assert.equal(imported.skipped, 1);
  assert.match(imported.messages.the_tester, /^Selamlar 😊/);
});

test('the controller checks history, Backstage and followers before collecting, and never sends', () => {
  const content = read('src/content/tiktok-content.js');
  const flow = content.slice(content.indexOf('async function runPersonalMessageController()'), content.indexOf('function rememberPersonalSeen('));
  // Tek yayıncının işlendiği fonksiyondaki adım sırası.
  const single = flow.slice(flow.indexOf('async function processPersonalCandidate('), flow.indexOf('async function runTikleapPersonalController('));
  // Backstage takipçiden önce: uygun olmayanlar için TikTok'a istek gitmez.
  const order = ['type: "BTG_MESSAGE_HISTORY_HAS"', 'checkPersonalEligibility(', 'BTGPersonalProfile.readBasics(', 'collectPersonalProfile('].map(token => single.indexOf(token));
  assert.ok(order.every(index => index >= 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(flow, /async function checkPersonalEligibility\(username\) \{[\s\S]*?type: "BTG_CHECK_ELIGIBILITY"/);
  assert.match(flow, /async function collectPersonalProfile\([\s\S]*?BTGPersonalProfile\.collect\(/);
  assert.doesNotMatch(flow, /BTG_SEND_DM|BTG_HISTORY_HAS"/);
  assert.doesNotMatch(flow, /processed:/, 'Kişisel mesaj kalıcı DM geçmişini değiştirmemeli');
  assert.match(flow, /eligibility\.transientSkipped/);
  assert.match(flow, /retry <= PERSONAL_PROFILE_RETRY_WAITS_MS\.length && profile\.missing\?\.includes\("profil"\)[\s\S]*interruptibleDelay\(waitMs\)/);
  // Hiç veri alınamayan kart nota yazılmaz; üst üste engelde koşu kaydedilip durur.
  assert.match(flow, /profile\.missing\?\.includes\("profil"\)\) \{[\s\S]*skip\(\s*"profile_blocked"[\s\S]*PERSONAL_BLOCKED_STREAK_LIMIT[\s\S]*finishPersonalCollection/);
  assert.match(flow, /requireFiveActiveDays[\s\S]*days14/);
  assert.match(flow, /type: "BTG_RELOAD_CONTROLLER"[\s\S]*controller\.reloading = true;\s*controller\.running = false;/);
  assert.match(content, /if \(isPersonalMessageMode\(\)\) \{[\s\S]*finally \{ if \(!controller\.reloading\) await savePersonalOnExit\(\)/);
  assert.match(content, /type: "BTG_EXPORT_PERSONAL"/);
  assert.match(content, /personalDataVersion: window\.BTGPersonalProfile\?\.version === 1 \? 1 : 0/);
  const manifest = JSON.parse(read('manifest.json'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('src/core/personal-profile.js') >= 0 && scripts.indexOf('src/core/personal-profile.js') < scripts.indexOf('src/content/tiktok-content.js'));
  assert.match(read('src/background/background.js'), /importScripts\([^)]*personal-package\.js'/);
  assert.match(read('src/ui/popup.html'), /id="modePersonal" type="radio" name="mode" value="personal"><span>Kişisel mesaj</);
});

test('Backstage uses whichever page is open for personal checks', () => {
  const backstage = read('src/content/backstage-content.js');
  const run = pathname => {
    const ctx = { location: { pathname } };
    vm.createContext(ctx);
    vm.runInContext(extractFunction(backstage, 'usesInstantMessageWorkflow'), ctx);
    return ctx;
  };
  assert.equal(run('/portal/anchor/instant-messages').usesInstantMessageWorkflow('personal'), true);
  assert.equal(run('/portal/anchor/relation').usesInstantMessageWorkflow('personal'), false);
  assert.equal(run('/portal/anchor/relation').usesInstantMessageWorkflow('live'), true);
});

function backgroundFixture(runtime) {
  const store = { runtime, settings: { mode: 'personal' } };
  const calls = { patches: [], saves: [], stops: 0 };
  const ctx = {
    URL, Blob, setTimeout, clearTimeout,
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
      storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]])) } },
      tabs: { reload: async () => {} }
    }
  };
  vm.runInNewContext(read('src/background/background.js'), ctx);
  ctx.BTGPersonalPackage = Package;
  ctx.BTGOutput = { save: async (name, blob) => { calls.saves.push({ name, text: await blob.text() }); return { ok: true, name }; } };
  ctx.patchRuntime = async (patch, log) => { calls.patches.push({ patch, log }); return { ok: true }; };
  ctx.stopAutomation = async () => { calls.stops += 1; return { ok: true }; };
  return { ctx, calls, store };
}

test('the background writes the model note from stored rows', async () => {
  const profile = Profile.summarize({}, { username: 'the_tester', now: NOW });
  const f = backgroundFixture({ running: false, personalRows: [{ username: 'the_tester', profile }] });
  const result = await f.ctx.exportPersonalNotes();
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.match(f.calls.saves[0].name, /^Kişisel_Mesaj_.+\.md$/);
  assert.match(f.calls.saves[0].text, /### 1\. the_tester/);
  assert.match(f.calls.patches[0].log.message, /1 yayıncılık model notu/);

  const empty = backgroundFixture({ running: false, personalRows: [] });
  assert.equal((await empty.ctx.exportPersonalNotes()).ok, false);
  assert.equal(empty.calls.saves.length, 0);
});

test('a slow Backstage answer skips the streamer instead of stopping personal collection', async () => {
  const f = backgroundFixture({ running: true, mode: 'personal', backstageTabId: 3 });
  f.ctx.sendBackstageCheckWithRecovery = async () => { const error = new Error('yavaş'); error.code = 'BACKSTAGE_TIMEOUT'; throw error; };
  const result = await f.ctx.routeEligibilityCheck('the_tester');
  assert.equal(result.ok, true);
  assert.equal(result.transientSkipped, true);
  assert.equal(f.calls.stops, 0);
});

test('personal mode refreshes an outdated live tab before starting and may reload on a stuck transition', async () => {
  const source = read('src/background/background.js');
  const fn = source.slice(source.indexOf('async function startControllerWithRecovery('), source.indexOf('async function stopAutomation('));
  const calls = [];
  const replies = [{ ok: true }, { ok: true, personalDataVersion: 1 }];
  const ctx = {
    chrome: { tabs: {
      sendMessage: async (_id, msg) => { calls.push(msg.type); return msg.type === 'BTG_START_CONTROLLER' ? { ok: true } : replies.shift(); },
      reload: async () => calls.push('reload')
    } },
    patchRuntime: async () => {}, waitForTabComplete: async () => {}, delay: async () => {}, isMissingReceiverError: () => false
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  assert.equal((await ctx.startControllerWithRecovery(1, { mode: 'personal' })).ok, true);
  assert.deepEqual(calls, ['BTG_CONTROLLER_PING', 'reload', 'BTG_CONTROLLER_PING', 'BTG_START_CONTROLLER']);

  const f = backgroundFixture({ running: true, mode: 'personal', controllerTabId: 7, controllerReloads: 0 });
  f.ctx.restartLiveControllerAfterReload = async () => {};
  assert.equal((await f.ctx.reloadLiveControllerTab(7, 'takıldı')).ok, true);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const content = fs.readFileSync(path.join(__dirname, '..', 'src/content/tiktok-content.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} bulunamadı`);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} kapanmadı`);
}

// Canlı akış (kaydırarak) kişisel mesaj: tek yayıncı işleme ve engel sırası.
function feedHarness({ eligible = {}, followers = {}, minFollowers = 0 } = {}) {
  const clock = { now: 0 };
  const tiktok = { blocked: false, basics: [], collects: [] };
  const runtime = { running: true, personalRows: [], personalSeen: [], personalDeferred: [], skipped: 0 };
  const patches = [];
  const delays = [];
  const backstage = [];
  const finished = [];
  class FakeDate extends Date {
    static now() { return clock.now; }
  }
  const ctx = {
    console, Number, Math, String, Array, Set, Infinity, Object,
    Date: FakeDate,
    controller: { running: true, settings: { personalSource: 'feed', minFollowers } },
    PERSONAL_PROFILE_RETRY_WAITS_MS: [45000, 90000, 180000],
    PERSONAL_BLOCKED_STREAK_LIMIT: 2,
    window: {
      BTGPersonalProfile: {
        readBasics: async username => {
          tiktok.basics.push(username);
          if (tiktok.blocked) throw new Error('HTTP 403');
          return { followers: followers[username] ?? 5000 };
        },
        collect: async (username, options = {}) => {
          tiktok.collects.push(username);
          if (tiktok.blocked && !options.basics) return { followers: null, history: null, angles: [], missing: ['profil'] };
          return { followers: followers[username] ?? 5000, history: { days14: 9, days30: 20 }, angles: ['duzen'], missing: [] };
        }
      }
    },
    createPhaseTimer: () => ({ mark() {} }),
    getState: async () => ({ runtime: JSON.parse(JSON.stringify(runtime)) }),
    runtimePatch: async (patch, log) => { Object.assign(runtime, patch); patches.push({ patch, log }); },
    sendRuntimeMessageWithTimeout: async message => {
      if (message.type === 'BTG_MESSAGE_HISTORY_HAS') return { messaged: false };
      if (message.type === 'BTG_CHECK_ELIGIBILITY') {
        backstage.push(message.username);
        return eligible[message.username] ? { ok: true, eligible: true } : { ok: true, eligible: false, reason: 'Başka bir ajansta' };
      }
      throw new Error(`beklenmeyen mesaj ${message.type}`);
    },
    isManualSkipUsername: () => false,
    clampFollowerThreshold: value => Number(value) || 0,
    stopWithError: async message => { throw new Error(message); },
    interruptibleDelay: async ms => { delays.push(ms); clock.now += ms; },
    randomCollectPacingMs: () => 5555,
    recordTiming: async () => {},
    finishPersonalCollection: async message => { finished.push(message); ctx.controller.running = false; },
    formatFollowerCount: value => String(value),
    readLiveFollowerCount: async () => ({ ok: false }),
    isReadableFollowerCount: () => true
  };
  vm.createContext(ctx);
  for (const name of ['processPersonalCandidate', 'checkPersonalEligibility', 'collectPersonalProfile', 'deferPersonalCandidate',
    'liftPersonalBlock', 'retryDeferredPersonal', 'rememberPersonalSeen', 'describePersonalProfile', 'personalKey']) {
    vm.runInContext(extractFunction(content, name), ctx);
  }
  const process = username => vm.runInContext(`processPersonalCandidate(${JSON.stringify(username)}, 50, createPhaseTimer(), { deferOnBlock: true })`, ctx);
  const retry = () => vm.runInContext('retryDeferredPersonal(50)', ctx);
  return { ctx, clock, tiktok, runtime, patches, delays, backstage, finished, process, retry };
}

test('Backstage is asked before TikTok, so ineligible streamers cost no TikTok request', async () => {
  const h = feedHarness({ eligible: { uygun: true, az: true }, followers: { az: 40 }, minFollowers: 100 });
  assert.equal(await h.process('degil'), 'not_eligible');
  assert.deepEqual(plain(h.tiktok.basics), []);
  assert.equal(await h.process('az'), 'low_followers');
  assert.equal(await h.process('uygun'), 'collected');
  assert.deepEqual(plain(h.backstage), ['degil', 'az', 'uygun']);
  assert.deepEqual(plain(h.tiktok.basics), ['az', 'uygun']);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['uygun']);
});

test('a TikTok block sets the streamer aside instead of waiting, and the feed keeps going', async () => {
  const h = feedHarness({ eligible: { ilk: true, ikinci: true } });
  h.tiktok.blocked = true;
  assert.equal(await h.process('ilk'), 'deferred');
  assert.deepEqual(plain(h.delays), [], 'engelde yerinde beklenmemeli');
  assert.deepEqual(plain(h.runtime.personalDeferred), [{ username: 'ilk', failures: 1, dueAt: 45000 }]);
  assert.ok(h.runtime.personalSeen.includes('ilk'));
  assert.match(h.runtime.status, /45 sn sonra yeniden denenecek, akış devam ediyor/);

  // Engel sürerken yeni uygun yayıncı için TikTok'a hiç istek atılmaz.
  h.clock.now = 1000;
  const before = h.tiktok.collects.length;
  assert.equal(await h.process('ikinci'), 'deferred');
  assert.equal(h.tiktok.collects.length, before);
  assert.deepEqual(plain(h.runtime.personalDeferred.map(entry => [entry.username, entry.failures, entry.dueAt])), [['ilk', 1, 45000], ['ikinci', 0, 45000]]);
  assert.equal(await h.process('degil'), 'not_eligible');
  assert.equal(await h.retry(), null, 'süre dolmadan yeniden denenmemeli');

  // Süre dolunca sırayla okunur; okunan her yayıncıdan sonra toplama aralığı beklenir.
  h.clock.now = 45000;
  h.tiktok.blocked = false;
  assert.equal(await h.retry(), 'collected');
  assert.equal(await h.retry(), 'collected');
  assert.equal(await h.retry(), null);
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['ilk', 'ikinci']);
  assert.deepEqual(plain(h.runtime.personalDeferred), []);
  assert.deepEqual(plain(h.delays), [5555, 5555]);
  assert.deepEqual(plain(h.backstage), ['ilk', 'ikinci', 'degil'], 'kenara alınan yayıncı Backstage\'de yeniden sorulmamalı');
});

test('one successful read lifts the block and pulls every waiting streamer forward', async () => {
  const h = feedHarness({ eligible: { a: true, b: true } });
  h.tiktok.blocked = true;
  await h.process('a');
  await h.process('b');
  h.clock.now = 45000;
  assert.equal(await h.retry(), 'deferred');
  assert.deepEqual(plain(h.runtime.personalDeferred.map(entry => [entry.username, entry.dueAt])), [['b', 45000], ['a', 135000]]);
  // Engel kalktı: 'b' okununca 'a' 90 sn daha beklemeden sıraya girer.
  h.tiktok.blocked = false;
  assert.equal(await h.retry(), 'collected');
  assert.deepEqual(plain(h.runtime.personalDeferred.map(entry => [entry.username, entry.dueAt])), [['a', 45000]]);
  assert.equal(await h.retry(), 'collected');
  assert.deepEqual(plain(h.runtime.personalRows.map(row => row.username)), ['b', 'a']);
});

test('a streamer still blocked after every wait is skipped without an empty card, and two in a row stop the run', async () => {
  const h = feedHarness({ eligible: { a: true, b: true } });
  h.tiktok.blocked = true;
  await h.process('a');
  await h.process('b');
  const outcomes = [];
  while (h.ctx.controller.running && h.runtime.personalDeferred.length) {
    h.clock.now = Math.max(h.clock.now, Math.min(...h.runtime.personalDeferred.map(entry => entry.dueAt)));
    outcomes.push(await h.retry());
  }
  assert.deepEqual(outcomes, ['deferred', 'deferred', 'deferred', 'deferred', 'deferred', 'profile_blocked', 'stopped']);
  assert.deepEqual(plain(h.tiktok.collects.filter(name => name === 'a')), ['a', 'a', 'a', 'a']);
  assert.equal(h.runtime.personalRows.length, 0);
  assert.ok(h.patches.some(entry => /Profil verisi okunamadı \(TikTok engeli\) — atlandı/.test(entry.log?.message || '')));
  assert.equal(h.finished.length, 1);
  assert.match(h.finished[0], /TikTok profil isteklerini engelliyor \(2 yayıncı üst üste okunamadı\)/);
  assert.deepEqual(plain(h.delays), [], 'canlı akışta hiç yerinde bekleme olmamalı');
});

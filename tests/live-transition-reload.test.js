const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(path.join(__dirname, '../src/background/background.js'), 'utf8');
const tiktokSource = fs.readFileSync(path.join(__dirname, '../src/content/tiktok-content.js'), 'utf8');

function fixture(runtimeOverrides = {}, startResult = { ok: true }) {
  const calls = { patches: [], reloads: [], starts: [] };
  const store = {
    runtime: { running: true, mode: 'live', controllerTabId: 7, controllerReloads: 0, failed: 0, ...runtimeOverrides },
    settings: { mode: 'live', message: 'merhaba' }
  };
  const ctx = {
    URL,
    setTimeout, clearTimeout,
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
      storage: { local: { get: async keys => {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.map(key => [key, store[key]]));
      } } },
      tabs: { reload: async id => { calls.reloads.push(id); } }
    }
  };
  vm.runInNewContext(backgroundSource, ctx);
  ctx.delay = async () => {};
  ctx.waitForTabComplete = async () => {};
  ctx.patchRuntime = async (patch, log) => {
    calls.patches.push({ patch, log });
    store.runtime = { ...store.runtime, ...patch };
    return { ok: true };
  };
  ctx.startControllerWithRecovery = async (tabId, settings) => {
    calls.starts.push({ tabId, settings });
    return startResult;
  };
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  return { ctx, calls, store, settle };
}

test('a stuck live transition reloads the controller tab and restarts the same session', async () => {
  const f = fixture();
  const result = await f.ctx.reloadLiveControllerTab(7, 'Yayın geçişi yarım kaldı');
  assert.equal(result.ok, true);
  await f.settle();
  assert.deepEqual(f.calls.reloads, [7]);
  assert.equal(f.calls.starts.length, 1);
  assert.equal(f.calls.starts[0].tabId, 7);
  assert.equal(f.calls.starts[0].settings.message, 'merhaba');
  assert.equal(f.store.runtime.controllerReloads, 1);
  assert.equal(f.store.runtime.running, true, 'Yenileme akışı durdurmamalı');
  assert.match(f.calls.patches[0].log.message, /Yayın geçişi yarım kaldı \(1\/5\)/);
});

test('reloads are capped per session to avoid a reload loop', async () => {
  const f = fixture({ controllerReloads: 5 });
  const result = await f.ctx.reloadLiveControllerTab(7, 'x');
  assert.equal(result.ok, false);
  assert.match(result.error, /5 kez yenilendi/);
  await f.settle();
  assert.deepEqual(f.calls.reloads, []);
});

test('only the running live controller tab may request a reload', async () => {
  for (const [overrides, sender] of [[{}, 8], [{ mode: 'foryou' }, 7], [{ running: false }, 7]]) {
    const f = fixture(overrides);
    assert.equal((await f.ctx.reloadLiveControllerTab(sender, 'x')).ok, false);
    await f.settle();
    assert.deepEqual(f.calls.reloads, []);
  }
});

test('a failed restart after reload stops the session with a visible error', async () => {
  const f = fixture({}, { ok: false, error: 'Bu sekme bir TikTok LIVE yayın sayfası değil.' });
  assert.equal((await f.ctx.reloadLiveControllerTab(7, 'x')).ok, true);
  await f.settle();
  assert.equal(f.store.runtime.running, false);
  assert.equal(f.store.runtime.failed, 1);
  assert.match(f.store.runtime.status, /yeniden başlatılamadı/);
});

test('live flow asks for a reload instead of stopping when the transition cannot be verified', () => {
  const liveFlow = tiktokSource.slice(
    tiktokSource.indexOf('async function runController()'),
    tiktokSource.indexOf('async function runNameCollectionController()')
  );
  assert.match(liveFlow, /if \(!isForYouMode\(\)\) \{[\s\S]*type: "BTG_RELOAD_CONTROLLER"[\s\S]*if \(reload\?\.ok\) \{\s*controller\.running = false;\s*return;/);
  const retry = tiktokSource.slice(
    tiktokSource.indexOf('async function goToNextLiveWithRetry'),
    tiktokSource.indexOf('async function goToNextForYouWithRetry')
  );
  // Adres yeni yayında, başlık eski yayında kaldıysa ikinci tıklama yapılmaz.
  assert.ok(retry.indexOf('isLiveTransitionStuck(previous)') < retry.indexOf('const retryClicked'));
  assert.match(retry, /return \{ ok: false, stuck: true, urlUsername: getLiveUrlUsername\(\) \}/);
  assert.match(retry, /!usernamesMatch\(urlUsername, previous\) &&\s*usernamesMatch\(getLiveHeaderUsername\(\), previous\)/);
});

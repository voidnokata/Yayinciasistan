const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  let now = 100000, nextID = 0, active = 1, reply;
  const timers = new Map(), listeners = new Set();
  const calls = { updates: [], messages: [], stops: [] };
  const ctx = {
    URL, Date: { now: () => now },
    setTimeout: (fn, ms) => { const id = ++nextID; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => timers.delete(id),
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
      storage: { local: { get: async () => ({ runtime: { running: true, backstageTabId: 2, mode: 'live' } }) } },
      windows: { getLastFocused: async () => ({ id: 4, focused: true }) },
      tabs: {
        get: async id => ({ id, windowId: 4, url: 'https://live-backstage.tiktok.com/portal/anchor/relation' }),
        query: async () => [{ id: active, windowId: 4 }],
        update: async (id, options) => {
          assert.equal(options.active, true); calls.updates.push(id); active = id;
          for (const fn of listeners) fn({ tabId: id, windowId: 4 });
        },
        sendMessage: async (_id, message) => { calls.messages.push(message); return new Promise(resolve => { reply = resolve; }); },
        onActivated: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/background/background.js'), 'utf8'), ctx);
  ctx.stopAutomation = async reason => { calls.stops.push(reason); };
  const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const advance = async ms => {
    const end = now + ms;
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn(); await drain();
    }
    now = end; await drain();
  };
  return { ctx, calls, advance, drain, resolve: value => reply(value),
    select: id => { active = id; for (const fn of listeners) fn({ tabId: id, windowId: 4 }); }, listeners };
}
const message = { type: 'BTG_BACKSTAGE_CHECK', username: 'sample' };

test('normal replies never change tabs and cancel wake timers', async () => {
  const f = fixture();
  const pending = f.ctx.sendBackstageMessage(2, message);
  f.resolve({ ok: true, eligible: false });
  assert.equal((await pending).ok, true);
  await f.advance(30000);
  assert.deepEqual(f.calls.updates, []);
});

test('silent check wakes at 1.2 seconds, restores as soon as the reply arrives and sends only one request', async () => {
  const f = fixture();
  const pending = f.ctx.sendBackstageMessage(2, message);
  await f.advance(1199); assert.deepEqual(f.calls.updates, []);
  await f.advance(1); assert.deepEqual(f.calls.updates, [2]);
  f.resolve({ ok: true, eligible: false });
  await f.drain();
  await f.advance(100);
  assert.equal((await pending).ok, true);
  assert.deepEqual(f.calls.updates, [2, 1]);
  assert.equal(f.calls.messages.length, 1);
  assert.equal(f.listeners.size, 0);
});

test('manual tab selection is preserved', async () => {
  const f = fixture();
  const pending = f.ctx.sendBackstageMessage(2, message);
  await f.advance(1200);
  f.select(3);
  f.resolve({ ok: true });
  await f.drain();
  await f.advance(100); await pending;
  assert.deepEqual(f.calls.updates, [2]);
});

test('other windows and applications do not have focus stolen', async () => {
  const f = fixture();
  f.ctx.chrome.windows.getLastFocused = async () => ({ id: 7, focused: true });
  const pending = f.ctx.sendBackstageMessage(2, message);
  await f.advance(5000);
  f.resolve({ ok: true }); await pending;
  assert.deepEqual(f.calls.updates, []);
});

test('a stopped automation is not brought to the foreground', async () => {
  const f = fixture();
  const pending = f.ctx.sendBackstageMessage(2, message);
  f.ctx.chrome.storage.local.get = async () => ({ runtime: { running: false } });
  await f.advance(5000);
  f.resolve({ ok: false }); await pending;
  assert.deepEqual(f.calls.updates, []);
});

test('sequential silent checks can wake the Backstage tab independently', async () => {
  const f = fixture();
  let pending = f.ctx.sendBackstageMessage(2, message);
  await f.advance(1200); f.resolve({ ok: true }); await f.drain(); await f.advance(100); await pending;
  pending = f.ctx.sendBackstageMessage(2, message);
  await f.advance(1200); f.resolve({ ok: true }); await f.drain(); await f.advance(100); await pending;
  assert.deepEqual(f.calls.updates, [2, 1, 2, 1]);
});

test('20-second live deadline skips the pending creator without stopping automation or retrying', async () => {
  const f = fixture();
  const pending = f.ctx.routeEligibilityCheck('sample');
  await f.drain();
  await f.advance(20000);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.transientSkipped, true);
  assert.equal(result.eligible, false);
  assert.equal(f.calls.stops.length, 0);
  assert.equal(f.calls.messages.length, 1);
  f.resolve({ ok: true, eligible: true }); await f.drain();
  assert.equal(f.calls.messages.length, 1);
});

test('a slow search keeps Backstage visible past 3.5 seconds so the result list stays open', async () => {
  const f = fixture();
  const pending = f.ctx.sendBackstageMessage(2, message);
  await f.advance(1200); assert.deepEqual(f.calls.updates, [2]);
  await f.advance(8000); assert.deepEqual(f.calls.updates, [2], 'Liste odak kaybıyla kapanmasın diye sekme geri alınmamalı');
  f.resolve({ ok: true, eligible: false });
  await f.drain(); await f.advance(100); await pending;
  assert.deepEqual(f.calls.updates, [2, 1]);
});

test('message sending wakes immediately and stays visible until delivery is confirmed', async () => {
  const f = fixture();
  const pending = f.ctx.sendBackstageMessage(2, { type: 'BTG_BACKSTAGE_SEND_DM', username: 'sample' });
  await f.advance(0);
  assert.deepEqual(f.calls.updates, [2]);
  await f.advance(12000);
  assert.deepEqual(f.calls.updates, [2], 'Sohbet yüklenirken sekme geri alınmamalı');
  f.resolve({ ok: true }); await f.drain(); await f.advance(100); await pending;
  assert.deepEqual(f.calls.updates, [2, 1]);
  assert.equal(f.calls.messages.length, 1);
});

test('a pending send has a 35-second deadline and is never repeated', async () => {
  const f = fixture();
  const pending = f.ctx.sendBackstageMessage(2, {type:'BTG_BACKSTAGE_SEND_DM',username:'sample'});
  const rejected = assert.rejects(pending, {code:'BACKSTAGE_TIMEOUT'});
  await f.drain();
  await f.advance(34999);
  assert.deepEqual(f.calls.updates, [2]);
  await f.advance(101);
  await rejected;
  assert.deepEqual(f.calls.updates, [2,1]);
  assert.equal(f.calls.messages.length,1);
});

test('send command waits for tab activation before reaching the page', async () => {
  const f=fixture();
  const original=f.ctx.chrome.tabs.update;
  let activate;
  f.ctx.chrome.tabs.update=async(id,options)=>{
    if(id===2)await new Promise(resolve=>activate=resolve);
    return original(id,options);
  };
  const pending=f.ctx.sendBackstageMessage(2,{type:'BTG_BACKSTAGE_SEND_DM',username:'sample'});
  await f.drain();
  assert.equal(f.calls.messages.length,0,'Sayfa öne alınmadan komut gönderilmemeli');
  activate();await f.drain();
  assert.equal(f.calls.messages.length,1);
  f.resolve({ok:true,sent:true});await f.drain();await f.advance(100);await pending;
  assert.deepEqual(f.calls.updates,[2,1]);
});

test('a search that shows no result in two attempts is skipped in live mode without stopping', async () => {
  const f = fixture();
  const pending = f.ctx.routeEligibilityCheck('sample');
  await f.drain();
  f.resolve({ ok: false, notFound: true, error: 'iki denemede sonuç göstermedi' });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.eligible, false);
  assert.equal(result.transientSkipped, true);
  assert.equal(result.transientResult, 'backstage_not_found');
  assert.equal(f.calls.stops.length, 0);
});

test('not-found stays an error outside live mode', async () => {
  const f = fixture();
  f.ctx.chrome.storage.local.get = async () => ({ runtime: { running: true, backstageTabId: 2, mode: 'manual' } });
  const pending = f.ctx.routeEligibilityCheck('sample');
  await f.drain();
  f.resolve({ ok: false, notFound: true, error: 'iki denemede sonuç göstermedi' });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.transientSkipped, undefined);
});

test('closing the previous tab does not replace a successful query with an error', async () => {
  const f = fixture();
  const original = f.ctx.chrome.tabs.update;
  f.ctx.chrome.tabs.update = async (id, options) => { if (id === 1) throw new Error('closed'); return original(id, options); };
  const pending = f.ctx.sendBackstageMessage(2, message);
  await f.advance(1200); f.resolve({ ok: true });
  await f.drain();
  await f.advance(100);
  assert.equal((await pending).ok, true);
  assert.equal(f.listeners.size, 0);
});

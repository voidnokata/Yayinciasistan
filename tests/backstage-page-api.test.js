const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const origin = 'https://live-backstage.tiktok.com';

function bridgeFixture({ status = 200, body, redirect = false, timeout = false, prime = true } = {}) {
  const payload = { status_code: 0, data: { IsBanned: false, AnchorList: [{
    AnchorStatus: 3, DisplayReason: 2, HasBricRisk: false,
    UserBaseInfo: { DisplayID: 'yett.34', NoPermission: false, Avatar: 'secret-url', UserID: 'private-id' }
  }] } };
  const listeners = new Set();
  const calls = [];
  let listener;
  const win = {
    addEventListener: (_type, callback) => listeners.add(callback),
    removeEventListener: (_type, callback) => listeners.delete(callback),
    postMessage: (data, targetOrigin) => {
      assert.equal(targetOrigin, origin);
      queueMicrotask(() => { for (const callback of [...listeners]) callback({ data, origin, source: win }); });
    }
  };
  class XHR {
    constructor() { this.headers = {}; }
    open(method, url, async) { this.method = method; this.url = url; assert.equal(async, true); }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(data) {
      calls.push(this);
      this.body = data;
      this.status = status;
      this.responseText = body === undefined ? JSON.stringify(payload) : body;
      this.responseURL = redirect ? origin + '/login' : this.url + '?msToken=secret&X-Bogus=secret&X-Gnarly=secret';
      if (timeout) this.ontimeout?.(); else this.onload?.();
    }
    abort() { this.onabort(); }
  }
  const common = { window: win, location: { origin }, setTimeout, clearTimeout, URL, crypto: { randomUUID } };
  vm.runInNewContext(source('src/content/backstage-page-main.js'), { ...common, XMLHttpRequest: XHR });
  const seed = (url = origin + '/creators/live/union_platform_api/agency/list', csrf = 'current-csrf') => {
    const xhr = new XHR();
    xhr.open('POST', url, true);
    for (const [name, value] of Object.entries({
      'Faction-Id': 'test-agency', 'X-Appid': 'test-app', 'X-Language': 'tr-TR', 'X-Csrf-Token': csrf,
      'Authorization': 'not-retained', 'X-Secsdk-Csrf-Token': 'sdk-secret'
    })) xhr.setRequestHeader(name, value);
    xhr.send('{}');
    calls.length = 0;
  };
  if (prime) seed();
  const isolated = vm.createContext({ ...common,
    chrome: { runtime: { onMessage: { addListener(callback) { listener = callback; } } } }
  });
  vm.runInContext(source('src/background/backstage-api.js'), isolated);
  vm.runInContext(source('src/content/backstage-page-bridge.js'), isolated);
  return {
    calls,
    seed,
    message: msg => new Promise(resolve => {
      assert.equal(listener(msg, {}, resolve), true);
    }),
    listeners,
    win
  };
}

test('page bridge completes handshake and one same-origin XHR, with no raw fields leaving the tab', async () => {
  const f = bridgeFixture();
  const ping = await f.message({ type: 'BTG_PAGE_API_PING' });
  assert.equal(ping.ready, true);
  assert.equal(ping.contextReady, true);
  const result = await f.message({ type: 'BTG_PAGE_API_CHECK', username: '@yett.34' });
  assert.equal(result.ok, true);
  assert.equal(result.eligible, false);
  assert.equal(result.source, 'page-api');
  assert.deepEqual(JSON.parse(JSON.stringify(result.signatureFields)), { msToken: true, xBogus: true, xGnarly: true });
  assert.doesNotMatch(JSON.stringify(result), /secret|private-id|Avatar|UserID|responseURL/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].withCredentials, true);
  assert.equal(f.calls[0].headers['faction-id'], 'test-agency');
  assert.equal(f.calls[0].headers['x-csrf-token'], 'current-csrf');
  assert.equal(f.calls[0].headers['x-appid'], 'test-app');
  assert.equal(f.calls[0].headers['x-language'], 'tr-TR');
  assert.equal(f.calls[0].headers['x-secsdk-csrf-token'], undefined, 'SDK token is not replayed');
  assert.equal(f.calls[0].headers['authorization'], undefined);
  assert.doesNotMatch(JSON.stringify(result), /current-csrf|test-agency|sdk-secret|not-retained/);
  assert.equal(new URL(f.calls[0].url).search, '');
  assert.deepEqual(JSON.parse(f.calls[0].body), { DisplayIDList: ['yett.34'], RecommendDisplayIDList: [] });
  assert.equal(f.listeners.size, 1, 'per-request reply listener removed');
});

test('empty, blocked, redirected, timed out and non-JSON page responses remain errors', async () => {
  for (const [options, code] of [
    [{ body: '' }, 'EMPTY_RESPONSE'], [{ body: '<html>secret</html>' }, 'INVALID_RESPONSE'],
    [{ status: 403 }, 'HTTP_ERROR'], [{ redirect: true }, 'REDIRECT'], [{ timeout: true }, 'TIMEOUT']
  ]) {
    const f = bridgeFixture(options);
    const result = await f.message({ type: 'BTG_PAGE_API_CHECK', username: 'yett.34' });
    assert.equal(result.code, code);
    assert.equal(result.ok, false);
    assert.equal(Object.hasOwn(result, 'eligible'), false);
    assert.doesNotMatch(JSON.stringify(result), /secret|private-id/);
  }
});

test('invalid username is rejected before any XHR', async () => {
  const f = bridgeFixture();
  const result = await f.message({ type: 'BTG_PAGE_API_CHECK', username: 'https://example.com/' });
  assert.equal(result.code, 'INVALID_USERNAME');
  assert.equal(f.calls.length, 0);
});

function backgroundFixture(sendMessage) {
  const calls = { create: [], remove: [] };
  const ctx = {
    URL, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)), clearTimeout,
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
      tabs: {
        create: async options => { calls.create.push(options); return { id: 99 }; },
        remove: async id => { calls.remove.push(id); },
        sendMessage
      }
    }
  };
  vm.runInNewContext(source('src/background/background.js'), ctx);
  return { ctx, calls };
}

test('helper is opened inactive in the caller window and only the owned tab is closed', async () => {
  const f = backgroundFixture(async (_id, message) => message.type === 'BTG_PAGE_API_PING'
    ? { ready: true, contextReady: true } : { ok: true, eligible: false });
  const result = await f.ctx.probeBackstagePageAPI('yett.34', { tab: { windowId: 5 } });
  assert.equal(result.ok, true);
  assert.equal(f.calls.create[0].active, false);
  assert.equal(f.calls.create[0].windowId, 5);
  assert.equal(f.calls.create[0].url, origin + '/portal/anchor/relation');
  assert.deepEqual(f.calls.remove, [99]);
});

test('helper is closed after an unresponsive query instead of hanging indefinitely', async () => {
  const f = backgroundFixture(async (_id, message) => message.type === 'BTG_PAGE_API_PING'
    ? { ready: true, contextReady: true } : new Promise(() => {}));
  const result = await f.ctx.probeBackstagePageAPI('yett.34', {});
  assert.equal(result.code, 'PAGE_CONNECTION_ERROR');
  assert.deepEqual(f.calls.remove, [99]);
});

test('page code accepts only the fixed channel and ignores unrelated commands', async () => {
  const f = bridgeFixture();
  f.win.postMessage({ channel: 'OTHER_CHANNEL', id: 'id', action: 'check', username: 'yett.34' }, origin);
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(f.calls.length, 0);
});

test('does not query before coherent same-origin context headers have been observed', async () => {
  const f = bridgeFixture({ prime: false });
  assert.equal((await f.message({ type: 'BTG_PAGE_API_PING' })).contextReady, false);
  f.seed('https://other.example/creators/live/union_platform_api/list');
  assert.equal((await f.message({ type: 'BTG_PAGE_API_PING' })).contextReady, false);
  f.seed(origin + '/unrelated/path');
  const rejected = await f.message({ type: 'BTG_PAGE_API_CHECK', username: 'yett.34' });
  assert.equal(rejected.code, 'CONTEXT_NOT_READY');
  assert.equal(f.calls.length, 0);
  f.seed();
  assert.equal((await f.message({ type: 'BTG_PAGE_API_PING' })).contextReady, true);
});

test('uses the latest observed CSRF value without putting it in the report', async () => {
  const f = bridgeFixture();
  f.seed(undefined, 'fresh-csrf-value');
  const result = await f.message({ type: 'BTG_PAGE_API_CHECK', username: 'yett.34' });
  assert.equal(f.calls[0].headers['x-csrf-token'], 'fresh-csrf-value');
  assert.doesNotMatch(JSON.stringify(result), /fresh-csrf-value/);
});

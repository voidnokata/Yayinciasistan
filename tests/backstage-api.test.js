const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../src/background/backstage-api.js');

function sample() {
  return { status_code: 0, message: 'success', data: {
    IsBanned: false,
    AnchorList: [{ AnchorStatus: 3, DisplayReason: 2, HasBricRisk: false,
      UserBaseInfo: { DisplayID: 'yett.34', NoPermission: false, UserID: 'private-id', Avatar: 'https://example.invalid/?token=secret' } }]
  } };
}
const response = payload => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });

test('observed response is matched to the requested creator and rejects eligibility', () => {
  const result = api.interpret(sample(), 'YETT.34');
  assert.equal(result.ok, true);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'Başka bir ajansta');
  assert.doesNotMatch(JSON.stringify(result), /private-id|secret|Avatar|UserID/);
});

test('unknown, malformed, mismatched and restricted responses never become eligible', () => {
  const cases = [
    [p => { p.data.AnchorList[0].AnchorStatus = 1; }, 'UNKNOWN_STATUS'],
    [p => { p.data.AnchorList[0].DisplayReason = 0; }, 'UNKNOWN_STATUS'],
    [p => { p.data.AnchorList[0].UserBaseInfo.DisplayID = 'someone.else'; }, 'UNMATCHED_CREATOR'],
    [p => { p.data.AnchorList.push(p.data.AnchorList[0]); }, 'UNMATCHED_CREATOR'],
    [p => { p.data.AnchorList = []; }, 'UNMATCHED_CREATOR'],
    [p => { p.data.IsBanned = true; }, 'REVIEW_REQUIRED'],
    [p => { p.data.AnchorList[0].HasBricRisk = true; }, 'REVIEW_REQUIRED'],
    [p => { p.data.AnchorList[0].UserBaseInfo.NoPermission = true; }, 'REVIEW_REQUIRED'],
    [p => { delete p.data.IsBanned; }, 'INCOMPLETE_RESULT'],
    [p => { p.data.AnchorList[0].AnchorStatus = '3'; }, 'INCOMPLETE_RESULT'],
    [p => { p.status_code = 10001; }, 'API_ERROR'],
    [p => { p.status_code = '0'; }, 'INVALID_RESPONSE'],
    [p => { delete p.data.AnchorList; }, 'INVALID_RESPONSE']
  ];
  for (const [change, code] of cases) {
    const payload = sample(); change(payload);
    const result = api.interpret(payload, 'yett.34');
    assert.equal(result.code, code);
    assert.equal(result.ok, false);
    assert.equal(Object.hasOwn(result, 'eligible'), false);
  }
});

test('one fixed-endpoint POST uses cookies through fetch, with no copied headers or signature', async () => {
  let calls = 0;
  const result = await api.probe(' @yett.34 ', async (url, options) => {
    calls++;
    assert.equal(url, api.ENDPOINT);
    assert.equal(new URL(url).search, '');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
    assert.deepEqual(JSON.parse(options.body), { DisplayIDList: ['yett.34'], RecommendDisplayIDList: [] });
    assert.ok(options.signal instanceof AbortSignal);
    return response(sample());
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 200);
});

test('invalid usernames do not trigger a network request', async () => {
  for (const username of ['', null, {}, 'https://tiktok.com/@abc', 'a b', 'a'.repeat(25)]) {
    const result = await api.probe(username, () => { throw new Error('must not fetch'); });
    assert.equal(result.code, 'INVALID_USERNAME');
  }
});

test('HTTP errors, redirects, HTML and empty bodies are not negative eligibility results', async () => {
  const cases = [
    [{ ok: false, status: 403 }, 'HTTP_ERROR'],
    [{ ok: false, status: 429 }, 'HTTP_ERROR'],
    [{ ok: false, status: 0, type: 'opaqueredirect' }, 'REDIRECT'],
    [{ ok: false, status: 302 }, 'REDIRECT'],
    [{ ok: true, status: 204, text: async () => '' }, 'EMPTY_RESPONSE'],
    [{ ok: true, status: 200, text: async () => '<html>login token=secret</html>' }, 'INVALID_RESPONSE'],
    [response({ status_code: 10001, message: 'secret=private' }), 'API_ERROR']
  ];
  for (const [reply, code] of cases) {
    let calls = 0;
    const result = await api.probe('yett.34', async () => { calls++; return reply; });
    assert.equal(calls, 1);
    assert.equal(result.code, code);
    assert.equal(Object.hasOwn(result, 'eligible'), false);
    assert.doesNotMatch(JSON.stringify(result), /secret|private/);
  }
});

test('network exception text is not leaked into the report', async () => {
  const result = await api.probe('yett.34', async () => { throw new Error('secret=private'); });
  assert.equal(result.code, 'NETWORK_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /secret|private/);
});

test('deadline aborts slow requests and clears its timer', async () => {
  let fireTimeout;
  let cleared = false;
  const context = {
    module: { exports: {} }, AbortController,
    setTimeout: (callback, ms) => { assert.equal(ms, 12000); fireTimeout = callback; return 1; },
    clearTimeout: id => { assert.equal(id, 1); cleared = true; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/background/backstage-api.js'), 'utf8'), context);
  const pending = context.module.exports.probe('yett.34', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  fireTimeout();
  const result = await pending;
  assert.equal(result.code, 'TIMEOUT');
  assert.equal(cleared, true);
});

function backgroundContext() {
  const stored = { runtime: { running: false }, publisherHistory: { entries: { existing: {} } } };
  let probes = 0;
  const context = {
    chrome: {
      runtime: { id: 'test-id', getURL: name => `chrome-extension://test-id/${name}`,
        onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      storage: { local: { get: async () => structuredClone(stored), set() { throw new Error('must not store'); } } }
    },
    BTGBackstageAPI: { probe: async () => { probes++; return { ok: true, eligible: false }; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/background/background.js'), 'utf8'), context);
  return { context, stored, probes: () => probes };
}
const sender = { id: 'test-id', url: 'chrome-extension://test-id/src/ui/backstage-api-test.html' };

test('test message works without running automation or a Backstage tab and writes no history', async () => {
  const { context, probes } = backgroundContext();
  const result = await context.handleMessage({ type: 'BTG_PROBE_BACKSTAGE_API', username: 'yett.34' }, sender);
  assert.equal(result.ok, true);
  assert.equal(probes(), 1);
});

test('untrusted pages, running automation and concurrent probes are rejected', async () => {
  const { context, stored, probes } = backgroundContext();
  const bad = await context.probeBackstageAPI('yett.34', { ...sender, url: 'https://www.tiktok.com/' });
  assert.equal(bad.code, 'INVALID_SENDER');
  const wrongID = await context.probeBackstageAPI('yett.34', { ...sender, id: 'other' });
  assert.equal(wrongID.code, 'INVALID_SENDER');
  stored.runtime.running = true;
  assert.equal((await context.probeBackstageAPI('yett.34', sender)).code, 'AUTOMATION_RUNNING');
  assert.equal(probes(), 0);
  stored.runtime.running = false;
  let finish;
  context.BTGBackstageAPI.probe = () => new Promise(resolve => { finish = resolve; });
  const first = context.probeBackstageAPI('yett.34', sender);
  assert.equal((await context.probeBackstageAPI('yett.34', sender)).code, 'BUSY');
  finish({ ok: true });
  await first;
  context.BTGBackstageAPI.probe = async () => { throw new Error('transport failure'); };
  await assert.rejects(context.probeBackstageAPI('yett.34', sender));
  context.BTGBackstageAPI.probe = async () => ({ ok: true });
  assert.equal((await context.probeBackstageAPI('yett.34', sender)).ok, true);
});

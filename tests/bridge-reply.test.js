const assert = require('node:assert/strict');
const { test } = require('node:test');
const { bridgeReplyResult } = require('../src/core/bridge-reply');

test('bridge replies with a boolean ok field pass through unchanged', () => {
  const ok = { ok: true, token: 't1' };
  const failed = { ok: false, error: 'Oturum yok' };
  assert.equal(bridgeReplyResult(ok, 200), ok);
  assert.equal(bridgeReplyResult(failed, 200), failed);
});

test('object replies without a boolean ok field are not accepted as bridge replies', () => {
  assert.deepEqual(bridgeReplyResult({ status: 'running' }, 200), { ok: false, error: 'Mobil köprü bulunamadı' });
  assert.deepEqual(bridgeReplyResult({ ok: 'yes' }, 200), { ok: false, error: 'Mobil köprü bulunamadı' });
  assert.deepEqual(bridgeReplyResult([], 200), { ok: false, error: 'Mobil köprü bulunamadı' });
});

test('non-object replies report the HTTP status', () => {
  assert.deepEqual(bridgeReplyResult(null, 502), { ok: false, error: 'Mobil köprü geçersiz yanıt verdi (HTTP 502).' });
  assert.deepEqual(bridgeReplyResult('ok', 200), { ok: false, error: 'Mobil köprü geçersiz yanıt verdi (HTTP 200).' });
});

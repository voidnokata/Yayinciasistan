const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeResponse, interpret } = require('../src/background/backstage-api.js');

test('describes alternate error envelopes without accepting them as eligibility', () => {
  const payload = { data: { BaseResp: { StatusCode: 401, StatusMessage: 'session expired secret-value' } }, code: '1001' };
  const summary = summarizeResponse(JSON.stringify(payload));
  assert.equal(summary.format, 'json');
  assert.equal(summary.structure.fields.code.type, 'string');
  assert.equal(summary.structure.fields.code.numericCode, 1001);
  assert.equal(summary.structure.fields.data.fields.BaseResp.fields.StatusCode.numericCode, 401);
  assert.deepEqual(summary.structure.fields.data.fields.BaseResp.fields.StatusMessage.hints, ['login-or-session']);
  assert.doesNotMatch(JSON.stringify(summary), /secret-value|session expired/);
  assert.equal(interpret(payload, 'yett.34').code, 'INVALID_RESPONSE');
});

test('distinguishes HTML, non-JSON, null, arrays and numeric-vs-string codes', () => {
  assert.equal(summarizeResponse('<!DOCTYPE html><body>private-value</body>').format, 'html');
  assert.equal(summarizeResponse('not json secret-value').format, 'non-json');
  assert.equal(summarizeResponse('').format, 'empty');
  assert.equal(summarizeResponse('null').structure.type, 'null');
  assert.equal(summarizeResponse('[1,2]').structure.length, 2);
  assert.equal(summarizeResponse('{"status_code":"0"}').structure.fields.status_code.type, 'string');
  assert.equal(summarizeResponse('{"status_code":0}').structure.fields.status_code.type, 'number');
});

test('omits credentials, identifiers, unknown key names and message bodies', () => {
  const payload = { code: 'secret-value', msToken: 'private-token', 'private-field-name': 'anything',
    data: { UserID: '7451351394789344261', Avatar: 'https://example.com/?token=private-token' },
    message: 'invalid token private-token' };
  const summary = summarizeResponse(JSON.stringify(payload));
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /secret-value|private-token|private-field-name|7451351394789344261|example\.com|msToken|Avatar|UserID/);
  assert.equal(summary.structure.otherFieldCount, 2);
  assert.deepEqual(summary.structure.fields.message.hints, ['signature-or-token']);
});

test('known BaseResp error envelope is recognized without assuming its meaning', () => {
  const result = interpret({ BaseResp: { StatusCode: 4030004, StatusMessage: '' } }, 'yett.34');
  assert.equal(result.code, 'API_ERROR');
  assert.equal(result.apiStatus, 4030004);
  assert.equal(result.ok, false);
  assert.equal(Object.hasOwn(result, 'eligible'), false);
});

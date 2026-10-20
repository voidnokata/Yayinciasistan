const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { isExtensionPage } = require('../src/core/sender-guard');

const base = 'chrome-extension://abcdefghijklmnop/';

test('isExtensionPage accepts only documents under the extension base URL', () => {
  assert.equal(isExtensionPage({ url: base + 'src/ui/popup.html' }, base), true);
  assert.equal(isExtensionPage({ url: base + 'src/ui/feedback.html?view=weekly' }, base), true);
  assert.equal(isExtensionPage({ url: 'https://www.tiktok.com/@creator/live' }, base), false);
  assert.equal(isExtensionPage({ url: 'chrome-extension://otherextensionid/src/ui/popup.html' }, base), false);
  assert.equal(isExtensionPage({ url: base + 'src/ui/popup.html' }, ''), false);
});

test('isExtensionPage rejects senders without a usable URL', () => {
  assert.equal(isExtensionPage(undefined, base), false);
  assert.equal(isExtensionPage({}, base), false);
  assert.equal(isExtensionPage({ url: 42 }, base), false);
  assert.equal(isExtensionPage({ tab: { id: 1 } }, base), false);
});

test('privileged gate covers popup-only commands and leaves content-sent commands open', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/background/background.js'), 'utf8');
  const match = source.match(/const EXTENSION_PAGE_ONLY_MESSAGES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'EXTENSION_PAGE_ONLY_MESSAGES set is declared');
  const gated = [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(gated, [
    'BTG_CLEAR_HISTORY', 'BTG_EXPORT_DIAGNOSTICS', 'BTG_EXPORT_HISTORY', 'BTG_EXPORT_REPORT',
    'BTG_IMPORT_HISTORY', 'BTG_START', 'BTG_STOP',
  ]);
  const contentSent = ['BTG_EXPORT_PERSONAL', 'BTG_RUNTIME_PATCH', 'BTG_MOBILE_SESSION_STOP'];
  const content = fs.readFileSync(path.join(__dirname, '../src/content/tiktok-content.js'), 'utf8');
  for (const type of contentSent) {
    assert.ok(content.includes(`"${type}"`) || content.includes(`'${type}'`), `${type} is still sent by the content script`);
    assert.ok(!match[1].includes(type), `${type} must not be gated`);
  }
  assert.match(source, /if \(EXTENSION_PAGE_ONLY_MESSAGES\.has\(message\?\.type\) && !isExtensionPage\(sender, chrome\.runtime\.getURL\(''\)\)\)/);
});

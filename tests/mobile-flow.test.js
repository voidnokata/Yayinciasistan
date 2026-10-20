const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "src/content/tiktok-content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "src/background/background.js"), "utf8");
const popup = fs.readFileSync(path.join(__dirname, "..", "src/ui/popup.html"), "utf8");

const start = content.indexOf("async function runMobileController()");
const end = content.indexOf("async function runListController()", start);
assert.notEqual(start, -1, "Mobil telefon akışı bulunamadı");
assert.notEqual(end, -1, "Mobil telefon akışının sınırı bulunamadı");
const flow = content.slice(start, end);

const nextIndex = flow.indexOf('type: "BTG_MOBILE_NEXT"');
const eligibilityIndex = flow.indexOf('type: "BTG_CHECK_ELIGIBILITY"');
const dmIndex = flow.indexOf('type: "BTG_SEND_DM"');
const completeIndex = flow.lastIndexOf('type: "BTG_MOBILE_COMPLETE"');

assert.ok(nextIndex >= 0, "Telefondan sıradaki yayıncı istenmeli");
assert.ok(eligibilityIndex > nextIndex, "Backstage kontrolü telefon ID'sinden sonra yapılmalı");
assert.ok(dmIndex > eligibilityIndex, "DM yalnız Backstage kontrolünden sonra gönderilmeli");
assert.ok(completeIndex > dmIndex, "Telefon web sonucu tamamlandıktan sonra ilerletilmeli");
assert.match(flow, /mobileProfile\.token/);
assert.match(flow, /advance: !reachedLimit/);
assert.match(flow, /mobile_scan_failed/);
assert.match(flow, /historyHasBackstageCheck\(historyCheck\)/);
assert.match(background, /const MOBILE_BRIDGE_URL = "http:\/\/127\.0\.0\.1:8765"/);
assert.match(background, /case "BTG_MOBILE_NEXT":/);
assert.match(background, /case "BTG_MOBILE_COMPLETE":/);
assert.match(background, /case "BTG_MOBILE_SESSION_STOP":/);
assert.match(background, /async function startControllerWithRecovery/);
assert.match(background, /Receiving end does not exist/);
assert.match(background, /await chrome\.tabs\.reload\(tabId\)/);
assert.match(popup, /id="modeMobile"/);

console.log("Mobil telefon → Backstage → DM → sonraki yayın sıralaması testi geçti.");

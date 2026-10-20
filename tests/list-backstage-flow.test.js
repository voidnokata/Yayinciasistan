const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "src/content/tiktok-content.js"), "utf8");
const start = source.indexOf("async function runListController()");
const end = source.indexOf("function isManualSkipUsername", start);
assert.notEqual(start, -1, "Excel liste akisi bulunamadi");
assert.notEqual(end, -1, "Excel liste akisi tamamlanamadi");
const listFlow = source.slice(start, end);

const eligibilityIndex = listFlow.indexOf('type: "BTG_CHECK_ELIGIBILITY"');
const dmIndex = listFlow.indexOf('type: "BTG_SEND_DM"');
assert.ok(eligibilityIndex >= 0, "Excel modunda Backstage uygunluk cagrisi bulunmali");
assert.ok(dmIndex > eligibilityIndex, "DM cagrisi Backstage kontrolunden sonra gelmeli");
assert.match(listFlow, /if \(eligibility\.eligible\)/);
assert.match(listFlow, /Mevcut de\u011fil \u2014 atland\u0131/);
assert.match(listFlow, /backstageChecked: !skipBackstageCheck/);
assert.match(source, /function historyHasBackstageCheck\(historyCheck\)/);
assert.match(listFlow, /appendListReportRow/);
assert.match(listFlow, /eligibility\.reason \|\| "Mevcut"/);
assert.match(listFlow, /"DM g\u00f6nderilmedi"/);
assert.match(source, /function isManualListMode\(\)/);
assert.match(listFlow, /isManualInstantMessaging\(\) \? 45000 : 420000/);
assert.match(source, /function isManualInstantMessaging\(\) \{\s*return isManualListMode\(\) && controller\.settings\?\.liveProfileMessaging !== true;/);
assert.match(source, /mode === "manual"[\s\S]*live-backstage\.tiktok\.com[\s\S]*\/portal\/anchor\/instant-messages/);

const background = fs.readFileSync(path.join(__dirname, "..", "src/background/background.js"), "utf8");
assert.match(background, /BACKSTAGE_TIMEOUT' && runtime\.mode !== 'manual'/);
const sendStart = background.indexOf('async function sendBackstageInstantMessage(');
const sendEnd = background.indexOf('async function prepareBackstageTab(', sendStart);
const sendFlow = background.slice(sendStart, sendEnd);
assert.match(sendFlow, /if \(runtime\.mode !== "manual"\) \{[\s\S]*?stopAutomation/);
assert.match(listFlow, /if \(!eligibility\?\.ok\) \{[\s\S]*?if \(isManualListMode\(\)\) \{[\s\S]*?result: "backstage_failed"[\s\S]*?continue;/);
assert.match(listFlow, /result: "dm_failed"[\s\S]*?\.\.\.\(isManualListMode\(\) \? \{\} : \{ running: false \}\)[\s\S]*?if \(!isManualListMode\(\)\) \{[\s\S]*?controller\.running = false;[\s\S]*?return;/);
// Mevcut yayıncı bilgilendirmesi kalıcı ilk temas geçmişine takılmaz; oturum içi tekrar yine atlanır.
assert.match(listFlow, /const existingCreatorNotice = isManualListMode\(\) && controller\.settings\?\.existingCreatorNotice === true;/);
assert.match(listFlow, /sessionEntry\s*\? \{ found: true, sessionOnly: true, entry: sessionEntry \}\s*: existingCreatorNotice\s*\? \{ ok: true, found: false \}/);
assert.match(listFlow, /if \(isManualListMode\(\) && !existingCreatorNotice\) \{\s*const messageHistory/);
assert.match(sendFlow, /const notice = isExistingCreatorNoticeRun\(runtime\);\s*if \(!notice\) \{\s*const previous = await hasMessagedPublisher\(username\);/);

console.log("List Backstage flow and manual per-user failure continuation tests passed.");

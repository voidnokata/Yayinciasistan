const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'src/background/background.js'), 'utf8');
const backstage = fs.readFileSync(path.join(root, 'src/content/backstage-content.js'), 'utf8');
const tiktok = fs.readFileSync(path.join(root, 'src/content/tiktok-content.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} tamamlanamadı`);
}

const modeContext = {};
vm.createContext(modeContext);
vm.runInContext(extractFunction(background, 'usesBackstageInstantMessages'), modeContext);
assert.equal(modeContext.usesBackstageInstantMessages('live'), true);
assert.equal(modeContext.usesBackstageInstantMessages('live', true), false);
assert.equal(modeContext.usesBackstageInstantMessages('manual'), true);
assert.equal(modeContext.usesBackstageInstantMessages('foryou'), false);
assert.equal(modeContext.usesBackstageInstantMessages('list'), false);

const startFlow = background.slice(
  background.indexOf('async function startAutomation('),
  background.indexOf('async function startControllerWithRecovery(')
);
assert.match(startFlow, /usesBackstageInstantMessages\([\s\S]*settings\.mode,[\s\S]*settings\.liveProfileMessaging/);
assert.match(startFlow, /\/portal\/anchor\/instant-messages/);
assert.match(startFlow, /settings\.mode === "live"[\s\S]*CANLI Yayın[\s\S]*Anlık mesajlar/);

const sendRoute = background.slice(
  background.indexOf('case "BTG_SEND_DM":'),
  background.indexOf('case "BTG_ACTIVATE_CONTROLLER":')
);
assert.match(sendRoute, /usesBackstageInstantMessages\(dmState\.runtime\?\.mode, dmState\.runtime\?\.liveProfileMessaging\)/);
assert.match(sendRoute, /sendBackstageInstantMessage/);

assert.match(
  backstage,
  /usesInstantMessageWorkflow\(message\.mode, message\.liveProfileMessaging\)[\s\S]*checkInstantMessageCreator\(message\.username, message\.feedback === true, message\.notice === true\)/
);
assert.match(backstage, /result\.ok && \(result\.eligible \|\| feedback \|\| notice\)/);
assert.match(backstage, /const existingCreator = feedback \|\| notice;/);
assert.match(backstage, /\(!existingCreator && !currentResult\.eligible\)/);
assert.match(background, /sendBackstageCheckWithRecovery\(backstageTabId, username, 'manual', false, true\)/);
assert.match(background, /sendBackstageCheckWithRecovery\(\s*runtime\.backstageTabId,[\s\S]*runtime\.mode,[\s\S]*runtime\.liveProfileMessaging === true,\s*false,\s*isExistingCreatorNoticeRun\(runtime\)\s*\)/);
assert.match(
  extractFunction(backstage, 'usesInstantMessageWorkflow'),
  /\["manual", "live"\]\.includes\(mode\) && !liveProfileMessaging/
);
const backstageModeContext = {};
vm.createContext(backstageModeContext);
vm.runInContext(extractFunction(backstage, 'usesInstantMessageWorkflow'), backstageModeContext);
assert.equal(backstageModeContext.usesInstantMessageWorkflow('live'), true);
assert.equal(backstageModeContext.usesInstantMessageWorkflow('live', true), false);
assert.equal(backstageModeContext.usesInstantMessageWorkflow('manual', true), false);
assert.equal(backstageModeContext.usesInstantMessageWorkflow('manual'), true);
assert.match(backstage, /backstage_IM_error_resend_code/);
assert.match(backstage, /unavailableReason: \/askıya alındı\|suspend\(ed\)\?\/i/);
assert.match(backstage, /error && isVisible\(error\) && detail/);
assert.match(backstage, /if \(confirmed\) return \{sent: true\}/);
assert.match(background, /result\?\.ok && result\.unavailableSkipped/);

const liveFlow = tiktok.slice(
  tiktok.indexOf('async function runController()'),
  tiktok.indexOf('async function runNameCollectionController()')
);
const messageHistory = liveFlow.indexOf('type: isForYouMode() ? "BTG_HISTORY_HAS" : "BTG_MESSAGE_HISTORY_HAS"');
const eligibility = liveFlow.indexOf('type: "BTG_CHECK_ELIGIBILITY"');
const send = liveFlow.indexOf('type: "BTG_SEND_DM"');
assert.ok(messageHistory >= 0, 'CANLI modu mesaj gönderilmiş yayıncı geçmişini kontrol etmeli');
assert.ok(messageHistory < eligibility, 'Mesaj geçmişi Backstage aramasından önce kontrol edilmeli');
assert.ok(eligibility < send, 'Uygunluk sonucu alınmadan mesaj gönderilmemeli');
assert.match(liveFlow, /isForYouMode\(\) \? historyCheck\?\.found : historyCheck\?\.messaged/);
assert.match(liveFlow, /if \(eligibility\.eligible\)/);
assert.match(liveFlow, /eligibility\.transientSkipped/);
assert.match(liveFlow, /outcome = notFound \? "backstage_not_found" : "backstage_timeout"/);
assert.match(liveFlow, /eligibility\.transientResult === "backstage_not_found"/);
assert.match(liveFlow, /\{ username, result: outcome, time: new Date\(\)\.toISOString\(\), backstageChecked: false \}/);
assert.match(liveFlow, /backstageChecked: false/);
assert.match(liveFlow, /const nextSent = Number\(latest\.runtime\.sent \|\| 0\) \+ 1/);
assert.match(liveFlow, /profileDm \? 420000 : 45000/);
assert.match(liveFlow, /sent: nextSent/);
assert.match(liveFlow, /unavailableReason === "account_suspended"/);
assert.match(liveFlow, /hesabı askıya alınmış; sonraki/);

console.log('CANLI akışı: mesaj geçmişi → Anlık mesaj uygunluğu → Backstage gönderimi sıralaması geçti.');

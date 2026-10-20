const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const popupHtml = fs.readFileSync(path.join(root, "src/ui/popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "src/ui/popup.js"), "utf8");
const background = fs.readFileSync(path.join(root, "src/background/background.js"), "utf8");
const tiktok = fs.readFileSync(path.join(root, "src/content/tiktok-content.js"), "utf8");

assert.match(popupHtml, /id="skipBackstageCheck" type="checkbox" disabled/);
assert.match(popupJs, /skipBackstageCheck: false/);
assert.match(background, /const backstageRequired = true/);
assert.match(background, /backstageTabId: backstageRequired \? backstageTabs\[0\]\.id : null/);
assert.match(tiktok, /skipBackstageCheck\s*\? \{ ok: true, eligible: true, reason: "Backstage kontrolü yapılmadı" \}/);
assert.match(tiktok, /backstageChecked: !skipBackstageCheck/);

const vm = require('node:vm');
const start = background.indexOf('function sanitizeSettings(');
const end = background.indexOf('\nfunction ', start + 1);
const context = { sanitizeUsernameList: x => x || [], clampNumber: (x,a,b,d) => d,
  DEFAULT_SETTINGS: {}, DEFAULT_MESSAGE: 'test',
  sanitizeMessageVariants: (_messages, fallback) => [String(fallback || 'test')] };
vm.createContext(context);
vm.runInContext(background.slice(start,end), context);
assert.equal(context.sanitizeSettings({mode:'manual',skipBackstageCheck:true}).skipBackstageCheck, false);
console.log("Eski ayarlar zorunlu uygunluk kontrolünü atlayamıyor.");

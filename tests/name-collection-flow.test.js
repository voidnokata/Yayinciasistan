const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "src/content/tiktok-content.js"), "utf8");
const popup = fs.readFileSync(path.join(__dirname, "..", "src/ui/popup.html"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "src/background/background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));

const start = content.indexOf("async function runNameCollectionController()");
const end = content.indexOf("async function runMobileController()", start);
assert.notEqual(start, -1, "İsim toplama akışı bulunamadı");
assert.notEqual(end, -1, "İsim toplama akışının sınırı bulunamadı");
const flow = content.slice(start, end);

assert.doesNotMatch(flow, /BTG_MESSAGE_HISTORY_HAS|messageHistoryCheck|already_messaged/);
assert.match(flow, /if \(alreadyCollected\)/);
assert.doesNotMatch(flow, /BTG_HISTORY_HAS/, "Genel Denenmiş yayıncılar geçmişi okunmamalı");
assert.match(flow, /readLiveFollowerCount\(username\)/);
assert.match(flow, /followerReadable && followerCount < minFollowers/);
const collectionBody = flow.slice(flow.indexOf("async function runNameCollectionController"), flow.indexOf("async function finishNameCollection"));
assert.doesNotMatch(collectionBody, /outcome = "follower_unknown"/, "Takipçi okunamazsa isim toplamada yayıncı geçilmemeli");
assert.match(collectionBody, /takipçi şartı karşılanmış sayıl/);
assert.match(flow, /type: "BTG_CHECK_ELIGIBILITY"/);
assert.match(flow, /if \(eligibility\.eligible\)/);
assert.match(flow, /collectionRows: nextRows/);
assert.match(flow, /activeDaysAllowed\(assessment, controller.settings.requireFiveActiveDays\)/);
assert.match(flow, /outcome = 'low_active_days'/);
assert.match(flow, /downloadNameCollection\(rows\)/);
assert.doesNotMatch(flow, /BTG_SEND_DM/);
assert.doesNotMatch(flow, /processed:/, "İsim toplama kalıcı DM geçmişini değiştirmemeli");

assert.match(popup, /value="collect"/);
assert.match(popup, />İsim toplama</);
assert.match(background, /\["live", "foryou", "list", "mobile", "manual", "collect", "personal"\]/);
assert.match(background, /const MESSAGED_RESULTS = new Set\(\["sent", "already_sent"\]\)/);
assert.match(background, /function mergeProcessedIntoMessagedPublishers\(/);
assert.deepEqual(
  manifest.content_scripts[0].js,
  ["src/core/xlsx-writer.js", "src/core/talent-score.js", "src/core/personal-profile.js", "src/content/tiktok-content.js"],
  "Excel yazıcısı canlı sayfada akıştan önce yüklenmeli"
);

console.log("İsim toplama geçmişten bağımsız → takipçi → Backstage → Excel akışı testi geçti.");

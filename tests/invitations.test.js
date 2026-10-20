const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../src/core/invitation-core');
const {assess} = require('../src/core/talent-score');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
// Use the same XML test harness as the existing spreadsheet reader tests.
const xmlHarness = fs.readFileSync(path.join(__dirname,'xlsx-reader.test.js'),'utf8');
const parser = xmlHarness.slice(xmlHarness.indexOf('class XmlNode'),xmlHarness.indexOf('const context ='));
const ctx = {window:{},TextEncoder,TextDecoder,Uint8Array,DataView,Blob,Response,DecompressionStream,URL,console};
vm.createContext(ctx);
vm.runInContext(parser+';globalThis.DOMParser=SimpleDOMParser;',ctx);
vm.runInContext(read('src/core/xlsx-reader.js'),ctx); vm.runInContext(read('src/core/xlsx-writer.js'),ctx);
const writer = ctx.window.BTGXlsxWriter, reader = ctx.window.BTGSpreadsheetReader;

(async()=>{
  const now = new Date(2026,8,17,15,0);
  const history = 'Hayran Kulübü\n500\nGeçmiş\n' + Array.from({length:10},(_,i)=>`Eyl\n${16-i}\nYayın\n10:00 - 12:00 · ${i===0?100:10}K beğeni`).join('\n');
  const assessment = assess({text:history,now,followerCount:35000,viewers:123});
  assessment.snapshot.source='https://www.tiktok.com/@test_regular/live';
  assert.equal(assessment.metrics.activeDays,11);
  assert.equal(assessment.snapshot.sessionCount,10);
  assert.equal(assessment.snapshot.meanLikes,19000);
  assert.equal(assessment.metrics.medianLikes,10000);
  assert.equal(assessment.snapshot.sessions.length,10);
  const collection = [
    {username:'test_regular',classId:3,assessment},
    {username:'test_followers',classId:3,assessment:assess({now,followerCount:40000})},
    {username:'test_missing',classId:3},
    {username:'test_class2',classId:2,assessment},
  ];
  const bytes = writer.buildNameCollectionWorkbook(collection);
  const rows = await reader.readXlsxRows(bytes.buffer);
  assert.equal(rows[0][0],'Yayıncı ID'); assert.equal(rows[0][1],'Sınıf');
  assert.equal(rows[0][2],'Kısa Değerlendirme'); // Team Plan compatibility.
  assert.equal(rows[2][9],''); assert.equal(rows[2][11],''); // missing != zero.
  const records = I.readCollection(rows), drafts = records.map(r=>I.draft(r,now));
  assert.equal(records.length,3);
  assert.match(drafts[0].message,/en az 11 farklı gün/);
  assert.match(drafts[0].message,/ortalama beğeni sayısı 19 bin civarında/);
  assert.doesNotMatch(drafts[0].message,/10 bin/);
  assert.match(drafts[1].message,/40 bin civarında takipçi/); assert.doesNotMatch(drafts[1].message,/düzen|ortalama beğeni/);
  const rounded = I.draft({...records[0],meanLikes:11850,activeDays:13},now);
  assert.match(rounded.observation,/bugünkü yayınınızla birlikte en az 13 farklı gün/);
  assert.match(rounded.observation,/ortalama beğeni sayısı 12 bin civarında/);
  assert.doesNotMatch(rounded.observation,/11[.,]850|tarihli|değerlendirme|kaydedilmiş/);
  const everyDay = I.draft({...records[0],meanLikes:11850,activeDays:14},now);
  assert.match(everyDay.observation,/Son iki haftanın her günü yayın açmışsınız/);
  assert.doesNotMatch(everyDay.observation,/en az 14 farklı gün/);
  const later = I.draft({...records[0],meanLikes:11850},new Date(now.getTime()+86400000));
  assert.doesNotMatch(later.observation,/bugünkü|Son iki haftada/);
  assert.equal(drafts[2].message,'');
  const obsolete = I.draft(records[0],new Date(now.getTime()+15*86400000));
  assert.equal(obsolete.message,''); assert.match(obsolete.status,/eski/);
  assert.equal(I.draft({...records[0],capturedAt:'bad'},now).message,'');
  assert.equal(I.draft({...records[0],periodStart:'2026-02-30'},now).message,'');
  drafts[0].message += '\n\nDüzenlenmiş metin: <BTG> & 👋';
  const finalBytes=writer.buildInvitationWorkbook(drafts);
  const finalRows=await reader.readXlsxRows(finalBytes.buffer);
  const imported=I.readMessages(finalRows);
  assert.deepEqual(imported.usernames,['test_regular','test_followers']);
  assert.equal(imported.skipped,1);
  assert.equal(imported.messages.test_regular,drafts[0].message);
  assert.equal(imported.messages.test_followers,drafts[1].message);
  assert.throws(()=>I.readMessages([finalRows[0],finalRows[1],[...finalRows[1].slice(0,1),'Başka mesaj']]),/farklı davet/);
  assert.throws(()=>I.readMessages([['Kullanıcı Adı','Davet Mesajı'],['bad user','hello']]),/Geçersiz/);
  assert.throws(()=>I.readMessages([['Kullanıcı Adı','Davet Mesajı'],['test_user','']]),/hazır davet/);
  assert.throws(()=>I.readMessages([['Kullanıcı Adı','Davet Mesajı'],['test_user','x'.repeat(5001)]]),/5.000/);
  assert.equal(I.readCollection([['Yayıncı ID','Sınıf'],['test_old',3]]).length,1);
  assert.equal(I.draft(I.readCollection([['Yayıncı ID','Sınıf'],['test_old',3]])[0],now).message,'');
  assert.throws(()=>I.readCollection([...rows,[...rows[1].slice(0,8),999,...rows[1].slice(9)]]),/farklı kayıt/);

  // Actual Listeden Kontrol resolver: order changes cannot swap recipient messages.
  const content=read('src/content/tiktok-content.js');
  const resolver=content.slice(content.indexOf('  function listMessageForUsername'),content.indexOf('  async function runListController'));
  const runtime={}; vm.createContext(runtime); vm.runInContext(resolver,runtime);
  const settings={mode:'manual',message:'COMMON MUST NOT BE USED',usePersonalizedMessages:true,personalizedMessages:imported.messages};
  assert.equal(runtime.listMessageForUsername(settings,'TEST_FOLLOWERS'),drafts[1].message);
  assert.equal(runtime.listMessageForUsername(settings,'test_regular'),drafts[0].message);
  assert.equal(runtime.listMessageForUsername(settings,'other_user'),'');
  assert.equal(runtime.listMessageForUsername({...settings,usePersonalizedMessages:false},'other_user'),settings.message);
  const flow=content.slice(content.indexOf('  async function runListController'),content.indexOf('  function isManualSkipUsername'));
  assert.match(flow,/message = listMessageForUsername/);
  assert.match(flow,/type: "BTG_SEND_DM",\s*username,\s*message/);
  assert.doesNotMatch(flow,/message: controller.settings.message/);

  // Manual export retains the same snapshot as automatic collection export.
  const background=read('src/background/background.js');
  const bg={chrome:{storage:{local:{get:async()=>({runtime:{collectionRows:collection},settings:{mode:'collect'}})}}},sanitizeReportText:(v)=>String(v||''),validIsoDate:v=>v};
  vm.createContext(bg);
  vm.runInContext(background.slice(background.indexOf('async function exportReport()'),background.indexOf('function sanitizeReportText')),bg);
  const report=await bg.exportReport();
  const manualRows=await reader.readXlsxRows(writer.buildNameCollectionWorkbook(report.rows).buffer);
  assert.deepEqual(Array.from(manualRows[1]),Array.from(rows[1]));

  if(process.env.BTG_INVITATION_FIXTURES) {
    fs.mkdirSync(process.env.BTG_INVITATION_FIXTURES,{recursive:true});
    fs.writeFileSync(path.join(process.env.BTG_INVITATION_FIXTURES,'collection-test.xlsx'),bytes);
    fs.writeFileSync(path.join(process.env.BTG_INVITATION_FIXTURES,'invitations-test.xlsx'),finalBytes);
  }
  console.log('Collection snapshot → XLSX → draft → XLSX → per-user Listeden Kontrol roundtrip passed; missing/stale/duplicate and fallback protections passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core/feedback-core'),I=require('../src/core/feedback-insights'),P=require('../src/core/feedback-package'),H=require('../src/core/feedback-history');
const binding={recordKey:'scenario:1',creatorKey:'username:creator',username:'creator'};
function live(day,{duration='1s',watch='30sn',viewers='200',diamonds='0',type='Normal',time='12:00:00'}={}){
 return {'Başlangıç zamanı':`${day}.09.2026 ${time}`,'CANLI Yayın süresi':duration,'İzleyici başına ort. izleme süresi':watch,
 'İzleyiciler':viewers,Elmaslar:diamonds,'CANLI Yayın türü':type};
}
function report(rows){return {schemaVersion:1,username:'creator',requestedStart:'2026-09-08',requestedEnd:'2026-09-20',
 collectedAt:'2026-09-21T06:09:17.590Z',status:'partial',warnings:['Günlük tarih aralığı doğrulanamadı.'],performance:[],sessions:{rows}};}
const brief=rows=>I.build(report(rows),binding,[],C);
const has=(rows,key)=>brief(rows).topicCandidates.some(c=>c.key===key);

test('25 seconds is an exclusive threshold; at least two measured lives and half of observations are required',()=>{
 assert.equal(has([live(19,{watch:'24sn'}),live(20,{watch:'25sn'})],'short-watch'),false);
 assert.equal(has([live(19,{watch:'24sn'}),live(20,{watch:'24sn'})],'short-watch'),true);
 assert.equal(has([live(18,{watch:'24sn'}),live(19,{watch:'24sn'}),live(20),live(17)],'short-watch'),true);
 assert.equal(has([live(18,{watch:'24sn'}),live(19,{watch:'24sn'}),live(20),live(17),live(16)],'short-watch'),false);
});

test('Retention includes sub-hour lives, unknown types and low but nonzero audience; missing values stay missing',()=>{
 const rows=[live(19,{watch:'14sn',duration:'10dk',type:'',viewers:'5'}),live(20,{watch:'23sn',duration:'20dk',type:'',viewers:'5'}),live(18,{watch:'-'})];
 const b=brief(rows),summary=b.evidence.find(e=>e.kind==='session_pattern');
 assert.equal(b.primary.key,'short-watch');assert.equal(summary.measuredSessionCount,2);assert.equal(summary.belowThresholdCount,2);
 for(const field of ['watch','viewers','duration'])assert.equal(has([live(19,{[field]:'-'}),live(20,{watch:'14sn'})],'short-watch'),false);
 assert.equal(has([live(19,{watch:'0',viewers:'0'}),live(20,{watch:'0',viewers:'0'})],'short-watch'),false);
});

test('Only the recent seven days and dates after joining contribute to scenarios',()=>{
 assert.equal(has([live(13,{watch:'10sn'}),live(20,{watch:'10sn'})],'short-watch'),false);
 assert.equal(has([live(13,{duration:'30dk'}),live(19,{duration:'30dk'}),live(20,{duration:'30dk'})],'short-lives'),false);
 const r=report([live(14,{watch:'10sn'}),live(20,{watch:'10sn'})]);r.requestedStart='2026-09-19';
 assert.equal(I.build(r,binding,[],C).primary,null);
});

test('Three short dates trigger despite a completed hour on another date; one or two short dates remain quiet',()=>{
 const rows=[live(16,{duration:'5dk'}),live(18,{duration:'59dk 59sn'}),live(20,{duration:'30dk'})];
 assert.equal(has(rows.slice(0,1),'short-lives'),false);assert.equal(has(rows.slice(0,2),'short-lives'),false);
 const b=brief([...rows,live(19)]);assert.equal(b.primary.key,'short-lives');
 assert.equal(b.evidence.find(e=>e.id.endsWith('short-live-frequency')).observedShortDays,3);
 assert.equal(has([...rows,live(20,{time:'18:00:00'})],'short-lives'),false);
 assert.equal(has([...rows,live(20,{time:'18:00:00',duration:'-'})],'short-lives'),false);
});

test('Two half hours on a date never become a completed single live, and several lives on one date count once',()=>{
 const rows=[16,18,20].flatMap(day=>[live(day,{duration:'30dk'}),live(day,{duration:'30dk',time:'18:00:00'})]);
 assert.equal(has(rows,'short-lives'),true);
 assert.equal(has(rows.slice(0,2),'short-lives'),false);
});
test('Interrupted session pagination cannot claim a date had no hour-long live; measured watch remains usable',()=>{
 const r=report([16,18,20].map(day=>live(day,{duration:'30dk',watch:'15sn'})));r.sessions.tableComplete=false;
 const b=I.build(r,binding,[],C);
 assert.equal(b.topicCandidates.some(c=>c.key==='short-lives'),false);assert.equal(b.primary.key,'short-watch');
});

test('Strong diamonds, watch and reach each authorize a dated retry without requiring full daily data',()=>{
 for(const [metric,options] of [['diamonds',{diamonds:'300'}],['averageWatchSeconds',{watch:'60sn'}],['viewers',{viewers:'600'}]]){
   const b=brief([live(19,options),live(20)]);
   assert.equal(b.primary.key,'standout-live');assert.equal(b.responseMode,'coaching');
   assert.deepEqual(b.primary.adviceCodes,['BS-P01']);
   assert.equal(b.evidence.find(e=>e.kind==='session_comparison').metric,metric);
 }
 const b=brief([live(19,{diamonds:'165',watch:'-',viewers:'711',duration:'3s 22dk 1sn'}),live(20,{diamonds:'0',watch:'-',viewers:'1282',duration:'2s 22dk 29sn'})]);
 assert.equal(b.primary.key,'standout-live');
});

test('Small changes, unlike durations or types, duration-only growth, and old winning lives do not become standout topics',()=>{
 for(const pair of [
 [live(19,{diamonds:'6'}),live(20,{diamonds:'1'})],
 [live(19,{viewers:'240'}),live(20)],
 [live(19,{watch:'60sn',duration:'4s'}),live(20)],
 [live(19,{watch:'60sn',type:'Çoklu konuk'}),live(20)],
 [live(19,{diamonds:'300',duration:'1s 30dk'}),live(20,{diamonds:'200'})],
 [live(13,{watch:'60sn'}),live(20)],
 ])assert.equal(has(pair,'standout-live'),false);
});

// Only the four single-live facts actually included in the attached MD, not a complete history.
const exampleRows=[
 live(15,{duration:'3s 22dk 1sn',watch:'36sn',diamonds:'165',viewers:'711',time:'19:43:18'}),
 live(20,{duration:'2s 22dk 29sn',watch:'14sn',diamonds:'0',viewers:'1282',time:'14:52:34'}),
 live(17,{duration:'1s 24dk 17sn',watch:'23sn',diamonds:'37',viewers:'718',type:'Çoklu konuk',time:'13:27:16'}),
 live(18,{duration:'1s 10dk 2sn',watch:'1dk',diamonds:'29',viewers:'212',type:'Çoklu konuk',time:'15:23:37'})
];
test('Attached no_message regression: the four exported facts now support watch focus and a strong dated live',()=>{
 const b=brief(exampleRows);assert.equal(b.primary.key,'short-watch');assert.equal(b.noMessageReason,null);
 assert.ok(b.topicCandidates.some(c=>c.key==='standout-live'&&c.role==='topic'));
 assert.equal(b.overallContext.recent7.durationSeconds,null);assert.equal(b.overallContext.sessions.recentCount,4);
 const p=P.create([report(exampleRows)],H.empty(),C,'',{id:'scenario'}),rules=p.manifest.messageRules['scenario:1'];
 assert.equal(rules.allowedBlank,false);assert.ok(!rules.allowedAdviceCodes.includes('BS-P01'));
 const findings=['scenario:1:short-watch'];
 const row={...p.manifest.records[0],message:'Merhaba, 17.09.2026 ve 20.09.2026 yayınlarında gelenler ortalama 23 ve 14 saniye kalmış. İzleyicilerin yayında daha uzun kalmasına odaklanalım.',recommendations:'[BS-I05] İzleme odağı',reviewNote:JSON.stringify({bulgular:findings,dayanaklar:rules.findingEvidenceIds[findings[0]],not:'Yalnız seçilen izleme bulgusu yazım görünümüne alındı.'})};
 assert.deepEqual(P.validateRows(p.manifest,[row]).errors,[]);
 assert.ok(P.validateRows(p.manifest,[{...row,recommendations:'[BS-P01] Güçlü yayını yeniden deneme'}]).errors.length);
 const onlyStrong=P.create([report(exampleRows.slice(0,2))],H.empty(),C,'',{id:'strong'});
 assert.equal(onlyStrong.manifest.messageRules['strong:1'].primaryKey,'standout-live');
 assert.equal(onlyStrong.manifest.messageRules['strong:1'].allowedBlank,false);
});

test('The exported prompt uses one consistent v6 guide, and report TXT retains raw data and calculations',()=>{
 assert.match(C.prompt,/v6.9/);assert.doesNotMatch(C.prompt,/V5 KONU|v4.4|o gün işe yarayanı tekrar et.*belirsiz/);
 assert.match(C.prompt,/standout-live/);assert.match(C.prompt,/25 saniye/);
 const txt=C.txt(report(exampleRows));assert.match(txt,/calculatedFacts/);assert.match(txt,/sessions/);assert.match(txt,/3s 22dk 1sn/);
});

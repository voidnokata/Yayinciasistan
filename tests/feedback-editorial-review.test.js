const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../src/core/feedback-core'),I=require('../src/core/feedback-insights'),P=require('../src/core/feedback-package'),H=require('../src/core/feedback-history');
const binding={recordKey:'review:1',creatorKey:'username:creator',username:'creator'};
function live(day,watch=5){return {'Başlangıç zamanı':`${day}.09.2026 12:00:00`,'CANLI Yayın süresi':'1s',
 'İzleyici başına ort. izleme süresi':watch+'sn','İzleyiciler':'100','CANLI Yayın türü':'Normal',Elmaslar:'0'};}
function report(rows=[]){return {schemaVersion:1,username:'creator',requestedStart:'2026-09-07',requestedEnd:'2026-09-20',
 collectedAt:'2026-09-21T08:00:00Z',status:'partial',warnings:['Daily table unavailable'],performance:[],sessions:{rows}};}
const build=r=>I.build(r,binding,[],C);
const daily=(day,active)=>({Tarih:`${String(day).padStart(2,'0')}.09.2026`,'CANLI Yayın süresi':active?'1s':'0',Elmaslar:'0','Yeni takipçiler':'0'});

test('Past activity with missing recent dates cannot become advice to maintain the current routine',()=>{
 const r=report([live(17,60)]);
 r.performance=[{rows:Array.from({length:11},(_,i)=>daily(i+7,[7,8,13].includes(i+7)))}];
 const b=build(r);assert.equal(b.primary,null);assert.equal(b.overallContext.regularity,'unknown');
 assert.equal(b.overallContext.observation.observedActiveDays,3);
 assert.ok(!b.topicCandidates.some(c=>c.key==='observed-activity'));
 assert.equal(b.noMessageDetails.recentObservedActiveDays,0);
 assert.equal(b.noMessageDetails.recentSessionCount,1);
 assert.match(b.noMessageReason,/senaryo koşulları/);assert.doesNotMatch(b.noMessageReason,/yayın yapmıyor/);
});

test('Partial activity support uses recent daily evidence rather than older dates or a full regularity claim',()=>{
 const r=report();r.performance=[{rows:[daily(7,true),daily(15,true),daily(18,true)]}];
 const b=build(r);assert.equal(b.primary.key,'observed-activity');assert.equal(b.overallContext.regularity,'observed-partial');
 const e=b.evidence.find(e=>e.kind==='daily_period');assert.equal(e.from,'2026-09-14');
 assert.deepEqual(e.activeDates,['2026-09-15','2026-09-18']);
 const pkg=P.create([r],H.empty(),C,'',{id:'review'}),rules=pkg.manifest.messageRules['review:1'];
 const row={...pkg.manifest.records[0],message:'15.09.2026 ve 18.09.2026 günlerinde yayın açmışsın. Bu yayın düzenini sürdürmeni öneririm.',
 recommendations:'[BS-K01] Görülen emeği destekleme',reviewNote:JSON.stringify({bulgular:[b.primary.id],dayanaklar:b.primary.evidenceIds,not:'Eksik günlük kapsam.'})};
 const result=P.validateRows(pkg.manifest,[row]);assert.deepEqual(result.errors,[]);assert.ok(result.warnings.some(w=>w.includes('Eksik günlük kapsam')));
});

test('Two or three measured lives remain usable without implying an established frequent pattern',()=>{
 for(const count of [2,3]){
  const r=report(Array.from({length:count},(_,i)=>live(20-i))),b=build(r);
  assert.equal(b.primary.key,'short-watch');assert.equal(b.noMessageReason,null);
  assert.equal(b.evidence.find(e=>e.kind==='session_pattern').languageScope,'observed_lives');
  const pkg=P.create([r],H.empty(),C,'',{id:'review'}),rules=pkg.manifest.messageRules['review:1'];
  const row={...pkg.manifest.records[0],message:'Merhaba, 19.09.2026 ve 20.09.2026 yayınlarında gelenler ortalama 5 saniye kalmış. İzleyicilerin 25 saniyeden az kaldığı yayınlar sık tekrarlanıyor. Gelenlerin daha uzun kalmasına odaklanmanı öneririm.',
   recommendations:'[BS-I05] İzleme odağı',reviewNote:JSON.stringify({bulgular:[b.primary.id],dayanaklar:rules.findingEvidenceIds[b.primary.id],not:'Görülen yayınlar.'})};
  const original=P.validateRows(pkg.manifest,[row]);assert.deepEqual(original.errors,[]);assert.ok(original.warnings.some(w=>w.includes('iki veya üç ölçüme')));
  row.message='Merhaba, 19.09.2026 ve 20.09.2026 yayınlarında gelenler ortalama 5 saniye kalmış. Gelenlerin yayında daha uzun kalmasına odaklanmanı öneririm.';
  const improved=P.validateRows(pkg.manifest,[row]);assert.deepEqual(improved.errors,[]);assert.deepEqual(improved.warnings,[]);
 }
});

test('A larger short-watch sample preserves the approved frequent-pattern wording',()=>{
 const r=report(Array.from({length:8},(_,i)=>({...live(20-i%7,i<6?13:60),'Başlangıç zamanı':`${20-i%7}.09.2026 ${i<7?'12':'18'}:00:00`}))),b=build(r);
 assert.equal(b.evidence.find(e=>e.kind==='session_pattern').languageScope,'frequent_pattern');
 const pkg=P.create([r],H.empty(),C,'',{id:'review'});assert.deepEqual(pkg.manifest.messageRules['review:1'].limitedWatchFindingIds,[]);
});

test('No-message reasons distinguish missing recent records from available records without a qualifying topic',()=>{
 const empty=build(report());assert.match(empty.noMessageReason,/Güncel tek yayın kaydı yok/);assert.equal(empty.noMessageDetails.recentSessionCount,0);
 const flat=build(report([live(19,60),live(20,60)]));assert.equal(flat.primary,null);
 assert.equal(flat.noMessageDetails.recentSessionCount,2);assert.equal(flat.noMessageDetails.measuredWatchCount,2);
 assert.equal(flat.noMessageDetails.belowWatchThresholdCount,0);assert.match(flat.noMessageReason,/senaryo koşulları/);
 assert.doesNotMatch(flat.noMessageReason,/Güncel tek yayın kaydı yok/);
});

test('The exported writing guide matches the reviewed local guide',()=>{
 const guide=fs.readFileSync(path.join(__dirname,'../docs/GERIBILDIRIM_TON_REHBERI.md'),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();
 assert.equal(C.prompt,guide);assert.match(C.prompt,/writingBrief|fixedCells/);
 assert.match(C.prompt,/Mesajlarda noktalı virgül kullanma/);
 assert.match(C.prompt,/Nasılsın\? O tarihten sonra/);
});

test('Semicolons prompt a style review without silently rewriting the message',()=>{
 const pkg=P.create([report([live(19),live(20)])],H.empty(),C,'',{id:'punctuation'});
 const rules=pkg.manifest.messageRules['punctuation:1'];
 const row={...pkg.manifest.records[0],...rules.fixedCells,message:'Selamlar, 19 ve 20 Eylül yayınlarında ortalama izleme 5 saniye olmuş; sonraki yayınlarında izleyicilerin daha uzun kalmasına odaklanabilirsin.'};
 const checked=P.validateRows(pkg.manifest,[row]);
 assert.deepEqual(checked.errors,[]);assert.equal(checked.rows[0].message,row.message);
 assert.ok(checked.warnings.some(w=>w.includes('noktalı virgül')));
 row.message=row.message.replace('; sonraki','. Sonraki');
 assert.ok(!P.validateRows(pkg.manifest,[row]).warnings.some(w=>w.includes('noktalı virgül')));
});

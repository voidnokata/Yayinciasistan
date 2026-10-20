const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core/feedback-core'),I=require('../src/core/feedback-insights'),P=require('../src/core/feedback-package'),H=require('../src/core/feedback-history');
const date=d=>String(d).padStart(2,'0')+'.09.2026';
function report({start=2,days=14,duration='2s',diamonds='0'}={}){
 return {schemaVersion:1,username:'creator',requestedStart:`2026-09-${String(start).padStart(2,'0')}`,requestedEnd:'2026-09-15',collectedAt:'2026-09-16T10:00:00Z',performance:[{rows:Array.from({length:days},(_,i)=>({Tarih:date(start+i),'CANLI Yayın süresi':duration,Elmaslar:diamonds,'Yeni takipçiler':'0'}))}],sessions:{rows:[]},regions:[],warnings:[]};
}
function live(day,{duration='1s',watch='1dk',viewers='100',diamonds='0',type='Normal',followers='0',comments='0',time='12:00:00'}={}){return {'Başlangıç zamanı':date(day)+' '+time,'CANLI Yayın süresi':duration,'İzleyici başına ort. izleme süresi':watch,'İzleyiciler':viewers,Elmaslar:diamonds,'CANLI Yayın türü':type,'Yeni takipçiler':followers,'Yorum yapanlar':comments};}
const binding={recordKey:'p:1',creatorKey:'username:creator',username:'creator'};
const brief=(r,history=[])=>I.build(r,binding,history,C);
test('New join has a usable six-day observation without inventing two complete weeks',()=>{
 const r=report({start:10,days:6});r.sessions.rows=[live(12,{watch:'11sn'}),live(14,{watch:'13sn'}),live(15,{watch:'16sn'})];
 const f=C.feedbackFacts(r),b=brief(r);assert.equal(f.comparison.comparable,false);assert.equal(f.observation.calendarDays,6);assert.equal(f.observation.durationSeconds,43200);assert.equal(b.primary.key,'short-watch');assert.equal(b.noMessageReason,null);
});
test('Pre-joining lives are not used as current agency evidence, and 59 minutes never rounds to 60',()=>{
 const r=report({start:10,days:6});r.sessions.rows=[live(5,{duration:'59dk'}),live(11,{duration:'1s'})];
 assert.equal(C.feedbackFacts(r).sessions.length,1);
 assert.equal(I.durationText(3599),'yaklaşık 59 dakika');assert.equal(I.durationText(3600),'1 saat');assert.equal(I.durationText(null),null);
});
test('Missing, duplicate, unknown or contradictory data cannot label a creator inactive',()=>{
 for(const change of [r=>r.performance[0].rows.pop(),r=>r.performance[0].rows.push(r.performance[0].rows[0]),r=>r.performance[0].rows[0]['CANLI Yayın süresi']='-',r=>r.sessions.rows.push(live(15))]){
  const r=report({duration:'0'});change(r);assert.notEqual(brief(r).primary?.key,'inactive');
 }
 assert.equal(brief(report({duration:'0'})).primary.key,'inactive');
});
test('Material diamond decline and activity collapse cannot be displaced by a flattering watch example',()=>{
 const r=report({diamonds:'200'});r.performance[0].rows.forEach((row,i)=>{if(i>=7){row.Elmaslar='50';row['CANLI Yayın süresi']='1s';}});
 r.sessions.rows=[live(10,{watch:'2dk'}),live(14,{watch:'4dk'})];
 const b=brief(r);assert.equal(b.primary.key,'activity-drop');assert.ok(b.requiredFindingIds.includes('p:1:diamond-decline'));assert.ok(b.support.some(c=>c.key==='diamond-decline'));
});
test('Tiny diamond changes are not promoted by large percentages; close changes remain quiet',()=>{
 for(const [a,b] of [[6,1],[3,0],[282,325]]){
  const r=report();r.performance[0].rows.forEach((row,i)=>{row.Elmaslar=String(i===0?a:i===7?b:0);});
  assert.ok(!brief(r).considered.some(c=>c.key==='diamond-decline'));
 }
});
test('Daily sum is never a single live; exact 60 minutes suppresses same-date short recommendations',()=>{
 const r=report();r.sessions.rows=[live(14,{duration:'30dk'}),live(14,{duration:'30dk',time:'16:00:00'})];
 assert.ok(!brief(r).considered.some(c=>c.key==='near-hour'));
 r.sessions.rows=[live(14,{duration:'59dk 56sn'}),live(14,{duration:'1s',time:'16:00:00'})];assert.ok(!brief(r).considered.some(c=>c.key==='near-hour'));
 r.sessions.rows.pop();assert.equal(brief(r).primary.key,'maintain'); // An occasional short day is not a problem.
});
test('Older short lives do not override recent completed hours',()=>{
 const r=report();r.sessions.rows=[live(3,{duration:'25dk'}),live(5,{duration:'30dk'}),live(12,{duration:'35dk'}),live(14)];
 assert.ok(!brief(r).considered.some(c=>c.key==='short-lives'));
});
test('Comparable lives require known type, similar duration and sufficient viewers',()=>{
 for(const update of [{type:'Other'},{type:''},{duration:'4s'},{viewers:'3'}]){
  const r=report();r.sessions.rows=[live(10,{watch:'3dk'}),live(14,{watch:'30sn',...update})];assert.ok(!brief(r).considered.some(c=>c.key==='watch-comparison'));
 }
 const r=report();r.sessions.rows=[live(10,{watch:'3dk'}),live(14,{watch:'30sn'})];const b=brief(r);assert.equal(b.primary.key,'standout-live');assert.ok(b.supportingObservations.some(c=>c.key==='watch-comparison'));
});
test('A later stronger live does not erase repeated short-watch sessions',()=>{
 const r=report();r.sessions.rows=[live(11,{watch:'10sn'}),live(12,{watch:'10sn'}),live(14,{watch:'10sn'}),live(15,{watch:'10sn'}),live(15,{watch:'2dk',time:'18:00:00'})];
 assert.ok(brief(r).considered.some(c=>c.key==='short-watch'));
});
test('Retention evidence cannot authorize a generic question or follow invitation',()=>{
 const r=report();r.sessions.rows=[live(10,{watch:'3dk'}),live(14,{watch:'30sn'})];const b=brief(r);
 assert.ok(!b.primary.adviceCodes.includes('BS-E02'));assert.ok(!b.primary.adviceCodes.includes('BS-F03'));
});
test('A two-live comparison stays supporting; a draft is not treated as sent history',()=>{
 const r=report({start:10,days:6});r.sessions.rows=[live(11,{watch:'3dk'}),live(14,{watch:'12sn'}),live(15,{watch:'14sn'})];
 assert.notEqual(brief(r).primary.key,'watch-comparison');
 const b=brief(r,[{sentAt:'2026-09-01',recommendationIds:['BS-I04'],text:'O gün işe yaradığını düşündüğün bir şeyi yeniden dene.'}]);assert.ok(!b.requiredFindingIds.some(id=>id.endsWith(':watch-comparison')));
 const h=H.empty();h.creators['username:creator']={sent:[],draft:{text:'Bir saat'}};const p=P.create([r],h,C,'',{id:'p'});assert.equal(p.manifest.messageRules['p:1'].firstFeedback,true);
});
test('Maintain is a fallback, not a universal plan; no invented problem when data is flat',()=>{
 const r=report();assert.equal(brief(r).primary.key,'maintain');
 r.sessions.rows=[live(10,{watch:'2dk',followers:'20'}),live(14,{watch:'2dk',followers:'2'})];const b=brief(r);assert.equal(b.primary.key,'maintain');assert.ok(b.supportingObservations.some(c=>c.key==='followers'));
});
function qualityFixture(){
 const r=report();r.sessions.rows=[live(12,{duration:'59dk'}),live(13,{duration:'59dk'}),live(14,{duration:'59dk'})];
 const p=P.create([r],H.empty(),C,'',{id:'p'}),rules=p.manifest.messageRules['p:1'];
 const primary='p:1:short-lives',evidence=rules.findingEvidenceIds[primary];
 const row={...p.manifest.records[0],message:'13.09.2026 ve 14.09.2026 günleri yaklaşık 59 dakika yayın açmışsın. Bir dahaki sefere o gün başka bir yayında bir saat dolmadıysa, kapatmadan süreye bakıp aynı yayını bir saate tamamlamanı öneririm.',recommendations:'[BS-S01] Bir saate yaklaşan yayını tamamlama',reviewNote:JSON.stringify({bulgular:[primary],dayanaklar:evidence,not:'Üç ayrı günde bir saatin altında yayın.'})};return {p,rules,row};
}
test('New package contract accepts grounded prose, rejects foreign evidence and generic fallback',()=>{
 const {p,row}=qualityFixture();assert.deepEqual(P.validateRows(p.manifest,[row]).errors,[]);
 for(const update of [{recommendations:'[BS-K01] Devam et'},{reviewNote:JSON.stringify({bulgular:['p:2:near-hour'],dayanaklar:['p:2:s1'],not:'x'})},{message:'Yayın düzenin güzel, aynı şekilde devam et.'},{message:row.message.replaceAll('14.09.2026','08.09.2026')}])assert.ok(P.validateRows(p.manifest,[{...row,...update}]).errors.length);
});
test('Length, first-contact wording and technical language are checked without rewriting the sent message',()=>{
 const {p,row}=qualityFixture();
 for(const extra of [' oturum kaydında.',' geçen hafta.',' -- ',' '+Array(161).fill('sözcük').join(' ')])assert.ok(P.validateRows(p.manifest,[{...row,message:row.message+extra}]).errors.length);
 assert.equal(P.validateRows(p.manifest,[row]).rows[0].message,row.message);
 assert.equal(P.reviewNoteText(row.reviewNote),'Üç ayrı günde bir saatin altında yayın.');
});
test('Blank useful messages and near duplicate batch messages are visible, never silently sent',()=>{
 const {p,row}=qualityFixture();const result=P.validateRows(p.manifest,[{...row,message:'',reviewNote:'no data'}]);assert.equal(result.excluded.length,1);assert.ok(result.warnings.length);
 assert.ok(P.repetitionWarnings([row,{...row,username:'second'}],p.manifest).length);
});
test('Watch duration preserves seconds instead of exaggerating the comparison',()=>{
 assert.equal(I.watchText(356),'5 dakika 56 saniye');assert.equal(I.watchText(100),'1 dakika 40 saniye');
 assert.equal(I.watchText(13),'13 saniye');assert.equal(I.watchText(null),null);
 const r=report();r.sessions.rows=[live(11,{watch:'5dk 56sn'}),live(14,{watch:'1dk 40sn'})];
 const b=brief(r);assert.equal(b.evidence.find(e=>e.averageWatchSeconds===356).display.averageWatch,'5 dakika 56 saniye');
});
test('A factual decline written with another verb is not rejected by keyword matching',()=>{
 const r=report();r.performance[0].rows.forEach((x,i)=>{x['CANLI Yayın süresi']=i<7?'4s':'0';});r.performance[0].rows[7]['CANLI Yayın süresi']='1s';
 const p=P.create([r],H.empty(),C,'',{id:'p'}),rules=p.manifest.messageRules['p:1'];
 const row={...p.manifest.records[0],message:'02.09.2026 ile 08.09.2026 arasında her gün yayın varken, 09.09.2026 ile 15.09.2026 arasında yalnız bir gün yayın var; süre 28 saatten 1 saate inmiş. Yayın açmanı zorlaştıran bir durum var mı?',recommendations:'[BS-D02] Durum sorusu',reviewNote:JSON.stringify({bulgular:rules.requiredFindingIds,dayanaklar:rules.requiredEvidenceIds,not:'Tam dönem kıyası'})};
 assert.deepEqual(P.validateRows(p.manifest,[row]).errors,[]);
 row.message='02.09.2026 ile 08.09.2026 arasında 28 saat yayın varken, 09.09.2026 ile 15.09.2026 arasında 1 saat yayın var. Yayın açmanı zorlaştıran bir durum var mı?';
 const checked=P.validateRows(p.manifest,[row]);assert.deepEqual(checked.errors,[]);assert.ok(checked.warnings.length);
});
test('Preparation advice needs no day qualification unless it asserts valid-day gain',()=>{
 const r=report({duration:'10dk'});r.sessions.rows=[live(9,{duration:'25dk'}),live(10,{duration:'35dk'}),live(13,{duration:'30dk'})];
 const p=P.create([r],H.empty(),C,'',{id:'p'}),rules=p.manifest.messageRules['p:1'];assert.equal(rules.primaryKey,'short-lives');
 const primary='p:1:short-lives';
 const row={...p.manifest.records[0],message:'10.09.2026 ve 13.09.2026 yayınların kısa sürmüş. Sonraki yayınların için birkaç başlık seçerek bir saate yaklaşmanı kolaylaştırabilirsin.',recommendations:'[BS-S02] Başlık hazırlığı',reviewNote:JSON.stringify({bulgular:[primary],dayanaklar:rules.findingEvidenceIds[primary],not:'Kısa yayın örnekleri'})};
 assert.deepEqual(P.validateRows(p.manifest,[row]).errors,[]);
 assert.ok(P.validateRows(p.manifest,[{...row,message:row.message+' Böylece geçerli yayın günü kazanırsın.'}]).errors.length);
 assert.ok(P.validateRows(p.manifest,[{...row,recommendations:'[BS-S01] Süre hedefi'}]).errors.length);
});
test('The exported message purpose allows a check-in to end with a question without losing material diamond evidence',()=>{
 const r=report({diamonds:'200'});r.performance[0].rows.forEach((row,i)=>{if(i>=7){row.Elmaslar='50';row['CANLI Yayın süresi']='1s';}});
 const p=P.create([r],H.empty(),C,'',{id:'p'});
 const data=JSON.parse(p.markdown.match(/```json\s*([\s\S]*?)```/)[1]),b=data.creators[0].messageBrief;
 assert.equal(b.mode,'check_in');assert.equal(b.findings[0].key,'activity-drop');
 assert.ok(b.requiredFindingIds.includes('p:1:diamond-decline'));
 const rules=p.manifest.messageRules['p:1'];
 const row={...p.manifest.records[0],message:'Merhaba, 2–8 Eylül ile 9–15 Eylül yayınlarını karşılaştırdım. Toplam süren 14 saatten 7 saate, elmas kazanımın da 1.400’den 350’ye düşmüş. Yayın açmanı zorlaştıran bir durum mu var?',recommendations:'[BS-D02] Yayın azalması için durum sorusu',reviewNote:JSON.stringify({bulgular:rules.requiredFindingIds,dayanaklar:rules.requiredEvidenceIds,not:'Tam dönemlerde süre ve elmas azalması.'})};
 const checked=P.validateRows(p.manifest,[row]);assert.deepEqual(checked.errors,[]);assert.equal(checked.rows[0].message,row.message);
});
test('Message purpose separates absent, sparse, short-live, performance, affirmation and missing-data cases',()=>{
 assert.equal(brief(report({duration:'0'})).responseMode,'check_in');
 const sparse=report({duration:'0'});sparse.performance[0].rows[13]['CANLI Yayın süresi']='1s';assert.equal(brief(sparse).primary.key,'sparse');assert.equal(brief(sparse).responseMode,'check_in');
 const short=report({duration:'10dk'});short.sessions.rows=[live(9,{duration:'25dk'}),live(10,{duration:'35dk'}),live(13,{duration:'30dk'})];assert.equal(brief(short).primary.key,'short-lives');assert.equal(brief(short).responseMode,'coaching');
 const performance=report();performance.sessions.rows=[live(10,{watch:'3dk'}),live(14,{watch:'30sn'})];assert.equal(brief(performance).responseMode,'coaching');
 assert.equal(brief(report()).responseMode,'affirmation');
 const missing=report();missing.performance=[];assert.equal(brief(missing).responseMode,'no_message');
});
test('Short-watch evidence exports focus without substituting another script for retired opening advice',()=>{
 const r=report({start:10,days:6});r.sessions.rows=[live(11,{watch:'7sn'}),live(14,{watch:'3sn'}),live(15,{watch:'16sn'})];
 for(const history of [[],[{sentAt:'2026-09-01',recommendationIds:['BS-I03'],text:'Açılışta ne yaptığını anlat.'}],[{sentAt:'2026-09-01',recommendationIds:['BS-I05'],text:'İzleyicilerin daha uzun kalmasına odaklan.'}]]){
  const b=brief(r,history);assert.equal(b.responseMode,'focus');assert.equal(b.primary.key,'short-watch');assert.deepEqual(b.primary.adviceCodes,['BS-I05']);assert.deepEqual(b.primary.actions.map(a=>a.code),['BS-I05']);
 }
 const p=P.create([r],H.empty(),C,'',{id:'p'}),b=JSON.parse(p.markdown.match(/```json\s*([\s\S]*?)```/)[1]).creators[0].messageBrief;
 assert.equal(b.mode,'focus');assert.equal(b.findings[0].key,'short-watch');assert.deepEqual(p.manifest.messageRules['p:1'].primaryAdviceCodes,['BS-I05']);
 assert.equal(I.actions['BS-I03'],undefined);
});
test('Focus message imports with evidence while retired opening advice is rejected even for an older manifest',()=>{
 const r=report({start:10,days:6});r.sessions.rows=[live(11,{watch:'7sn'}),live(14,{watch:'3sn'}),live(15,{watch:'16sn'})];
 const p=P.create([r],H.empty(),C,'',{id:'p'}),rules=p.manifest.messageRules['p:1'];
 const primary='p:1:short-watch';
 const row={...p.manifest.records[0],message:'Merhaba, 14.09.2026 ve 15.09.2026 yayınların bir saat sürmüş. İzleyiciler ortalama 3 ve 16 saniye kalmış. Şu an gelenlerin yayında daha uzun kalmasına odaklanmanı öneririm.',recommendations:'[BS-I05] İzleyicilerin daha uzun kalmasına odaklanma',reviewNote:JSON.stringify({bulgular:[primary],dayanaklar:rules.findingEvidenceIds[primary],not:'Kısa izleme; belirli yöntem için dayanak yok.'})};
 assert.deepEqual(P.validateRows(p.manifest,[row]).errors,[]);
 const legacy=JSON.parse(JSON.stringify(p.manifest));legacy.messageRules['p:1'].allowedAdviceCodes=['BS-I03','BS-I02'];legacy.messageRules['p:1'].primaryAdviceCodes=['BS-I03','BS-I02'];
 assert.ok(P.validateRows(legacy,[{...row,recommendations:'[BS-I03] Açılışta ne yaptığını anlatma'}]).errors.some(e=>e.includes('kullanımdan kaldırıldı')));
 assert.deepEqual(P.adviceMetadata('[BS-I03] Eski gönderim').recommendationIds,['BS-I03']);
});
test('Weekly diamond growth outranks an isolated pair and hourly yield changes remain visible',()=>{
 const growth=report();growth.performance[0].rows.forEach((row,i)=>{row.Elmaslar=i<7?'200':'400';});
 growth.sessions.rows=[live(10,{diamonds:'350',viewers:'500'}),live(14,{diamonds:'50',viewers:'500'})];
 let b=brief(growth);assert.equal(b.primary.key,'diamond-growth');assert.ok(!b.requiredFindingIds.some(id=>id.endsWith(':diamond-pair')));
 const efficiency=report();efficiency.performance[0].rows.forEach((row,i)=>{row.Elmaslar='200';row['CANLI Yayın süresi']=i<7?'2s':'4s';});
 b=brief(efficiency);assert.equal(b.primary.key,'diamond-yield-decline');
});
test('A large reach mismatch cannot create diamond coaching and a lone watch outlier cannot create a trend',()=>{
 const reach=report();reach.sessions.rows=[live(10,{diamonds:'350',viewers:'3000'}),live(14,{diamonds:'50',viewers:'30'})];
 assert.ok(!brief(reach).considered.some(c=>c.key==='diamond-pair'));
 const outlier=report();outlier.sessions.rows=Array.from({length:14},(_,i)=>live(i+2,{watch:i?'1dk':'10dk'}));
 const b=brief(outlier);assert.notEqual(b.primary.key,'watch-comparison');assert.ok(!b.requiredFindingIds.some(id=>id.endsWith(':watch-comparison')));
});
test('Incomplete coverage can support bounded activity without inventing inactivity',()=>{
 const r=report();r.performance[0].rows.splice(4,1);const b=brief(r);
 assert.equal(b.primary.key,'observed-activity');assert.equal(b.responseMode,'affirmation');assert.equal(b.overallContext.observation.observedActiveDays,13);assert.equal(b.overallContext.coverage.complete,false);
});

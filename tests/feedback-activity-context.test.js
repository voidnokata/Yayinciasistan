const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core/feedback-core'),I=require('../src/core/feedback-insights'),P=require('../src/core/feedback-package'),H=require('../src/core/feedback-history');
const binding={recordKey:'context:1',creatorKey:'username:creator',username:'creator'};
function report({days=[5,3],seconds=[44189,41360],diamonds=[247,6]}={}){
 const rows=[];
 for(let week=0;week<2;week++)for(let i=0;i<7;i++){
  const active=i>=7-days[week],rank=i-(7-days[week]);
  const sec=active?Math.floor(seconds[week]/days[week])+(rank<seconds[week]%days[week]?1:0):0;
  rows.push({Tarih:String(7+week*7+i).padStart(2,'0')+'.09.2026','CANLI Yayın süresi':sec?sec+'sn':'0',Elmaslar:String(i===6?diamonds[week]:0),'Yeni takipçiler':'0'});
 }
 return {schemaVersion:1,username:'creator',requestedStart:'2026-09-07',requestedEnd:'2026-09-20',collectedAt:'2026-09-21T09:00:00Z',status:'requested_daily_range_and_available_tables_complete',warnings:[],performance:[{rows}],sessions:{rows:[],tableComplete:true}};
}
const build=r=>I.build(r,binding,[],C);
test('5 to 3 days with 12h16 to 11h29 airtime selects diamond decline rather than a broadcasting obstacle',()=>{
 const b=build(report());assert.equal(b.primary.key,'diamond-decline');assert.ok(!b.topicCandidates.some(c=>['activity-drop','sparse'].includes(c.key)));
 assert.equal(b.overallContext.activityComparison.fewerDaysWithPreservedDuration,true);
 assert.deepEqual(b.requiredFindingIds,['context:1:diamond-decline']);
 assert.match(b.primary.meaning,/yardım/);
});
test('3 to 1 days with increased airtime does not fall through to a sparse obstacle question',()=>{
 const b=build(report({days:[3,1],seconds:[4772,9763],diamonds:[12,229]}));
 assert.ok(!b.topicCandidates.some(c=>['activity-drop','sparse'].includes(c.key)));assert.notEqual(b.responseMode,'check_in');
});
test('Large airtime reductions remain problems even if the number of broadcast days stays the same',()=>{
 for(const days of [[7,3],[5,5]]){
  const b=build(report({days,seconds:[115461,9613],diamonds:[252,10]}));assert.equal(b.primary.key,'activity-drop');assert.ok(b.requiredFindingIds.includes('context:1:diamond-decline'));
 }
});
test('A missing duration is not evidence that airtime was preserved',()=>{
 const r=report();r.performance[0].rows[13]['CANLI Yayın süresi']='-';
 const ctx=build(r).overallContext.activityComparison;assert.equal(ctx.durationChangeRatio,null);assert.equal(ctx.durationPreserved,false);
});
test('Diamond support can stand alone without forcing an unrelated strong watch example',()=>{
 const r=report();r.sessions.rows=[18,19].map((d,i)=>({'Başlangıç zamanı':d+'.09.2026 12:00:00','CANLI Yayın süresi':'1s','İzleyiciler':'100','İzleyici başına ort. izleme süresi':i?'3dk':'1dk','CANLI Yayın türü':'Normal',Elmaslar:'0'}));
 const b=build(r);assert.ok(b.topicCandidates.some(c=>c.key==='standout-live'));assert.deepEqual(b.requiredFindingIds,['context:1:diamond-decline']);
 const pack=P.create([r],H.empty(),C,'',{id:'context'}),rules=pack.manifest.messageRules['context:1'];
 const row={...pack.manifest.records[0],message:'Merhaba, iki dönemde benzer süre yayında kalmışsın ama elmas kazanımın 247’den 6’ya düşmüş. Bu konuda yardım edebileceğim bir şey olursa söylemekten çekinme.',recommendations:'[BS-H02] Kazanımdaki düşüşü belirtip destek sunma',reviewNote:JSON.stringify({bulgular:rules.requiredFindingIds,dayanaklar:rules.requiredEvidenceIds,not:'Süre benzer; bağımsız izleme kıyası eklenmedi.'})};
 assert.deepEqual(P.validateRows(pack.manifest,[row]).errors,[]);
});
test('Reversed inactivity question is rejected while a return-to-broadcast question passes',()=>{
 const r=report({days:[1,0],seconds:[3600,0],diamonds:[0,0]});
 const pack=P.create([r],H.empty(),C,'',{id:'context'}),rules=pack.manifest.messageRules['context:1'];
 const row={...pack.manifest.records[0],message:'Merhaba, 14–20 Eylül arasında yayın görünmüyor. Yayına ara vermeni zorlaştıran bir durum var mı?',recommendations:'[BS-D01] Yayına dönüşü zorlaştıran durumu sorma',reviewNote:JSON.stringify({bulgular:rules.requiredFindingIds,dayanaklar:rules.requiredEvidenceIds,not:'Son dönemde yayın yok.'})};
 assert.ok(P.validateRows(pack.manifest,[row]).errors.some(e=>e.includes('ters anlam')));
 row.message=row.message.replace('Yayına ara vermeni','Yeniden yayın açmanı');assert.deepEqual(P.validateRows(pack.manifest,[row]).errors,[]);
});
test('Hourly diamond decline stays required while a strong watch example is optional for manual editing',()=>{
 const r=report({days:[7,6],seconds:[73776,113334],diamonds:[318,233]});
 r.sessions.rows=[19,20].map((day,i)=>({'Başlangıç zamanı':day+'.09.2026 12:00:00','CANLI Yayın süresi':'1s','İzleyiciler':'100','İzleyici başına ort. izleme süresi':i?'81sn':'21sn','CANLI Yayın türü':'Normal',Elmaslar:'0'}));
 const b=build(r);assert.equal(b.primary.key,'diamond-yield-decline');assert.deepEqual(b.requiredFindingIds,['context:1:diamond-yield-decline']);
 const pack=P.create([r],H.empty(),C,'',{id:'context'}),rules=pack.manifest.messageRules['context:1'];
 const row={...pack.manifest.records[0],message:'Merhaba, yayın süren yaklaşık 20 saatten 31 saate çıkmış ama elmas kazanımın 318’den 233’e düşmüş. Bu konuda yardım edebileceğim bir şey olursa bana yazabilirsin.',recommendations:'[BS-H02] Kazanımdaki değişimi süreyle birlikte değerlendirme',reviewNote:JSON.stringify({bulgular:rules.requiredFindingIds,dayanaklar:rules.requiredEvidenceIds,not:'Yakın toplam elmas farkı tek başına büyük sayılmadı; yayın süresine göre düşüş ele alındı.'})};
 const checked=P.validateRows(pack.manifest,[row]);assert.deepEqual(checked.errors,[]);assert.equal(checked.rows[0].message,row.message);
 const strong=b.topicCandidates.find(c=>c.key==='standout-live');
 const incomplete={...row,message:'19.09.2026 yayınında ortalama izleme 21 saniye, 20.09.2026 yayınında 81 saniye olmuş. O yayında yaptıklarını yeniden deneyebilirsin.',recommendations:'[BS-P01] Güçlü yayını yeniden deneme',reviewNote:JSON.stringify({bulgular:[strong.id],dayanaklar:strong.evidenceIds,not:'Yalnız izleme kıyası'})};
 assert.ok(P.validateRows(pack.manifest,[incomplete]).errors.some(e=>e.includes('Önemli bulgu')));
});

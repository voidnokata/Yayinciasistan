const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core/feedback-core'),I=require('../src/core/feedback-insights'),P=require('../src/core/feedback-package'),H=require('../src/core/feedback-history');
const research=require('./fixtures/pilot-research.json');

function dailyRows(values){
 return values.map((value,index)=>({Tarih:`${String(index+7).padStart(2,'0')}.09.2026`,'CANLI Yayın süresi':value.duration||'0',Elmaslar:value.diamonds||'0','Yeni takipçiler':'0'}));
}
function report({sessions=[],daily=dailyRows(Array.from({length:14},()=>({}))),now='2026-09-22T08:00:00Z'}={}){
 return {schemaVersion:1,username:'pilotuser',requestedStart:'2026-09-07',requestedEnd:'2026-09-20',collectedAt:'2026-09-21T08:00:00Z',status:'partial',warnings:[],performance:[{rows:daily}],sessions:{rows:sessions,tableComplete:true},now};
}
function session(day,{duration='30dk',watch='20sn',viewers='100',diamonds='0',type='Normal'}={}){
 return {'Başlangıç zamanı':`${day}.09.2026 12:00:00`,'CANLI Yayın süresi':duration,'İzleyici başına ort. izleme süresi':watch,'İzleyiciler':viewers,Elmaslar:diamonds,'CANLI Yayın türü':type};
}
function row(pack,message){
 const rules=pack.manifest.messageRules[pack.manifest.records[0].recordKey];
 return {...pack.manifest.records[0],message,recommendations:rules.fixedCells.recommendations,reviewNote:rules.fixedCells.reviewNote};
}

test('Weekly context preserves complete daily totals without inventing a topic or changing fixed cells',()=>{
 const daily=dailyRows(Array.from({length:14},()=>({duration:'1s',diamonds:'0'})));
 const pack=P.create([report({daily,sessions:[session(19,{watch:'10sn'}),session(20,{watch:'12sn'})]})],H.empty(),C,'',{id:'weekly'});
 const data=JSON.parse(pack.markdown.match(/```json\s*([\s\S]*?)```/)[1]);
 const writing=data.creators[0].messageBrief;
 assert.deepEqual(writing.weeklyContext,{from:'2026-09-14',to:'2026-09-20',complete:true,activeDays:7,durationSeconds:25200});
 assert.deepEqual(writing.findings.map(f=>f.key),['short-watch']);
 assert.deepEqual(JSON.parse(pack.manifest.messageRules['weekly:1'].fixedCells.reviewNote),data.creators[0].fixedCells.reviewNote);
 const message='Merhaba, 14–20 Eylül arasında yedi gün toplam yaklaşık 7 saat yayın yapmışsın. 19 Eylül ve 20 Eylül yayınlarında izleyiciler ortalama 10 ve 12 saniye kalmış. Gelenlerin daha uzun kalmasına odaklanmanı öneririm. Yardımcı olabileceğim bir şey varsa söylemekten çekinme.';
 assert.deepEqual(P.validateRows(pack.manifest,[row(pack,message)]).errors,[]);
 const partial=P.create([report({daily:daily.filter(r=>r.Tarih!=='16.09.2026'),sessions:[session(19,{watch:'10sn'}),session(20,{watch:'12sn'})]})],H.empty(),C,'',{id:'partial-week'});
 assert.equal(JSON.parse(partial.markdown.match(/```json\s*([\s\S]*?)```/)[1]).creators[0].messageBrief.weeklyContext,undefined);
});

test('Weekly context excludes check-ins, mismatched periods and duplicate selected period facts',()=>{
 const source=research.cases.find(c=>c.caseId==='P002').messageBrief;
 const brief=JSON.parse(JSON.stringify(source));
 brief.responseMode='focus';
 brief.overallContext.recent7={from:'2026-09-14',to:'2026-09-20',complete:true,activeDays:3,durationSeconds:10800};
 const record={recordKey:'context',username:'context',from:'2026-09-14',to:'2026-09-20'};
 assert.ok(P.writerProjection(brief,record).weeklyContext);
 assert.equal(P.writerProjection(brief,{...record,from:'2026-09-17'}).weeklyContext,undefined);
 brief.responseMode='check_in';assert.equal(P.writerProjection(brief,record).weeklyContext,undefined);
 const diamond=research.cases.find(c=>c.caseId==='P006').messageBrief;
 assert.equal(P.writerProjection(diamond,record).weeklyContext,undefined);
});

test('Selected pattern dates beyond the two examples remain valid evidence dates',()=>{
 const pack=P.create([report({sessions:[session(15),session(17),session(19)]})],H.empty(),C,'',{id:'pattern-dates'});
 const message='Merhaba, 15, 17 ve 19 Eylül yayın günlerinde tek bir yayın bir saate ulaşmamış. Her yayın gününde en az bir yayını bir saate tamamlamayı hedefleyelim.';
 assert.deepEqual(P.validateRows(pack.manifest,[row(pack,message)]).errors,[]);
 const foreign=message.replace('15, 17','16, 17');
 assert.ok(P.validateRows(pack.manifest,[row(pack,foreign)]).errors.some(e=>e.includes('tarih')));
});

test('Pilot writer MD is selected-only while full diagnostics remain internal',()=>{
 const r=report({sessions:[session(19),session(20)]}),pack=P.create([r],H.empty(),C,'',{id:'pilot',now:'2026-09-22T08:00:00Z'});
 const data=JSON.parse(pack.markdown.match(/```json\s*([\s\S]*?)```/)[1]),brief=data.creators[0].messageBrief;
 assert.equal(brief.version,3);assert.ok(brief.findings.length>=1);assert.ok(brief.facts.length>=1);
 assert.doesNotMatch(JSON.stringify(brief),/topicCandidates|meaning|actions|primary|support/);
 assert.equal(pack.manifest.diagnostics['pilot:1'].topicCandidates.length>=brief.findings.length,true);
 assert.match(JSON.stringify(pack.manifest.diagnostics['pilot:1']),/meaning/);
 assert.equal(brief.fixedCells,undefined);
 assert.ok(data.creators[0].fixedCells.recommendations.startsWith('[BS-I05]'));
});

test('Fixed cells preserve metadata bindings while message edits stay exact',()=>{
 const r=report({sessions:[session(19,{watch:'10sn'}),session(20,{watch:'10sn'})]}),pack=P.create([r],H.empty(),C,'',{id:'exact'});
 const message=' Merhaba, 19.09.2026 ve 20.09.2026 yayınlarında ortalama izleme 10 saniye kalmış. Gelenlerin daha uzun kalmasına odaklanmanı öneririm. ';
 const checked=P.validateRows(pack.manifest,[row(pack,message)]);
 assert.deepEqual(checked.errors,[]);assert.equal(checked.rows[0].message,message);
 const cells=P.fields.map(field=>field==='message'?message:row(pack,message)[field]);
 assert.equal(P.objectsFromRows([P.headers,cells])[0].message,message);
 const tampered={...row(pack,message),reviewNote:JSON.stringify({bulgular:[],dayanaklar:[],not:'değiştirildi'})};
 assert.ok(P.validateRows(pack.manifest,[tampered]).errors.some(error=>error.includes('Önemli bulgu')));
});

test('Natural Turkish dates resolve to selected evidence and foreign dates remain rejected',()=>{
 const r=report({sessions:[session(13,{duration:'1s',viewers:'100'}),session(19,{duration:'1s',viewers:'250'})]}),pack=P.create([r],H.empty(),C,'',{id:'dates',now:'2026-09-22T08:00:00Z'}),rules=pack.manifest.messageRules['dates:1'];
 assert.equal(rules.primaryKey,'standout-live');
 const natural=row(pack,"Merhaba, 19 Eylül'deki yayına 250 kişi gelmiş; benzer 13 Eylül yayınında 100 kişi vardı. 19 Eylül'de iyi gittiğini düşündüğün bir şeyi sonraki benzer yayında tekrar deneyebilirsin.");
 assert.deepEqual(P.validateRows(pack.manifest,[natural]).errors,[]);
 const foreign=row(pack,natural.message.replaceAll('19 Eylül','18 Eylül'));
 assert.ok(P.validateRows(pack.manifest,[foreign]).errors.some(error=>error.includes('tarih')));
});

test('v3 packages require absolute natural dates while old manifests remain compatible',()=>{
 const daily=dailyRows(Array.from({length:14},(_,i)=>({duration:i<7?'2s':'1s',diamonds:'0'})));
 const fresh=P.create([report({daily})],H.empty(),C,'',{id:'fresh',now:'2026-09-22T08:00:00Z'});
 const absolute=row(fresh,'Merhaba, 7–13 Eylül arasındaki toplam süreyi bu dönemle birlikte değerlendirdim. Yayın açmanı zorlaştıran bir durum var mı?');
 assert.deepEqual(P.validateRows(fresh.manifest,[absolute]).errors,[]);
 const relative=row(fresh,'Merhaba, geçen hafta toplam yayın süren yaklaşık 7 saat olmuş. Yayın açmanı zorlaştıran bir durum var mı?');
 assert.ok(P.validateRows(fresh.manifest,[relative]).errors.some(error=>error.includes('v3 paketlerde')));
 const stale=P.create([report({daily})],H.empty(),C,'',{id:'stale',now:'2026-10-01T08:00:00Z'});
 assert.deepEqual(P.validateRows(stale.manifest,[row(stale,absolute.message)]).errors,[]);
 const old={...fresh.manifest,qualityVersion:2,messageRules:{...fresh.manifest.messageRules,'fresh:1':{...fresh.manifest.messageRules['fresh:1'],qualityVersion:2}}};
 assert.deepEqual(P.validateRows(old,[row(fresh,relative.message)]).errors,[]);
 const history=H.empty();history.creators['username:pilotuser']={sent:[{sentAt:'2026-09-21T10:00:00Z',text:'Önceki gönderim',recommendationIds:['BS-D02']}]};
 const sent=P.create([report({daily})],history,C,'',{id:'sent'});
 assert.equal(sent.manifest.messageRules['sent:1'].firstFeedback,false);
 assert.ok(P.validateRows(sent.manifest,[row(sent,relative.message)]).errors.some(error=>error.includes('v3 paketlerde')));
 assert.ok(P.validateRows(fresh.manifest,[row(fresh,'Merhaba, daha önce konuştuğumuz konu hâlâ önemli. Yayın açmanı zorlaştıran bir durum var mı?')]).errors.some(error=>error.includes('önceki konuşmaya')));
});

test('compact evidence retains factual essentials for every evidence kind across all research cases',()=>{
 const expected={
  daily_period:['from','to','calendarDays','timezone','complete','missingDates','duplicateDates','beforeJoining','activeDates','lastActiveDate','observedActiveDays','activeDays','durationSeconds','diamonds','newFollowers','diamondsPerHour','display'],
  session_pattern:['from','to','thresholdSeconds','belowThresholdCount','measuredSessionCount','belowThresholdShare','scope','languageScope','observations','observedShortDays','observedActiveDays','minimumSeconds','days','timezone','display'],
  single_live:['factId','start','displayedDate','durationSeconds','meets60Minutes','secondsTo60Minutes','diamonds','viewers','averageWatchSeconds','type','newFollowers','commenters','gifters','impressions','display'],
  daily_total:['factId','date','timezone','durationSeconds','diamonds','newFollowers','display'],
  session_comparison:['metric','betterFactId','otherFactId','betterValue','otherValue','ratio','betterDate','otherDate','display']
 };
 for(const item of research.cases){
  for(const source of item.messageBrief.evidence){
   const compact=P.compactEvidence(source);
   for(const key of expected[source.kind]||[])if(source[key]!==undefined)assert.deepEqual(compact[key],source[key],`${item.caseId} ${source.id} ${key}`);
  }
 }
 const p048=research.cases.find(item=>item.caseId==='P048').messageBrief.evidence.find(e=>e.id==='P048:1:short-live-frequency');
 const short=P.compactEvidence(p048);
 assert.equal(short.observedShortDays,3);assert.equal(short.observedActiveDays,3);assert.equal(short.minimumSeconds,3600);assert.equal(short.days.length,3);
});

test('all selectable action codes have compact neutral guidance',()=>{
 for(const code of Object.keys(I.actions)){
  assert.ok(P.moveCatalog[code],code);
  assert.ok(P.moveCatalog[code].label&&P.moveCatalog[code].guidance,code);
 }
});

test('Topic-specific writer facts exclude unrelated metrics without changing diagnostic evidence',()=>{
 const original=JSON.stringify(research);
 const project=id=>{const c=research.cases.find(c=>c.caseId===id);return P.writerProjection(c.messageBrief,{recordKey:id,username:id});};
 const effort=project('P021').facts[0];
 assert.equal(effort.activeDays,6);assert.equal(effort.durationSeconds,21600);
 assert.equal(effort.diamonds,undefined);assert.equal(effort.display,undefined);
 const watch=project('P002').facts;
 for(const e of watch){assert.equal(e.diamonds,undefined);assert.equal(e.viewers,undefined);assert.equal(e.observations,undefined);}
 const strong=project('P011').facts;
 assert.deepEqual(strong.filter(e=>e.kind==='single_live').map(e=>e.viewers),[186,70]);
 for(const e of strong){assert.equal(e.durationSeconds,undefined);assert.equal(e.averageWatchSeconds,undefined);assert.equal(e.diamonds,undefined);}
 assert.equal(JSON.stringify(research),original);
});

test('P048 fixed cells keep same-day duration semantics without quoted legacy wording',()=>{
 const r=report({sessions:[session(14),session(17),session(19)]}),pack=P.create([r],H.empty(),C,'',{id:'p048'});
 const note=JSON.parse(pack.manifest.messageRules['p048:1'].fixedCells.reviewNote);
 assert.match(note.not,/aynı yayın günündeki bir saat koşulunu/);
 assert.doesNotMatch(note.not,/o gün başka bir yayında bir saat dolmadıysa/);
 const source=research.cases.find(item=>item.caseId==='P048').messageBrief;
 const projected=P.writerProjection(source,{recordKey:'P048',username:source.username});
 assert.doesNotMatch(JSON.stringify(projected),/o gün başka bir yayında bir saat dolmadıysa/);
});

test('BS-S01 accepts future one-per-day wording and numeric 1, rejects past-only and every-live wording',()=>{
 const r=report({sessions:[session(14),session(17),session(19)]}),pack=P.create([r],H.empty(),C,'',{id:'hours'}),rules=pack.manifest.messageRules['hours:1'];
 assert.equal(rules.primaryKey,'short-lives');
 const natural=row(pack,'Merhaba, 14 Eylül, 17 Eylül ve 19 Eylül’de gördüğüm yayın günlerinde tek bir yayın bir saate ulaşmamış. Her yayın gününde en az bir yayını 1 saate tamamlamayı hedefleyelim.');
 assert.deepEqual(P.validateRows(pack.manifest,[natural]).errors,[]);
 const conditional=row(pack,'Merhaba, 14 Eylül, 17 Eylül ve 19 Eylül’de sonraki yayın günlerinde o gün başka bir yayında 1 saate tamamlamadıysan tek yayında bir saate ulaşmayı deneyelim.');
 assert.deepEqual(P.validateRows(pack.manifest,[conditional]).errors,[]);
 const pastOnly=row(pack,'Merhaba, tek bir yayın bir saate ulaşmadı.');
 assert.ok(P.validateRows(pack.manifest,[pastOnly]).errors.some(error=>error.includes('aynı yayın günündeki koşulu')));
 const wrong=row(pack,'Merhaba, 14 Eylül, 17 Eylül ve 19 Eylül’de her yayın bir saat sürmeli.');
 assert.ok(P.validateRows(pack.manifest,[wrong]).errors.some(error=>error.includes('aynı yayın günündeki koşulu')));
});

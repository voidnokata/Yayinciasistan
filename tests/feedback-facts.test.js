const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core/feedback-core'),P=require('../src/core/feedback-package'),H=require('../src/core/feedback-history');
function report(){return {schemaVersion:1,username:'creator',requestedStart:'2026-09-01',requestedEnd:'2026-09-15',collectedAt:'2026-09-16T13:00:00Z',warnings:[],performance:[{rows:Array.from({length:14},(_,i)=>({Tarih:`${String(i+2).padStart(2,'0')}.09.2026(UTC+00:00)`,'CANLI Yayın süresi':i<7?'2s':'1s',Elmaslar:i<7?'100':'25','Yeni takipçiler':'1'}))}],sessions:{rows:[]}};}
test('Equal complete weeks calculate days, duration, diamonds and hourly yield separately',()=>{
 const f=C.feedbackFacts(report());assert.equal(f.previous7.activeDays,7);assert.equal(f.recent7.durationSeconds,25200);assert.equal(f.previous7.diamonds,700);assert.equal(f.recent7.diamonds,175);
 assert.equal(f.comparison.metrics.diamonds.relativeChange,-.75);assert.equal(f.comparison.metrics.durationSeconds.relativeChange,-.5);assert.equal(f.comparison.metrics.diamondsPerHour.relativeChange,-.5);
});
test('Missing, duplicate and malformed values never become zero; new joins prevent comparison',()=>{
 let r=report();r.performance[0].rows.pop();let f=C.feedbackFacts(r);assert.equal(f.recent7.diamonds,null);assert.equal(f.comparison.comparable,false);
 r=report();r.performance[0].rows.push(r.performance[0].rows[0]);f=C.feedbackFacts(r);assert.equal(f.previous7.diamonds,null);assert.equal(f.previous7.duplicateDates.length,1);
 r=report();r.performance[0].rows[0].Elmaslar='-';f=C.feedbackFacts(r);assert.equal(f.comparison.metrics.diamonds.delta,null);assert.equal(f.previous7.durationSeconds,50400);
 r=report();r.requestedStart='2026-09-10';assert.equal(C.feedbackFacts(r).comparison.comparable,false);
 r=report();r.performance[0].rows.forEach(x=>x.Elmaslar='0');assert.equal(C.feedbackFacts(r).comparison.metrics.diamonds.relativeChange,null);
});
test('Daily total cannot become longest session; 60 minute boundary and same-day suppression',()=>{
 const r=report();r.sessions.rows=['9dk 15sn','22dk 10sn','18dk 13sn','1dk 7sn'].map((d,i)=>({'Başlangıç zamanı':`04.09.2026 1${i}:00:00`,'CANLI Yayın süresi':d}));
 r.sessions.rows.push({'Başlangıç zamanı':'14.09.2026 12:00:00','CANLI Yayın süresi':'59dk 56sn'});
 let f=C.feedbackFacts(r);assert.equal(f.sessionDays[0].observedTotalSeconds,3045);assert.equal(f.sessionDays[0].longestSessionSeconds,1330);assert.equal(f.sessions.at(-1).secondsTo60Minutes,4);assert.equal(f.sessionDays[1].near60MinuteSessionIds.length,1);
 r.sessions.rows.push({'Başlangıç zamanı':'14.09.2026 15:00:00','CANLI Yayın süresi':'1s'});f=C.feedbackFacts(r);assert.equal(f.sessionDays[1].hasObserved60MinuteSession,true);assert.equal(f.sessionDays[1].near60MinuteSessionIds.length,0);assert.equal(f.platformValidDays,null);
});
test('Unknown session dates/durations and outside-window records stay distinct',()=>{
 const r=report();r.sessions.rows=[{'Başlangıç zamanı':'01.09.2026','CANLI Yayın süresi':'2s'},{'Başlangıç zamanı':'14.09.2026','CANLI Yayın süresi':'?'},{'Başlangıç zamanı':'bad','CANLI Yayın süresi':'1s'}];
 const f=C.feedbackFacts(r);assert.equal(f.sessions.length,1);assert.equal(f.invalidSessionDates,1);assert.equal(f.sessionDays[0].longestSessionSeconds,null);assert.equal(f.sessionDays[0].observedTotalSeconds,null);
});
test('MD calculations bind to each creator and original record without changing Excel contract',()=>{
 const a=report(),b={...report(),username:'another'};b.performance[0].rows[0].Elmaslar='999';
 const pack=P.create([a,b],H.empty(),C,'',{id:'test'}),data=JSON.parse(pack.markdown.match(/```json\s*([\s\S]*?)```/)[1]);
 assert.equal(pack.manifest.diagnostics['test:1'].evidence.find(e=>e.id.endsWith(':previous7')).diamonds,700);assert.equal(pack.manifest.diagnostics['test:2'].evidence.find(e=>e.id.endsWith(':previous7')).diamonds,1599);
 for(const c of data.creators){assert.equal(c.messageBrief.recordKey,c.record.recordKey);assert.equal(c.messageBrief.username,c.record.username);}
 assert.equal(P.headers.length,7);
});

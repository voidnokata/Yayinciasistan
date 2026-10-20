const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core/feedback-core'),I=require('../src/core/feedback-insights'),P=require('../src/core/feedback-package');
const binding={recordKey:'integrity:1',creatorKey:'username:creator',username:'creator'};
const live=(day,watch='15sn',time='12:00:00')=>({'Başlangıç zamanı':`${day}.09.2026 ${time}`,'CANLI Yayın süresi':'30dk','İzleyici başına ort. izleme süresi':watch,'İzleyiciler':'100','CANLI Yayın türü':'Normal'});
const report=rows=>({username:'creator',requestedStart:'2026-09-07',requestedEnd:'2026-09-20',performance:[],sessions:{rows,tableComplete:true}});
const brief=r=>I.build(r,binding,[],C);

test('Repeating the same source live cannot satisfy the two-live watch threshold',()=>{
 const row=live(20),r=report([row,Object.fromEntries(Object.entries(row).reverse())]);
 const original=JSON.stringify(r),facts=C.feedbackFacts(r);
 assert.equal(facts.sessions.length,1);
 assert.equal(facts.duplicateSessionCount,1);
 assert.equal(brief(r).topicCandidates.some(c=>c.key==='short-watch'),false);
 assert.equal(JSON.stringify(r),original);
});

test('Duplicate low-watch rows cannot inflate the share or frequency of a real sample',()=>{
 const low=live(20),r=report([low,{...low},live(19,'40sn'),live(18,'40sn')]);
 assert.equal(brief(r).topicCandidates.some(c=>c.key==='short-watch'),false);
 r.sessions.rows.push(live(20,'15sn','18:00:00'));
 const b=brief(r),pattern=b.evidence.find(e=>e.id.endsWith(':watch-frequency'));
 assert.equal(pattern.measuredSessionCount,4);
 assert.equal(pattern.belowThresholdCount,2);
 assert.equal(pattern.languageScope,'frequent_pattern');
});

test('An undated live may contain the missing full hour; positive watch observations remain usable',()=>{
 const r=report([live(18),live(19),live(20),{'Başlangıç zamanı':'unreadable','CANLI Yayın süresi':'1s'}]);
 const b=brief(r);
 assert.equal(b.topicCandidates.some(c=>c.key==='short-lives'),false);
 assert.equal(b.primary.key,'short-watch');
});

test('Undated activity cannot be reconciled with an all-zero daily table as confirmed inactivity',()=>{
 const r=report([{'Başlangıç zamanı':'unreadable','CANLI Yayın süresi':'1s'}]);
 r.performance=[{rows:Array.from({length:14},(_,i)=>({Tarih:String(i+7).padStart(2,'0')+'.09.2026','CANLI Yayın süresi':'0',Elmaslar:'0'}))}];
 assert.notEqual(brief(r).primary?.key,'inactive');
 assert.match(brief(r).noMessageReason,/Tarihi çözülemeyen/);
 r.sessions.rows=[];
 assert.equal(brief(r).primary.key,'inactive');
});

test('The raw duration rule does not require every live to reach an hour',()=>{
 const summary=C.minimumSessionDuration([live(20)]);
 assert.doesNotMatch(summary.rule,/Her oturum en az/i);
 assert.match(summary.rule,/aynı gün en az bir/i);
});

test('The public Excel import API reads cells without rewriting the user message',async()=>{
 const previous=globalThis.BTGSpreadsheetReader;
 const cells=['integrity:1','creator','2026-09-14','2026-09-20',' Selamlar,\nmesajım. ','[BS-K01] Takdir','{}'];
 const bytes=new Uint8Array([1,2,3]).buffer;
 try{
  globalThis.BTGSpreadsheetReader={readXlsxRows:async(buffer,mode,options)=>{
   assert.equal(buffer,bytes);assert.equal(mode,false);assert.deepEqual(options,{strictFeedback:true});
   return [P.headers,cells];
  }};
  const rows=await P.readExcel({name:'feedback.xlsx',size:3,arrayBuffer:async()=>bytes});
  assert.equal(rows[0].message,cells[4]);assert.equal(rows[0].recordKey,'integrity:1');
  await assert.rejects(P.readExcel({name:'feedback.csv',size:3}),/xlsx/);
 }finally{if(previous===undefined)delete globalThis.BTGSpreadsheetReader;else globalThis.BTGSpreadsheetReader=previous;}
});

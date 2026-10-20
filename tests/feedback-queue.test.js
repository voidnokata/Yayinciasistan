const test=require('node:test');const assert=require('node:assert/strict');const Q=require('../src/background/feedback-queue');const P=require('../src/core/feedback-package');
function setup(send,extra={}){
 const row={recordKey:'r',username:'kai',from:'2026-09-08',to:'2026-09-14',message:'hello',recommendations:'follow'};
 const record={recordKey:'r',creatorKey:'username:kai',username:'kai',from:row.from,to:row.to,sourceSnapshotId:'s'};
 const data={[Q.PACKAGES]:{packages:{p:{id:'p',records:[record]}}},[Q.HISTORY]:{version:1,creators:{'username:kai':{sent:[]}}},...extra};
 const storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])])),set:async obj=>Object.assign(data,structuredClone(obj))};
 const validateRows=P.validateRows;
 const make=()=>Q.create({storage,validateRows,send,now:()=> '2026-09-15T12:00:00Z'});
 return {data,row,make,storage};
}
async function settle(q){for(let i=0;i<100;i++){if(!q.isActive())return (await q.status()).queue;await new Promise(r=>setImmediate(r));}throw Error('queue did not settle');}
test('Istanbul week boundary uses Monday local date',()=>{assert.equal(Q.week('2026-09-13T20:59:00Z'),'2026-09-07');assert.equal(Q.week('2026-09-13T21:00:00Z'),'2026-09-14');});
test('Confirmed send saves advice metadata, failed send does not',async()=>{
 for(const ok of [true,false]){const s=setup(async()=>({ok,verifiedInConversation:ok}));s.row.recommendations='[BS-I02] Context';s.data[Q.PACKAGES].packages.p.adviceCatalogVersion=1;const q=s.make();await q.start({packageId:'p',rows:[s.row]});await settle(q);const sent=s.data[Q.HISTORY].creators['username:kai'].sent;assert.equal(sent.length,ok?1:0);if(ok){assert.deepEqual(sent[0].recommendationIds,['BS-I02']);assert.deepEqual(sent[0].recommendationFamilies,['kısa-bağlam']);}}
});
test('persists in-flight before send and records only confirmed exact delivery',async()=>{
 let s;s=setup(async()=>{assert.equal(s.data[Q.KEY].rows[0].status,'in_flight');return {ok:true,verifiedInConversation:true};});
 const q=s.make();await q.start({packageId:'p',rows:[s.row]});assert.equal((await settle(q)).rows[0].status,'sent');
 assert.equal(s.data[Q.HISTORY].creators['username:kai'].sent[0].text,'hello');
});
test('legacy Uygun değil feedback rows return to pending',async()=>{
 const s=setup(async()=>({ok:true,verifiedInConversation:true}));
 const record=s.data[Q.PACKAGES].packages.p.records[0];
 s.data[Q.KEY]={packageId:'p',status:'completed',rows:[{...s.row,...record,status:'unavailable',error:'Uygun değil'}]};
 const q=s.make();await q.start({packageId:'p',rows:[s.row]});
 assert.equal((await settle(q)).rows[0].status,'sent');
 assert.equal(s.data[Q.HISTORY].creators['username:kai'].sent.length,1);
});
test('unavailable is not success; ambiguous delivery blocks resume',async()=>{
 for(const result of [{ok:true,unavailableSkipped:true},{ok:true},{ok:true,verifiedInConversation:true,alreadySent:true}]){
 let calls=0;const s=setup(async()=>{calls++;return result;});const q=s.make();await q.start({packageId:'p',rows:[s.row]});const state=await settle(q);
 assert.equal(s.data[Q.HISTORY].creators['username:kai'].sent.length,0);
 if(state.status==='needs_review')await assert.rejects(q.start({packageId:'p',rows:[s.row]}));assert.equal(calls,1);
 }
});
test('recovery never retries an interrupted effect and requires explicit dismissal',async()=>{
 const s=setup(async()=>{throw Error('should not send');},{[Q.KEY]:{packageId:'p',status:'running',rows:[{recordKey:'r',status:'in_flight'}]}});
 const q=s.make();assert.equal((await q.status()).queue.status,'needs_review');await assert.rejects(q.start({packageId:'p',rows:[s.row]}));
 assert.equal((await q.resolve({recordKey:'r',action:'dismiss'})).queue.rows[0].status,'dismissed');
});
test('weekly history skips and forged recipients fail before effect',async()=>{
 let calls=0;const s=setup(async()=>{calls++;});s.data[Q.HISTORY].creators['username:kai'].sent=[{sentAt:'2026-09-14T12:00:00Z'}];const q=s.make();
 for(const bad of [{username:'wrong'},{recordKey:'foreign'},{from:'2026-09-01'},{to:'2026-09-15'}])await assert.rejects(q.start({packageId:'p',rows:[{...s.row,...bad}]}));
 await q.start({packageId:'p',rows:[s.row]});assert.equal((await settle(q)).rows[0].status,'skipped_week');assert.equal(calls,0);
});
test('STOP cannot rewrite a result while confirmed send persistence is delayed',async()=>{
 const s=setup(async()=>({ok:true,verifiedInConversation:true}));
 const originalSet=s.storage.set;let release,committing;
 const entered=new Promise(r=>{committing=r;});
 s.storage.set=async obj=>{if(obj[Q.HISTORY]){committing();await new Promise(r=>{release=r;});}return originalSet(obj);};
 const q=s.make();await q.start({packageId:'p',rows:[s.row]});await entered;
 assert.equal((await q.stop()).queue.status,'stopping');release();
 assert.equal((await settle(q)).rows[0].status,'sent');
 assert.equal(s.data[Q.HISTORY].creators['username:kai'].sent.length,1);
 assert.equal((await s.make().status()).queue.rows[0].status,'sent');
});
test('committed weekly history protects against a stale pending queue after recovery',async()=>{
 let calls=0;const s=setup(async()=>{calls++;});s.data[Q.HISTORY].creators['username:kai'].sent=[{sentAt:'2026-09-15T11:00:00Z'}];
 s.data[Q.KEY]={packageId:'p',status:'running',rows:[{...s.row,creatorKey:'username:kai',status:'pending'}]};
 const q=s.make();await q.start({packageId:'p',rows:[s.row]});assert.equal((await settle(q)).rows[0].status,'skipped_week');assert.equal(calls,0);
});
test('same current username under another creator key skips without merging history',async()=>{
 let calls=0;const s=setup(async()=>{calls++;});
 s.data[Q.HISTORY].creators['id:1234567890']={username:'KaI',sent:[{sentAt:'2026-09-15T11:00:00Z'}]};
 const q=s.make();await q.start({packageId:'p',rows:[s.row]});assert.equal((await settle(q)).rows[0].status,'skipped_week');assert.equal(calls,0);
 assert.equal(s.data[Q.HISTORY].creators['username:kai'].sent.length,0);
});
test('historical alias alone does not trigger weekly skip',async()=>{
 let calls=0;const s=setup(async()=>{calls++;return {ok:true,verifiedInConversation:true};});
 s.data[Q.HISTORY].creators['id:1234567890']={username:'other',aliases:['kai'],sent:[{sentAt:'2026-09-15T11:00:00Z'}]};
 const q=s.make();await q.start({packageId:'p',rows:[s.row]});assert.equal((await settle(q)).rows[0].status,'sent');assert.equal(calls,1);
});
test('normal automation excludes feedback and stop waits for in-flight confirmation',async()=>{
 const blocked=setup(async()=>{}, {runtime:{running:true}});await assert.rejects(blocked.make().start({packageId:'p',rows:[blocked.row]}));
 let finish;const s=setup(()=>new Promise(resolve=>{finish=resolve;}));const q=s.make();await q.start({packageId:'p',rows:[s.row]});
 while(!finish)await new Promise(r=>setImmediate(r));await q.stop();assert.equal(q.isActive(),true);finish({ok:true,verifiedInConversation:true});assert.equal((await settle(q)).rows[0].status,'sent');
});

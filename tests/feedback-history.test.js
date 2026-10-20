const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('../src/core/feedback-history'),C=require('../src/core/feedback-core');
const report=(extra={})=>({schemaVersion:1,username:'kai35.5',collectedAt:'2026-09-15T13:28:47.682Z',requestedStart:'2026-08-11',requestedEnd:'2026-09-14',status:H.COMPLETE,warnings:[],performance:[{rows:[{Tarih:'14.09.2026','CANLI Yayın süresi':'1h 0m 0s','Elmaslar':'4','Yeni takipçiler':'2'}]}],sessions:{rows:[]},...extra});
const init=()=>H.register(H.empty(),report(),C);
const draft={text:'Merhaba Kai, yayın düzenin aynı devam ediyor.',from:'2026-09-08',to:'2026-09-14',recommendations:'Takip hatırlatması'};
test('Stable identity survives renamed username; username fallback never auto merges',()=>{
 let s=H.register(H.empty(),report({creatorId:'1234567890123456789'}),C).state;
 s=H.register(s,report({creatorId:'1234567890123456789',username:'new_name'}),C).state;
 assert.equal(Object.keys(s.creators).length,1);assert.equal(s.creators['id:1234567890123456789'].username,'new_name');
 s=H.register(s,report(),C).state;assert.equal(Object.keys(s.creators).length,2);
 assert.throws(()=>H.identity(report({creatorId:1234567890123456789})),/metin/);
});
test('Re-import is idempotent, preserves partial warnings and compact provenance',()=>{
 const r=report({status:'partial',warnings:['Bölge son aralık okunamadı']});let {state,key}=H.register(H.empty(),r,C);state=H.register(state,r,C).state;
 assert.equal(state.creators[key].snapshots.length,1);assert.equal(H.matches(state.creators[key],'incomplete'),true);
 assert.deepEqual(state.creators[key].snapshots[0].warnings,r.warnings);assert.equal(state.creators[key].snapshots[0].source.dayTimeZone,'UTC');
 assert.throws(()=>H.register(state,{username:'kai35.5'},C),/desteklenen/);
});
test('Draft saved does not become sent; sent snapshot and suggestions immutable after next edit',()=>{
 let {state,key}=init();state=H.saveDraft(state,key,draft,'2026-09-15T15:00:00Z');assert.equal(state.creators[key].sent.length,0);assert.equal(H.matches(state.creators[key],'draft'),true);
 const sentState=H.markSent(state,key,'2026-09-15T15:01:00Z');assert.equal(sentState.creators[key].draft,null);assert.equal(H.matches(sentState.creators[key],'unsent'),false);
 const edited=H.saveDraft(sentState,key,{...draft,text:'İkinci mesaj'},'2026-09-15T16:00:00Z');assert.equal(edited.creators[key].sent[0].text,draft.text);assert.equal(edited.creators[key].sent[0].recommendations,draft.recommendations);
 assert.equal(state.creators[key].sent.length,0);
 assert.throws(()=>H.markSent(H.saveDraft(sentState,key,draft,'2026-09-15T17:00:00Z'),key,'2026-09-15T18:00:00Z'),/zaten/);
});
test('Periods outside source coverage fail; new week is unsent even when prior week sent',()=>{
 let {state,key}=init();assert.throws(()=>H.saveDraft(state,key,{...draft,to:'2026-09-20'},'now'),/kapsam/);
 assert.throws(()=>H.saveDraft(state,key,{...draft,from:'2026-09-15'},'now'),/dönemi/);
 state=H.markSent(H.saveDraft(state,key,draft,'now'),key,'2026-09-15T15:01:00Z');
 state=H.register(state,report({requestedEnd:'2026-09-21',collectedAt:'2026-09-22T10:00:00Z'}),C).state;
 assert.equal(H.matches(state.creators[key],'unsent'),true);
});
test('Persistence survives store reload; queued updates do not lose records; write failures surface',async()=>{
 let disk={};const storage={get:async()=>structuredClone(disk),set:async next=>{disk=structuredClone(next);}};
 const store=H.createStore(storage);await Promise.all([store.mutate(s=>H.register(s,report(),C).state),store.mutate(s=>H.register(s,report({username:'novazzzy'}),C).state)]);
 assert.equal(Object.keys((await H.createStore(storage).read()).creators).length,2);
 const bad=H.createStore({get:storage.get,set:async()=>{throw Error('QUOTA_BYTES');}});await assert.rejects(()=>bad.mutate(s=>s),/QUOTA/);
});

test('Weekly status uses Istanbul send week independently of data period',()=>{
  const c={snapshots:[{from:'2026-09-01',to:'2026-09-14'}],sent:[{from:'2026-09-01',to:'2026-09-07',sentAt:'2026-09-13T21:30:00Z'}]};
  assert.equal(H.matches(c,'sent_week','2026-09-15T10:00:00Z'),true);
  assert.equal(H.matches(c,'unsent_week','2026-09-15T10:00:00Z'),false);
  assert.equal(H.matches(c,'unsent_week','2026-09-21T10:00:00Z'),true);
});

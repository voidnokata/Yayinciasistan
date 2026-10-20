const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/content/tiktok-content.js'),'utf8');
const start=source.indexOf('  async function saveCollectedOnExit()'),end=source.indexOf('  async function readTalentAssessment',start);
assert.match(source,/try \{ await runNameCollectionController\(\); \}\s*finally \{ await saveCollectedOnExit\(\); \}/);
(async()=>{
 let saves=0,fail=false;const rows=Array.from({length:39},(_,i)=>({username:'user_'+i,classId:1})),logs=[];
 const context={controller:{},chrome:{storage:{local:{get:async()=>({runtime:{collectionRows:rows,running:false}})}}},window:{BTGXlsxWriter:{downloadNameCollection:async r=>{if(fail)throw new Error('izin yok');assert.equal(r.length,39);saves++;}}},runtimePatch:async(p,l)=>logs.push(l)};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await Promise.all([context.saveCollectedOnExit(),context.saveCollectedOnExit()]);assert.equal(saves,1);
 await context.saveCollectedOnExit();assert.equal(saves,1);
 context.controller={};fail=true;await assert.rejects(()=>context.saveCollectedOnExit(),/izin yok/);assert.equal(rows.length,39);assert.match(logs.at(-1).message,/39 isim korunuyor/);
 fail=false;await context.saveCollectedOnExit();assert.equal(saves,2);
 rows.length=0;await context.saveCollectedOnExit();assert.equal(saves,2);
 console.log('Hata sonrası 39 kayıt, eşzamanlı tek çıktı, kayıt hatası sonrası tekrar ve boş liste testleri geçti.');
})().catch(e=>{console.error(e);process.exitCode=1;});

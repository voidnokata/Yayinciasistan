const test=require('node:test'),assert=require('node:assert/strict'),R=require('../src/background/feedback-roster');
const row=name=>({'İçerik üreticisi':name,'Katılma saati':'01.07.2026'});
function page(names,first,total,next=false){return {url:R.URL_BASE,headers:['İçerik üreticisi','Katılma saati'],rows:names.map(row),filters:[],paging:{total,first,hasNext:next,hasPrevious:first>1}};}
test('collects coherent pages only and preserves raw join values',async()=>{const commands=[],pages=[page(['kai'],1,2,true),page(['nova'],2,2)];const rows=await R.collect(async c=>{commands.push(c);return pages.shift();});assert.deepEqual(commands,['read','next']);assert.equal(rows.length,2);assert.equal(rows[0]['Katılma saati'],'01.07.2026');});
test('rejects filters, wrong headers, bad pagination and totals before committing',async()=>{
 const bad=[{filters:['search']},{rosterSearchActive:true},{tab:'Yeni içerik üreticiler'},{headers:['name']},{url:R.URL_BASE+'?search=kai'},{paging:{total:2,first:2,hasPrevious:true,hasNext:false}},{paging:{total:3,first:1,hasNext:false}},{paging:{total:null,first:1,hasNext:false}}];
 for(const patch of bad)await assert.rejects(R.collect(async()=>({...page(['kai'],1,1),...patch})));
 for(const second of [page(['kai'],2,2),page(['nova'],3,2),page(['nova'],2,3)]){
 const p=[page(['kai'],1,2,true),second];await assert.rejects(R.collect(async()=>p.shift()));}
});
test('owns only new inactive tab, retries missing reader and commits after full result',async()=>{
 const calls=[],removed=[];let attempts=0,commits=0;
 const tabs={create:async o=>{calls.push(o);return {id:77};},get:async()=>({status:'complete'}),remove:async id=>removed.push(id),sendMessage:async(id,m)=>{assert.equal(id,77);if(!attempts++)throw Error('Could not establish connection. Receiving end does not exist.');return {ok:true,data:page(['kai'],1,1)};}};
 const r=R.create({tabs,sleep:async()=>{},commit:async rows=>{commits++;assert.equal(rows.length,1);}});
 const response=await r.refresh(99);assert.equal(response.count,1);assert.equal(commits,1);assert.deepEqual(calls,[{url:R.URL_BASE,active:false,windowId:99}]);assert.deepEqual(removed,[77]);assert.equal(r.isActive(),false);
});
test('failed page never commits and only owned tab closes',async()=>{
 let commits=0,removed=[];const tabs={create:async()=>({id:5}),get:async()=>({status:'complete'}),remove:async id=>removed.push(id),sendMessage:async()=>({ok:false,error:'Session expired'})};
 const r=R.create({tabs,commit:async()=>{commits++;}});await assert.rejects(r.refresh(),/Session expired/);assert.equal(commits,0);assert.deepEqual(removed,[5]);
});
test('prevents simultaneous refresh, read timeout cleans up without commit',async()=>{
 let finish,commits=0,removed=[];const tabs={create:async()=>({id:5}),get:async()=>({status:'complete'}),remove:async id=>removed.push(id),sendMessage:()=>new Promise(r=>{finish=r;})};
 const r=R.create({tabs,timeoutMs:20,commit:async()=>{commits++;}});const first=r.refresh();await assert.rejects(r.refresh(),/yenileniyor/);await assert.rejects(first,/zaman aşımı/);assert.equal(commits,0);assert.deepEqual(removed,[5]);finish({ok:true,data:page(['kai'],1,1)});
});

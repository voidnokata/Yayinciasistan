const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/content/feedback-content.js'),'utf8');
test('Transient column mismatch waits for table; permanent mismatch still fails',async()=>{
 let now=0;const context={commandDeadline:Infinity,Date:{now:()=>now},pause:async()=>{now+=200;}};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  async function wait('),source.indexOf('  function grid('))+'\nthis.wait=wait;',context);
 let calls=0;assert.equal(await context.wait(()=>{if(++calls<3)throw Error('Tablo sütun sayısı değişti; veri eşleştirilmedi.');return 'ready';},1000),'ready');
 await assert.rejects(context.wait(()=>{throw Error('Tablo sütun sayısı değişti; veri eşleştirilmedi.');},600),/Tablo sütun/);
 await assert.rejects(context.wait(()=>{throw Error('Unexpected error');}),/Unexpected error/);
});
test('Changing unrelated page counters do not prevent a stable table from being read',async()=>{
 let now=0,changingTable=false;
 const context={Date:{now:()=>now},panel:()=>({get innerText(){return 'Live counter '+now;}}),all:()=>[],document:{querySelector:()=>null},label:()=>'',
 grid:()=>({headers:['Date'],rows:[changingTable?now:1]}),paging:()=>({total:1}),snapshot:()=>({ready:true}),wait:async fn=>{for(now=0;now<5000;now+=200)if(fn())return;throw Error('timeout');}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function stable('),source.indexOf('  async function next('))+'\nthis.stable=stable;',context);
 assert.equal((await context.stable()).ready,true);assert.ok(now<2000);
 changingTable=true;await assert.rejects(context.stable(),/timeout/);
});
test('Sequential waits share a command deadline and stop before the caller message timeout',async()=>{
 let now=0;const context={commandDeadline:75000,Date:{now:()=>now},pause:async()=>{now+=200;}};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  async function wait('),source.indexOf('  function grid('))+'\nthis.wait=wait;',context);
 await assert.rejects(context.wait(()=>false,45000),/zamanında hazır/);
 await assert.rejects(context.wait(()=>false,45000),/komutunun süresi aşıldı/);
 assert.equal(now,75000);assert.ok(now<90000);
});
function identityFixture({delayed=false,wrong=false,changed=false}={}){
 let heading=delayed||wrong?'other':'expected',reads=0;
 const context={URL,location:{hostname:'live-backstage.tiktok.com',href:'https://live-backstage.tiktok.com/portal/anchor/detail?username=expected'},
 document:{querySelector:()=>({innerText:heading})},wait:async fn=>{if(fn())return;if(delayed)heading='expected';if(!fn())throw Error('timeout');},
 stable:async()=>{reads++;if(changed)heading='other';return {username:heading};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function execute('),source.indexOf('  chrome.runtime.onMessage'))+'\nthis.execute=execute;',context);
 return {run:()=>context.execute({username:'expected',command:'read'}),reads:()=>reads};
}
test('Reader waits for expected creator instead of accepting stale heading',async()=>{const f=identityFixture({delayed:true});assert.equal((await f.run()).username,'expected');assert.equal(f.reads(),1);});
test('Reader rejects persistently wrong creator before reading data',async()=>{const f=identityFixture({wrong:true});await assert.rejects(f.run(),/kimliği eşleşmiyor/);assert.equal(f.reads(),0);});
test('Reader rejects creator change during table read',async()=>{const f=identityFixture({changed:true});await assert.rejects(f.run(),/kimliği eşleşmiyor/);});
function fixture(tag,atEnd=false){
 let clicked=false;
 const root={innerText:'74 içinden 1 - 10 göster'};
 const make=(label,off)=>({tag,disabled:tag==='button'&&off,getAttribute:k=>k==='aria-label'?label:k==='aria-disabled'?String(off):null,click(){clicked=true;}});
 const next=make('Next',atEnd),prev=make('Previous',true);
 const context={panel:()=>root,disabled:e=>!e||e.disabled||e.getAttribute('aria-disabled')==='true',
 all:(selector)=>[next,prev].filter(e=>selector.split(',').some(s=>s.includes('aria-label="'+e.getAttribute('aria-label')+'"')&&(s.startsWith('[role="button"]')||e.tag==='button'))),
 grid:()=>({rows:clicked?[11]:[1]}),wait:async fn=>assert.ok(fn()),stable:async()=>({advanced:clicked})};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function paging('),source.indexOf('  function snapshot('))+source.slice(source.indexOf('  async function next('),source.indexOf('  async function selectTab('))+'\nthis.api={paging,next};',context);
 return {api:context.api};
}
for(const tag of ['button','li']){
 test(tag+' sayfalama kontrolü 74 kaydın devamını bulur ve ilerler',async()=>{
 const f=fixture(tag);assert.equal(f.api.paging().total,74);assert.equal(f.api.paging().hasNext,true);assert.equal(f.api.paging().hasPrevious,false);assert.equal((await f.api.next()).advanced,true);
 });
 test(tag+' devre dışı son sayfa kontrolüne basmaz',async()=>{const f=fixture(tag,true);assert.equal(f.api.paging().hasNext,false);await assert.rejects(f.api.next(),/Sonraki sayfa yok/);});
}
for(const kind of ['th','td'])test('Liste başlıkları '+kind+' ile okunur; katılma tarihi hücresi kaymaz',()=>{
 const head=[{innerText:''},{innerText:'İçerik üreticisi'},{innerText:'Katılma saati'}];const cells=[{innerText:''},{innerText:'kai35.5\n7672803325091545109'},{innerText:'11.08.2026 19:14:00'}];
 const table={querySelectorAll:s=>s==='tbody tr'?[{querySelectorAll:()=>cells}]:s.includes('thead '+kind)?head:[],getAttribute:()=>null};
 const context={panel:()=>({}),all:()=>[table],label:e=>e.innerText};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function grid('),source.indexOf('  function paging('))+'\nthis.readGrid=grid;',context);
 const result=context.readGrid();assert.equal(result.rows[0]['İçerik üreticisi'],cells[1].innerText);assert.equal(result.rows[0]['Katılma saati'],cells[2].innerText);
});

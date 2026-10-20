const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/content/feedback-content.js'),'utf8');
function fixture({textWorks=false,neverApply=false,latest=null}={}){
 let active=null,dialog=false;const clicks=[];
 const start={placeholder:'Başlangıç tarihi',value:'01.09.2026',focus(){active=start;},click(){dialog=true;clicks.push('start');}},end={placeholder:'Bitiş tarihi',value:'15.09.2026',focus(){active=end;},click(){dialog=true;clicks.push('end');}};
 const context={panel:()=>({}),enterDates:(a,b)=>{if(!textWorks)throw Error('text unsupported');start.value=a.split('-').reverse().join('.');end.value=b.split('-').reverse().join('.');},all:selector=>selector==='input'?[start,end]:selector==='[role="dialog"]'?(dialog?[{}]:[]):selector==='h4,h6'?[{click(){dialog=false;}}]:[],wait:async fn=>{if(!fn())throw Error('not ready');},dateCell:async date=>{if(!neverApply)active.value=date.split('-').reverse().join('.');},latestSelectable:async(date,floor)=>{clicks.push('probe:'+floor);return latest;},stable:async expected=>{assert.equal(start.value,expected.start.split('-').reverse().join('.'));assert.equal(end.value,expected.end.split('-').reverse().join('.'));return {start:start.value,end:end.value};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function range('),source.indexOf('  async function execute('))+'\nthis.range=range;',context);
 return {run:(lag=0)=>context.range('2026-09-10','2026-09-16',lag),clicks};
}
test('Newest range ends on the latest selectable day and reports both ends',async()=>{
 const f=fixture({textWorks:true,latest:'2026-09-15'});const result=JSON.parse(JSON.stringify(await f.run(2)));
 assert.deepEqual(result,{start:'10.09.2026',end:'15.09.2026',requestedEnd:'2026-09-16',availableEnd:'2026-09-15'});
 assert.deepEqual(f.clicks,['end','probe:2026-09-14']);
});
test('No selectable recent day keeps the requested end and still fails honestly',async()=>{
 const f=fixture({neverApply:true,latest:null});await assert.rejects(f.run(2),/iki denemede doğrulanamadı \(2026-09-10 \/ 2026-09-16\)/);
});
test('Ranges without a lag allowance never probe the calendar',async()=>{const f=fixture({textWorks:true,latest:'2026-09-15'});const result=await f.run();assert.equal(result.end,'16.09.2026');assert.ok(!f.clicks.some(c=>c.startsWith('probe')));});
test('Each date is explicitly targeted even when calendar never advances focus automatically',async()=>{const f=fixture();assert.deepEqual(JSON.parse(JSON.stringify(await f.run())),{start:'10.09.2026',end:'16.09.2026'});assert.deepEqual(f.clicks,['start','end']);});
test('Accepted text dates are verified without navigating calendar months',async()=>{const f=fixture({textWorks:true});await f.run();assert.deepEqual(f.clicks,[]);});
test('Unapplied dates fail after text and calendar attempts instead of exporting a different interval',async()=>{const f=fixture({neverApply:true});await assert.rejects(f.run(),/iki denemede doğrulanamadı/);assert.deepEqual(f.clicks,['start']);});
test('Correct inputs cannot make an old daily table appear ready',async()=>{
 let now=0;
 const context={Date:{now:()=>now},panel:()=>({innerText:''}),all:s=>s==='input'?[{placeholder:'Başlangıç tarihi',value:'10.09.2026'},{placeholder:'Bitiş tarihi',value:'16.09.2026'}]:[],document:{querySelector:()=>null},label:()=>'',
 grid:()=>({headers:['Tarih'],rows:[{Tarih:now<1800?'15.09.2026(UTC+00:00)':'16.09.2026(UTC+00:00)'}]}),paging:()=>({total:7,hasPrevious:false}),snapshot:()=>({readyAt:now}),wait:async fn=>{for(now=0;now<6000;now+=200)if(fn())return;throw Error('timeout');}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function stable('),source.indexOf('  async function next('))+'\nthis.stable=stable;',context);
 const result=await context.stable({start:'2026-09-10',end:'2026-09-16'});assert.ok(result.readyAt>=3000);
});

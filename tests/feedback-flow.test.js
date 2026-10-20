const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=require('../src/core/feedback-core');
function fixture(options={}){
  const elements=new Map();
  function el(id){if(!elements.has(id))elements.set(id,{value:id==='scope'?'all':'',textContent:'',disabled:false});return elements.get(id);}
  const saved=new Map(),removed=[],commands=[],tabOwners=new Map(),activeCreators=new Set();let nextId=0,maxActive=0;
  const snapshot=(tab,rows,headers,total=rows.length)=>({username:'cfrkn2',tab,rows,headers,paging:{total,hasNext:false,hasPrevious:false},filters:[],management:'10.09.2026 ~ 09.09.2027(UTC+00:00)',summary:'',renderedRowCount:rows.length});
  const creator={ 'İçerik üreticisi':'cfrkn2\n7683999354734018581','Katılma saati':options.joined||'10.09.2026 23:18:58'};
  const roster=snapshot('Tüm içerik üreticiler',Array.from({length:options.creatorCount||(options.twoCreators?2:1)},(_,i)=>({...creator,'İçerik üreticisi':`cfrkn${i+2}\n${7683999354734018581n+BigInt(i)}`})),Object.keys(creator));
  const sessions=snapshot('CANLI Yayınlar',[{'Başlangıç zamanı':'14.09.2026 23:08:35'}],['Başlangıç zamanı']);
  const currentTabs=new Map();let injectedFailures=0;
  const folder={name:'Masaüstü',queryPermission:async()=> 'granted',getDirectoryHandle:async()=>({name:'BTG_test'})};
  const context={BTGFeedback:core,Blob,URL,Date,Intl,Set,Map,console,
    document:{getElementById:el},window:{addEventListener(){}},showDirectoryPicker:async()=>folder,
    setTimeout:(fn,ms)=>setTimeout(fn,ms>=90000?ms:0),clearTimeout,
    BTGOutput:{handle:async(value,key)=>{assert.equal(key,'feedback-directory');return value|| (options.restoreFolder?folder:null);},write:async(dir,name,blob)=>{if(options.diskFull&&name.endsWith('.json'))throw Error('disk full');saved.set(name,await blob.text());if(name.endsWith('.txt'))activeCreators.delete(name.slice(0,-4));}},
    chrome:{runtime:{},tabs:{query:async()=>[{id:100,windowId:1,url:'https://live-backstage.tiktok.com/portal/anchor/detail?username=cfrkn2'}],
      create:async({url})=>{const id=++nextId;const name=new URL(url).searchParams.get('username');tabOwners.set(id,name);if(name){activeCreators.add(name);maxActive=Math.max(maxActive,activeCreators.size);}return {id};},get:async()=>({status:'complete'}),remove:async id=>removed.push(id),
      sendMessage:async(id,m)=>{
        commands.push({...m,tabId:id});
        if(m.username)assert.equal(tabOwners.get(id),m.username);
        if(id===1){if(options.rosterMismatch)return {ok:true,data:{...roster,paging:{total:2,hasNext:false,hasPrevious:false}}};return {ok:true,data:roster};}
        if(options.stopAtRead){el('stop').onclick();return {ok:true,data:sessions};}
        if(options.identityError&&(!options.twoCreators||m.username==='cfrkn2'))return {ok:false,error:'Yayıncı kimliği eşleşmiyor.'};
        if(options.channelOnce&&m.command==='read'&&injectedFailures++===0)throw Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received');
        if(options.partialSessions&&m.command==='read')return {ok:true,data:{...sessions,paging:{total:2,hasNext:true,hasPrevious:false}}};
        if(options.partialSessions&&m.command==='next')throw Error('The message port closed before a response was received.');
        if(m.command==='read')return {ok:true,data:sessions};
        if(m.command==='tab'){currentTabs.set(id,m.name);return {ok:true,data:snapshot(m.name,[],[])};}
        if(m.command==='range'){
          const current=currentTabs.get(id);
          if(options.oldTimeout&&m.start<core.collectionRanges(core.iso(options.joined),new Date(Date.now()-86400000).toISOString().slice(0,10))[0].start)return {ok:false,error:'Okuma süresi aşıldı. Bu okuma tamamlanamadı.'};
          if(options.rangeTimeoutOnce&&injectedFailures++===0)return {ok:false,error:'Okuma komutunun süresi aşıldı.'};
          if(options.delayReads)await new Promise(r=>setTimeout(r,id%3*2));
          if(options.rangeError)return {ok:false,error:'Backstage bu tarihi seçmeye izin vermiyor.'};
          const lagged=options.latestDayUnavailable&&current==='CANLI Yayın performansı'&&m.maxLagDays>0;
          const end=lagged?new Date(Date.parse(m.end)-86400000).toISOString().slice(0,10):m.end;
          if(options.latestDayUnavailable&&current==='CANLI Yayın performansı'&&!lagged&&m.end===new Date(Date.now()-86400000).toISOString().slice(0,10))return {ok:false,error:'Takvimde tarih seçilemedi: '+m.end+'.'};
          const rows=[];for(let t=Date.parse(m.start);t<=Date.parse(end);t+=86400000)rows.push({Tarih:new Date(t).toISOString().slice(0,10).split('-').reverse().join('.'),'Elmaslar':'0','CANLI Yayın süresi':'0','Yeni takipçiler':'0'});
          const data=current==='CANLI Yayın performansı'?snapshot(current,rows,Object.keys(rows[0])):snapshot(current,[{Bölge:'TR'}],['Bölge']);
          if(options.missingDate&&current==='CANLI Yayın performansı'){data.rows.pop();data.paging.total=data.rows.length;}
          if(m.maxLagDays>0)Object.assign(data,{requestedEnd:m.end,availableEnd:end});
          return {ok:true,data};
        }
        throw Error('Unexpected command '+m.command);
      }}}
  };
  const db={};
  if(options.package){context.BTGFeedbackPackage=require('../src/core/feedback-package');context.BTGFeedbackHistory=require('../src/core/feedback-history');context.chrome.storage={local:{get:async k=>({[k]:db[k]}),set:async o=>Object.assign(db,o)}};context.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail;}};context.window.dispatchEvent=e=>{context.lastPackageEvent=e;};}
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui/feedback.js'),'utf8'),context);
  return {run:async()=>{await el('folder').onclick();await el('start').onclick();},saved,removed,commands,el,db,context,maxActive:()=>maxActive,tabOwners};
}
test('Four creator workers isolate tabs, serialize history and finish all outputs before packaging',async()=>{
 const f=fixture({creatorCount:9,delayReads:true,package:true});let registering=0,registered=0;
 f.context.window.BTGFeedbackRegister=async()=>{assert.equal(++registering,1);await new Promise(r=>setTimeout(r,3));registering--;registered++;};
 await f.run();assert.equal(f.maxActive(),4);assert.equal(registered,9);
 const manifest=JSON.parse(f.saved.get('00_oturum.json'));assert.equal(manifest.concurrency,4);assert.equal(manifest.creators.length,9);assert.equal(manifest.status,'finished');
 for(let i=2;i<11;i++){const r=JSON.parse(f.saved.get(`cfrkn${i}.json`));assert.equal(r.username,`cfrkn${i}`);assert.equal(r.status,core.COMPLETE||'requested_daily_range_and_available_tables_complete');}
 const pkg=f.db['btg.feedback.packages.v1'].packages[manifest.packageId];assert.equal(pkg.records.length,9);
 assert.equal(f.removed.length,f.tabOwners.size);
});
test('Stop during parallel collection dispatches no fifth creator and closes owned tabs',async()=>{
 const f=fixture({creatorCount:9,stopAtRead:true});await f.run();
 assert.ok(f.maxActive()<=4);assert.ok(![...f.tabOwners.values()].includes('cfrkn6'));
 assert.equal(JSON.parse(f.saved.get('00_oturum.json')).status,'stopped');assert.equal(f.removed.length,f.tabOwners.size);
});
test('Disk failure in parallel collection does not dispatch remaining creators or report success',async()=>{
 const f=fixture({creatorCount:9,diskFull:true});await f.run();assert.equal(f.maxActive(),4);assert.match(f.el('status').textContent,/disk full/);assert.equal(f.removed.length,f.tabOwners.size);
});

test('Previously selected feedback folder restores without opening picker',async()=>{
 const f=fixture({restoreFolder:true});await new Promise(r=>setImmediate(r));assert.equal(f.el('folderName').textContent,'Masaüstü');await f.el('start').onclick();assert.ok(f.saved.has('cfrkn2.json'));
});
test('All scan skips recently served creator and exports reason; named scan still collects',async()=>{
 const H=require('../src/core/feedback-history'),stamp=new Date(Date.now()-3600000).toISOString();
 function seed(f){f.db[H.KEY]={version:1,creators:{'username:cfrkn2':{key:'username:cfrkn2',username:'cfrkn2',id:null,snapshots:[{id:stamp,status:H.COMPLETE}],sent:[{sentAt:new Date().toISOString(),sourceSnapshotId:stamp}]}}};}
 const all=fixture({package:true});seed(all);await all.run();assert.equal(all.commands.length,1);assert.ok(!all.saved.has('cfrkn2.json'));assert.ok(!all.saved.has('01_ChatGPT_geri_bildirim.md'));
 const summary=JSON.parse(all.saved.get('00_oturum.json'));assert.equal(summary.skippedCreators.length,1);assert.equal(summary.expectedCreators,0);assert.equal(summary.status,'finished');
 const current=fixture({package:true});seed(current);current.el('scope').value='current';await current.run();assert.ok(current.saved.has('cfrkn2.json'));
});
test('Tüm yayıncı akışı TXT/JSON/yönerge/özet üretir, yalnız kendi sekmelerini kapatır',async()=>{
  const f=fixture();await f.run();assert.ok(f.saved.has('cfrkn2.txt'));assert.ok(f.saved.has('cfrkn2.json'));assert.ok(f.saved.has('00_geri_bildirim_yonergesi.txt'));
  const report=JSON.parse(f.saved.get('cfrkn2.json'));assert.equal(report.status,'requested_daily_range_and_available_tables_complete');
  assert.equal(JSON.parse(f.saved.get('00_oturum.json')).creators.length,1);const periods=core.collectionRanges(report.requestedStart,report.requestedEnd).length;
  assert.deepEqual(f.removed,Array.from({length:2+2*periods},(_,i)=>i+1));
  const rangeTabs=f.commands.filter(c=>c.command==='range').map(c=>c.tabId);
  assert.equal(new Set(rangeTabs).size,rangeTabs.length);
  assert.ok(f.commands.every(c=>c.type==='BTG_FEEDBACK_READ'));
});
test('Eksik ajans sayfalaması yayıncı toplamaya geçmez',async()=>{
  const f=fixture({rosterMismatch:true});await f.run();assert.ok(!f.saved.has('cfrkn2.json'));assert.match(f.el('status').textContent,/Eksik sayfalama/);
});
test('Eksik tarih ve erişilemeyen geçmiş tam kapsam sayılmaz',async()=>{
  for(const option of [{missingDate:true},{rangeError:true}]){const f=fixture(option);await f.run();const report=JSON.parse(f.saved.get('cfrkn2.json'));assert.equal(report.status,'partial');assert.equal(report.performance.length,0);}
});
test('Durdurma mevcut kişiyi stopped kaydeder, başka kişiye geçmez',async()=>{
  const f=fixture({stopAtRead:true});await f.run();assert.equal(JSON.parse(f.saved.get('cfrkn2.json')).status,'stopped');assert.deepEqual(f.removed,[1,2]);
});
test('Yanlış kişi verisi kaydedilmez; hata kaydı ve sekme temizliği korunur',async()=>{
  const f=fixture({identityError:true});await f.run();const r=JSON.parse(f.saved.get('cfrkn2.json'));assert.equal(r.sessions,null);assert.equal(r.status,'partial');assert.deepEqual(f.removed,[1,2]);
});
test('Identity failure preserves incomplete record and continues to next creator',async()=>{
 const f=fixture({identityError:true,twoCreators:true});await f.run();
 const first=JSON.parse(f.saved.get('cfrkn2.json')),second=JSON.parse(f.saved.get('cfrkn3.json'));
 assert.equal(first.sessions,null);assert.equal(first.performance.length,0);
 assert.equal(second.status,'requested_daily_range_and_available_tables_complete');
 const manifest=JSON.parse(f.saved.get('00_oturum.json'));
 assert.equal(manifest.creators.length,2);assert.equal(manifest.incompleteCreators,1);assert.equal(manifest.status,'finished_with_warnings');
});

test('Disk hatası başarılı kayıt olarak bildirilmez',async()=>{
  const f=fixture({diskFull:true});await f.run();assert.match(f.el('status').textContent,/disk full/);assert.equal(f.el('start').disabled,false);
});
test('Eksik kapsam sonuç ekranında ve oturum durumunda açıkça belirtilir',async()=>{
 const f=fixture({rangeError:true});await f.run();const manifest=JSON.parse(f.saved.get('00_oturum.json'));
 assert.equal(manifest.status,'finished_with_warnings');assert.equal(manifest.incompleteCreators,1);
 assert.match(f.el('status').textContent,/1 yayıncıda kapsam eksik/);
 assert.match(f.el('log').textContent,/Backstage bu tarihi/);
});
test('35 günlük geçmişte dört dönem okuması ayrı sekmelerde yapılır ve sekmeler kapanır',async()=>{
 const f=fixture({joined:'11.08.2026 19:14:00'});await f.run();
 const r=JSON.parse(f.saved.get('cfrkn2.json'));
 const expected=core.collectionRanges('2026-08-11',r.requestedEnd).length;
 assert.equal(r.performance.length,expected);assert.equal(r.regions.length,expected);
 const reads=f.commands.filter(c=>c.command==='range');assert.equal(reads.length,expected*2);
 assert.equal(new Set(reads.map(c=>c.tabId)).size,reads.length);
 assert.ok(reads.every(c=>f.removed.includes(c.tabId)));
 assert.equal(r.status,'requested_daily_range_and_available_tables_complete');
});

test('Collection writes MD and stores matching package manifest without triggering send',async()=>{const f=fixture({package:true});await f.run();const md=f.saved.get('01_ChatGPT_geri_bildirim.md');assert.ok(md);const manifest=JSON.parse(f.saved.get('00_oturum.json'));assert.ok(manifest.packageId);const pkg=f.db['btg.feedback.packages.v1'].packages[manifest.packageId];assert.equal(pkg.records[0].username,'cfrkn2');assert.ok(md.includes(pkg.records[0].recordKey));assert.equal(f.context.lastPackageEvent.detail.packageId,pkg.id);assert.ok(f.commands.every(c=>c.type==='BTG_FEEDBACK_READ'));});

for(const options of [{channelOnce:true},{rangeTimeoutOnce:true}])test('Transient read failure recovers in a new tab without duplicated results '+JSON.stringify(options),async()=>{
 const f=fixture(options);await f.run();const r=JSON.parse(f.saved.get('cfrkn2.json'));
 assert.equal(r.status,'requested_daily_range_and_available_tables_complete');assert.equal(r.recoveryAttempts.length,1);assert.equal(r.collectionIssues.length,0);
 assert.equal(r.sessions.rows.length,1);assert.equal(new Set(r.performance.flatMap(p=>p.rows.map(row=>row.Tarih))).size,r.performance.flatMap(p=>p.rows).length);
 assert.equal(f.removed.length,f.tabOwners.size);assert.equal(new Set(f.removed).size,f.removed.length);
});
test('Persistent historical timeouts preserve recent coverage and continue regional reads',async()=>{
 const f=fixture({joined:'11.08.2026 19:14:00',oldTimeout:true,package:true});await f.run();const r=JSON.parse(f.saved.get('cfrkn2.json'));
 assert.equal(r.status,'partial');assert.equal(r.performance.length,1);assert.equal(r.regions.length,1);
 const recent=core.collectionRanges(r.requestedStart,r.requestedEnd)[0];assert.deepEqual(r.performance[0].requested,recent);assert.equal(r.performance[0].rows.length,14);
 const oldWindows=core.collectionRanges(r.requestedStart,r.requestedEnd).length-1;assert.ok(oldWindows>=1);
 assert.equal(r.collectionIssues.length,2*oldWindows);assert.equal(r.recoveryAttempts.length,2*oldWindows);
 const reads=f.commands.filter(c=>c.command==='range');assert.equal(reads[0].start,recent.start);assert.equal(reads[0].end,recent.end);
 assert.ok(f.saved.has('01_ChatGPT_geri_bildirim.md'));assert.equal(f.removed.length,f.tabOwners.size);
});
test('Unpublished latest daily row moves the whole report to the newest selectable day instead of dropping the range',async()=>{
 const f=fixture({joined:'11.08.2026 19:14:00',latestDayUnavailable:true});await f.run();const r=JSON.parse(f.saved.get('cfrkn2.json'));
 const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10),dayBefore=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
 assert.equal(r.requestedEnd,dayBefore);assert.equal(r.status,'requested_daily_range_and_available_tables_complete');assert.equal(r.collectionIssues.length,0);
 assert.equal(r.performance[0].requested.end,dayBefore);assert.equal(r.performance[0].rows.length,13);
 assert.ok(r.warnings.some(w=>w.includes(yesterday)&&w.includes(dayBefore)));
 const ranges=f.commands.filter(c=>c.command==='range');
 assert.equal(ranges.filter(c=>c.maxLagDays).length,1,'only the newest daily range may move');
 assert.ok(ranges.every(c=>c.end<=dayBefore||c.maxLagDays),'regional reads follow the adjusted end');
});
test('A broken next-page channel retains verified sessions as partial and still reads daily tables',async()=>{
 const f=fixture({partialSessions:true});await f.run();const r=JSON.parse(f.saved.get('cfrkn2.json'));
 assert.equal(r.status,'partial');assert.equal(r.sessions.rows.length,1);assert.equal(r.sessions.tableComplete,false);assert.equal(r.sessions.paging.total,2);
 const periods=core.collectionRanges(r.requestedStart,r.requestedEnd).length;
 assert.equal(r.performance.length,periods);assert.equal(r.regions.length,periods);assert.equal(r.collectionIssues.length,1);assert.equal(r.recoveryAttempts.length,1);
 assert.equal(f.removed.length,f.tabOwners.size);
});

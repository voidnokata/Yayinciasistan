const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'..');
test('Workflow HTML has unique IDs and keeps collector and history controls',()=>{
 const html=fs.readFileSync(path.join(base,'src/ui/feedback.html'),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const id of ['folder','scope','namedUsername','targets','start','stop','log','packageReports','packageSelect','feedbackExcel','reviewedMessages','sendFeedbackStart','sendFeedbackStop','weeklyQueue','creatorRows','draftText'])assert.ok(ids.includes(id),id);
 for(const match of html.matchAll(/<script src="([^"]+)"/g))assert.ok(fs.existsSync(path.join(base,'src/ui',match[1])),match[1]);
 const popup=fs.readFileSync(path.join(base,'src/ui/popup.html'),'utf8');assert.match(popup,/id="normalModeButton"/);assert.match(popup,/id="feedbackModeButton"/);assert.match(popup,/feedback\.html\?embedded=1/);
});
function fixture(embedded=false,data={},readReports=require('../src/core/feedback-package').readReportFiles){
 const els=new Map(),messages=[],tabs=[];
 function el(id=''){const e={id,value:id==='scope'?'all':'',textContent:'',hidden:false,disabled:false,checked:false,files:[],children:[],listeners:{},classList:{toggle(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},get firstChild(){return this.children[0];},addEventListener(name,fn,capture){(this.listeners[name]??=[]).push({fn,capture});},click(){}};return e;}
 const get=id=>{if(!els.has(id))els.set(id,el(id));return els.get(id);};
 const row={recordKey:'p:1',username:'kai35.5',from:'2026-09-08',to:'2026-09-14',message:'Merhaba Kai'};
 const context={console,URL,URLSearchParams,Blob,structuredClone,setTimeout,clearTimeout,location:{search:embedded?'?embedded=1':''},document:{getElementById:get,createElement:()=>el(),body:el()},window:{addEventListener(){},BTGFeedbackRegister:async()=>{}},confirm:()=>true,
 BTGFeedbackHistory:{KEY:'h',empty:()=>({creators:{}})},BTGFeedback:{},BTGFeedbackPackage:{readReportFiles:readReports,load:async()=>({packages:{p:{id:'p',createdAt:'2026-09-15',records:[row]}}}),readExcel:async()=>[row],validateRows:()=>({rows:[row],errors:[],missing:[],excluded:[]})},
 chrome:{storage:{local:{get:async()=>data,set:async o=>Object.assign(data,o),remove:async()=>{}},onChanged:{addListener(){}}},runtime:{getURL:p=>'extension://'+p,sendMessage:async m=>{messages.push(m);return {ok:true,queue:m.type==='BTG_FEEDBACK_START'?{status:'running',rows:[{...row,status:'pending'}]}:null};}},tabs:{create:async t=>tabs.push(t),getCurrent:async()=>({id:321})}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(base,'src/ui/feedback-workflow-ui.js'),'utf8'),context);
 async function fire(id,type){const event={stopped:false,preventDefault(){},stopImmediatePropagation(){this.stopped=true;}};const listeners=[...(get(id).listeners[type]||[])].sort((a,b)=>Number(!!b.capture)-Number(!!a.capture));for(const x of listeners){await x.fn(event);if(event.stopped)break;}}
 return {get,messages,tabs,data,fire,ready:()=>new Promise(r=>setTimeout(r,0))};
}
test('Form inputs survive popup recreation without restoring send approval',async()=>{
 const data={},first=fixture(true,data);await first.ready();
 for(const [id,value] of [['targets','5 days'],['scope','named'],['namedUsername','creator']]){first.get(id).value=value;await first.fire(id,'input');}
 const reopened=fixture(true,data);await reopened.ready();
 assert.equal(reopened.get('targets').value,'5 days');assert.equal(reopened.get('scope').value,'named');assert.equal(reopened.get('namedUsername').value,'creator');assert.equal(reopened.get('namedUsernameLabel').hidden,false);
 assert.equal(reopened.get('reviewedMessages').checked,false);assert.ok(!reopened.messages.some(m=>m.type==='BTG_FEEDBACK_START'));
});
test('Loading and Excel preview do not send; explicit review and start sends validated exact rows',async()=>{
 const f=fixture();await f.ready();assert.deepEqual(f.messages.map(m=>m.type),['BTG_FEEDBACK_STATUS']);assert.equal(f.get('sendFeedbackStart').disabled,true);
 f.get('feedbackExcel').files=[{name:'messages.xlsx'}];await f.fire('feedbackExcel','change');assert.equal(f.get('sendFeedbackStart').disabled,true);assert.equal(f.get('excelPreviewRows').children.length,1);
 await f.fire('sendFeedbackStart','click');assert.equal(f.messages.length,1);
 f.get('reviewedMessages').checked=true;await f.fire('reviewedMessages','change');assert.equal(f.get('sendFeedbackStart').disabled,false);await f.fire('sendFeedbackStart','click');
 const send=f.messages.find(m=>m.type==='BTG_FEEDBACK_START');assert.equal(send.packageId,'p');assert.equal(send.rows[0].username,'kai35.5');assert.equal(f.get('sendFeedbackStop').disabled,false);
});
test('Embedded collector opens persistent page with selected scope; never starts sending',async()=>{
 const f=fixture(true);await f.ready();f.get('scope').value='named';f.get('namedUsername').value='kai35.5';await f.fire('start','click');
 assert.equal(f.tabs.length,1);assert.equal(f.data['btg.feedback.pendingUI'].namedUsername,'kai35.5');assert.ok(!f.messages.some(m=>m.type==='BTG_FEEDBACK_START'));
});


test('Embedded file selection stays in popup; reviewed send starts without opening another tab',async()=>{const f=fixture(true);await f.ready();for(const id of ['packageReports','feedbackExcel','folder'])await f.fire(id,'click');assert.equal(f.tabs.length,0);f.get('feedbackExcel').files=[{name:'messages.xlsx'}];await f.fire('feedbackExcel','change');f.get('reviewedMessages').checked=true;await f.fire('sendFeedbackStart','click');assert.equal(f.tabs.length,0);assert.ok(f.messages.some(m=>m.type==='BTG_FEEDBACK_START'));});
test('Bulk file selection enables package creation and visibly explains skipped summary; empty selection clears it',async()=>{
 const f=fixture();await f.ready();
 const report={schemaVersion:1,username:'creator',collectedAt:'2026-09-17',requestedStart:'2026-09-01',requestedEnd:'2026-09-16',performance:[{rows:[]}],warnings:[]};
 f.get('packageReports').files=[{name:'00_oturum.json',size:100,text:async()=>JSON.stringify({creators:[]})},{name:'creator.json',size:100,text:async()=>JSON.stringify(report)}];
 await f.fire('packageReports','change');assert.equal(f.get('createPackage').disabled,false);assert.match(f.get('packageStatus').textContent,/1 yayıncı dosyası hazır/);assert.match(f.get('packageStatus').textContent,/00_oturum.json/);
 f.get('packageReports').files=[];await f.fire('packageReports','change');assert.equal(f.get('createPackage').disabled,true);assert.match(f.get('packageStatus').textContent,/bulunamadı/);assert.ok(!f.messages.some(m=>m.type==='BTG_FEEDBACK_START'));
});
test('A slow previous file selection cannot overwrite a newer completed selection',async()=>{
 let finish;const f=fixture(false,{},files=>files[0].name==='slow'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({reports:[],skipped:[]}));await f.ready();
 f.get('packageReports').files=[{name:'slow'}];const old=f.fire('packageReports','change');
 f.get('packageReports').files=[{name:'new'}];await f.fire('packageReports','change');finish({reports:[{username:'old'}],skipped:[]});await old;
 assert.equal(f.get('createPackage').disabled,true);assert.match(f.get('packageStatus').textContent,/bulunamadı/);
});

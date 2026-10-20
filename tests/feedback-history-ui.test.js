const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const H=require('../src/core/feedback-history');
function fixture(data={}){
 const els=new Map(),state=H.empty();let permit=true;
 for(let i=0;i<25;i++){const key='username:user'+String(i).padStart(2,'0');state.creators[key]={key,username:'user'+String(i).padStart(2,'0'),rosterActive:true,joinedDate:'2026-09-01',joinedRaw:'01.09.2026',snapshots:[],sent:[],draft:null};}
 function el(){return {value:'',children:[],hidden:false,disabled:false,attrs:{},append(x){this.children.push(x);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attrs[k]=v;},focus(){},scrollIntoView(){}};}
 const get=id=>{if(!els.has(id))els.set(id,el());return els.get(id);};get('historyFilter').value='all';
 const context={BTGFeedbackHistory:{...H,createStore:()=>({read:async()=>state})},document:{getElementById:get,createElement:el},navigator:{},chrome:{storage:{local:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},onChanged:{addListener(){}}}},window:{addEventListener(){},matchMedia:()=>({matches:false})},confirm:()=>permit,Date,console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/ui/feedback-history-ui.js'),'utf8'),context);
 return {get,deny:()=>{permit=false;},ready:()=>new Promise(r=>setImmediate(r)),choose:i=>get('creatorRows').children[i].children[0].children[0].onclick()};
}
test('Incomplete editor text survives reopening and stays bound to its creator',async()=>{
 const data={},first=fixture(data);await first.ready();first.choose(0);await first.ready();first.get('draftText').value='Unfinished text';first.get('draftText').oninput();await first.ready();
 const reopened=fixture(data);await reopened.ready();reopened.choose(0);await reopened.ready();assert.equal(reopened.get('draftText').value,'Unfinished text');reopened.choose(1);await reopened.ready();assert.equal(reopened.get('draftText').value,'');
});
test('Roster-only creators paginate and selection opens right detail without requiring data',async()=>{
 const f=fixture();await f.ready();assert.equal(f.get('creatorRows').children.length,12);assert.equal(f.get('weeklyTotal').textContent,25);
 f.choose(0);assert.equal(f.get('detailTitle').textContent,'@user00');assert.equal(f.get('creatorDetail').hidden,false);assert.equal(f.get('detailPlaceholder').hidden,true);
 f.get('creatorNextPage').onclick();assert.equal(f.get('creatorPageInfo').textContent,'2 / 3');f.choose(0);assert.equal(f.get('detailTitle').textContent,'@user12');
 f.get('prevCreator').onclick();assert.equal(f.get('detailTitle').textContent,'@user11');assert.equal(f.get('creatorPageInfo').textContent,'1 / 3');
});
test('Filtering supports @username and empty results do not lose selected draft',async()=>{
 const f=fixture();await f.ready();f.choose(0);f.get('draftText').value='Unsaved message';f.get('draftText').oninput();f.deny();f.choose(1);assert.equal(f.get('detailTitle').textContent,'@user00');assert.equal(f.get('draftText').value,'Unsaved message');
 f.get('creatorSearch').value='@user24';f.get('creatorSearch').oninput();assert.equal(f.get('creatorRows').children.length,1);assert.equal(f.get('creatorPageInfo').textContent,'1 / 1');
 f.get('creatorSearch').value='missing';f.get('creatorSearch').oninput();assert.equal(f.get('emptyHistory').hidden,false);assert.equal(f.get('nextCreator').disabled,true);assert.equal(f.get('draftText').value,'Unsaved message');
});
test('Detail tabs switch panels and support keyboard navigation',async()=>{
 const f=fixture();await f.ready();f.choose(0);assert.equal(f.get('detailOverview').hidden,false);assert.equal(f.get('detailMessage').hidden,true);
 f.get('detailTabMessage').onclick();assert.equal(f.get('detailMessage').hidden,false);assert.equal(f.get('detailOverview').hidden,true);
 f.get('detailTabMessage').onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(f.get('detailHistory').hidden,false);assert.equal(f.get('detailTabHistory').attrs['aria-selected'],'true');
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../src/content/tiktok-content.js'),'utf8');
const from = source.indexOf('  async function readTalentAssessment(');
const to = source.indexOf('\n  async function runMobileController',from);
const fn = source.slice(from,to);
async function scenario(owner, changeUser=false) {
  let clicked=0,closed=0,visible=false, user='target';
  class Element {click(){closed++;}}
  const panel={innerText:'Hayran Kulübü\n12\nGeçmiş',owner,
    querySelector:()=>new Element()};
  const trigger={click(){clicked++;visible=true;if(changeUser)user='other';}};
  const ctx={HTMLElement:Element,window:{BTGTalent:{number:()=>13,assess:x=>({...x,snapshot:{}})}},
    controller:{running:true},
    document:{querySelector:()=>trigger,querySelectorAll:sel=>sel==='div'?[]:visible?[panel]:[]},
    isRenderedPopover:()=>true,isVisible:()=>true,
    livePopoverBelongsTo:(p,u)=>p.owner===u,
    usernamesMatch:(a,b)=>a===b,getLiveUsername:()=>user,
    findLiveAnchorHoverTrigger:()=>trigger,waitFor:async f=>f()};
  vm.createContext(ctx); vm.runInContext(fn,ctx);
  const result=await ctx.readTalentAssessment('target',358);
  return {result,clicked,closed};
}
(async()=>{
  const valid=await scenario('target');
  assert.match(valid.result.text,/Hayran/);
  assert.equal(valid.result.snapshot.source,'https://www.tiktok.com/@target/live');
  assert.equal(valid.clicked,1);assert.equal(valid.closed,1);
  const wrong=await scenario('other');assert.equal(wrong.result.text,'');
  const changed=await scenario('target',true);assert.equal(changed.result.text,'');
  console.log('Panel açma, kapatma, yanlış hesap ve yayın değişimi testleri geçti.');
})().catch(e=>{console.error(e);process.exitCode=1;});

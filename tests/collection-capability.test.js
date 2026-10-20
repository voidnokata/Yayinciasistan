const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','src/background/background.js'),'utf8');
const fn=source.slice(source.indexOf('async function startControllerWithRecovery('),source.indexOf('async function stopAutomation('));
async function scenario(replies){
  const calls=[],queue=[...replies];
  const ctx={chrome:{tabs:{sendMessage:async(id,msg)=>{calls.push(msg.type);if(msg.type==='BTG_START_CONTROLLER')return{ok:true};const reply=queue.shift();if(reply instanceof Error)throw reply;return reply;},reload:async()=>calls.push('reload')}},patchRuntime:async()=>{},waitForTabComplete:async()=>{},delay:async()=>{},isMissingReceiverError:e=>e.message==='missing'};
  vm.createContext(ctx);vm.runInContext(fn,ctx);
  const result=await ctx.startControllerWithRecovery(1,{mode:'collect'});return{result,calls};
}
(async()=>{
  let s=await scenario([{ok:true,collectionDataVersion:1}]);assert.equal(s.result.ok,true);assert.ok(!s.calls.includes('reload'));
  s=await scenario([{ok:true},{ok:true,collectionDataVersion:1}]);assert.equal(s.result.ok,true);assert.equal(s.calls.filter(x=>x==='reload').length,1);
  assert.ok(s.calls.indexOf('reload')<s.calls.indexOf('BTG_START_CONTROLLER'));
  s=await scenario([{ok:true},{ok:true}]);assert.equal(s.result.ok,false);assert.ok(!s.calls.includes('BTG_START_CONTROLLER'));
  s=await scenario([new Error('missing'),{ok:true,collectionDataVersion:1}]);assert.equal(s.result.ok,true);
  s=await scenario([new Error('missing'),{ok:true}]);assert.equal(s.result.ok,false);assert.ok(!s.calls.includes('BTG_START_CONTROLLER'));
  console.log('Collection cannot start on an obsolete measurement module; automatic refresh and fail-closed retry passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

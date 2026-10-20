const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','src/background/background.js'),'utf8');
const start=source.indexOf('async function sendBackstageInstantMessage(');
const end=source.indexOf('\nasync function ',start+1);
function setup({running=true,previous=false,mode='manual',notice=false,response={ok:true,sent:true}}={}) {
  const calls=[], writes=[], stops=[];
  const context={sanitizeUsername:x=>x,readableError:e=>e.message,
    chrome:{storage:{local:{get:async()=>({runtime:{running,mode,existingCreatorNotice:notice,controllerTabId:1,backstageTabId:2}}),set:async x=>writes.push(x)}}},
    hasMessagedPublisher:async()=>({messaged:previous}),
    sendBackstageMessage:async(...args)=>{calls.push(args);return response;},
    normalizeMessagedPublishers:x=>x||{},mergeProcessedIntoMessagedPublishers:(x,rows)=>({rows}),stopAutomation:async x=>stops.push(x)
  };
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  context.usesBackstageInstantMessages=mode=>mode==='manual'||mode==='live';
  context.isExistingCreatorNoticeRun=runtime=>runtime?.mode==='manual'&&runtime.existingCreatorNotice===true;
  return {run:context.sendBackstageInstantMessage,calls,writes,stops};
}
(async()=>{
  // Mevcut yayıncı bilgilendirmesi ilk temas geçmişine takılmaz ve Backstage'e notice bayrağıyla gider.
  const notice=setup({previous:true,notice:true});
  assert.equal((await notice.run('esra','hello',1)).sent,true);
  assert.equal(notice.calls.length,1);assert.equal(notice.calls[0][1].notice,true);
  const plain=setup();await plain.run('esra','hello',1);assert.equal(plain.calls[0][1].notice,undefined);
  for (const mode of ['manual','live']) {
    const valid=setup({mode});assert.equal((await valid.run('esra','hello',1)).sent,true);
    assert.equal(valid.calls[0][0],2);assert.equal(valid.calls[0][1].type,'BTG_BACKSTAGE_SEND_DM');
    assert.equal(valid.writes[0].messagedPublishers.rows[0].username,'esra');
  }
  for(const opts of [{running:false},{previous:true}]) {
    const test=setup(opts);await test.run('esra','hello',1);assert.equal(test.calls.length,0);
  }
  const wrong=setup();assert.equal((await wrong.run('esra','hello',99)).ok,false);assert.equal(wrong.calls.length,0);
  const suspended=setup({mode:'live',response:{ok:true,unavailableSkipped:true,unavailableReason:'account_suspended'}});
  const suspendedResult=await suspended.run('esra','hello',1);
  assert.equal(suspendedResult.unavailableReason,'account_suspended');
  assert.equal(suspended.writes.length,0,'Askıya alınan hesap mesaj geçmişine başarılı yazılmamalı');
  assert.equal(suspended.stops.length,0,'Askıya alınan hesap otomasyonu durdurmamalı');
  const branch=source.slice(source.indexOf('case "BTG_SEND_DM":'),source.indexOf('case "BTG_ACTIVATE_CONTROLLER":'));
  assert.ok(branch.indexOf('return sendBackstageInstantMessage')<branch.indexOf('return sendDirectMessage'));
  assert.match(branch,/usesBackstageInstantMessages/);
  console.log('Manuel liste ve CANLI Backstage yönlendirmesi, geçmiş kaydı ve oturum koruması geçti.');
})().catch(e=>{console.error(e);process.exitCode=1;});

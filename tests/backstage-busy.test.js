const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function contentFixture() {
  let listener, api;
  const ctx = {window:{}, location:{href:'https://live-backstage.tiktok.com/portal/anchor/instant-messages'},
    chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}}},
    expose:value=>api=value};
  vm.runInNewContext(read('src/content/backstage-content.js').replace(/\}\)\(\);\s*$/, `
    expose({setCheck:fn=>checkInstantMessageCreator=fn,
      setSend:fn=>sendInstantMessage=fn});
    findInviteEntryPoint=()=>true;
  })();`), ctx);
  const call = (type, reply, extra={}) => listener({type, username:'sample', mode:'live', ...extra}, {}, reply);
  const drain = async () => {for(let i=0;i<20;i++)await Promise.resolve();};
  return {api,call,drain};
}

test('reply callback may immediately send the next command without a busy error', async () => {
  const f=contentFixture();
  f.api.setCheck(async()=>({ok:true,eligible:true}));
  f.api.setSend(async()=>({ok:true,sent:true}));
  let sent;
  f.call('BTG_BACKSTAGE_CHECK', result=>{
    assert.equal(result.ok,true);
    f.call('BTG_BACKSTAGE_SEND_DM', result=>sent=result);
  });
  await f.drain();
  assert.equal(sent.sent,true);
});

test('synchronous command errors release the lock before replying', async () => {
  const f=contentFixture();
  f.api.setCheck(()=>{throw Error('sync failure');});
  let error, ping;
  f.call('BTG_BACKSTAGE_CHECK', result=>{
    error=result;
    f.call('BTG_BACKSTAGE_PING', result=>ping=result);
  });
  await f.drain();
  assert.equal(error.error,'sync failure');
  assert.equal(ping.busy,false);
});

test('busy reply identifies checks separately from sends and does not start a second operation', async () => {
  const f=contentFixture();
  let release, count=0, reply;
  f.api.setCheck(()=>{count++;return new Promise(resolve=>release=resolve);});
  f.call('BTG_BACKSTAGE_CHECK',()=>{});
  await f.drain();
  f.call('BTG_BACKSTAGE_CHECK',result=>reply=result);
  assert.equal(reply.code,'BACKSTAGE_BUSY');
  assert.equal(reply.busyOperation,'BTG_BACKSTAGE_CHECK');
  assert.equal(count,1);
  release({ok:true});await f.drain();
});

function backgroundFixture() {
  const ctx={URL,console,setTimeout,clearTimeout,
    chrome:{runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(){}}}}};
  vm.runInNewContext(read('src/background/background.js'),ctx);
  const calls={messages:[],reloads:0};
  const replies=[];
  ctx.patchRuntime=async()=>{};
  ctx.chrome.tabs={reload:async()=>{calls.reloads++;}};
  ctx.waitForTabComplete=async()=>{};
  ctx.sendBackstageMessage=async(id,message)=>{
    calls.messages.push(message);
    assert.ok(replies.length, 'unexpected message '+message.type);
    const reply=replies.shift();
    if(reply instanceof Error)throw reply;
    return reply;
  };
  return {ctx,calls,replies};
}
const timeout = () => Object.assign(Error('timeout'),{code:'BACKSTAGE_TIMEOUT'});
const busy = operation => ({ok:false,code:'BACKSTAGE_BUSY',busyOperation:operation});
const ready = {ok:true,ready:true,busy:false};

test('timeout skips the old request and resets before a different creator is checked', async () => {
  const f=backgroundFixture();
  f.replies.push(timeout());
  await assert.rejects(()=>f.ctx.sendBackstageCheckWithRecovery(2,'first','live'),{code:'BACKSTAGE_TIMEOUT'});
  assert.equal(f.calls.reloads,0);
  f.replies.push(ready,{ok:true,eligible:true});
  const result=await f.ctx.sendBackstageCheckWithRecovery(2,'second','live');
  assert.equal(result.eligible,true);
  assert.equal(f.calls.reloads,1);
  assert.deepEqual(f.calls.messages.map(m=>[m.type,m.username]),[
    ['BTG_BACKSTAGE_CHECK','first'],['BTG_BACKSTAGE_PING',undefined],['BTG_BACKSTAGE_CHECK','second']]);
});

test('busy check is recovered once, without an unbounded reload loop', async () => {
  const f=backgroundFixture();
  f.replies.push(busy('BTG_BACKSTAGE_CHECK'),ready,busy('BTG_BACKSTAGE_CHECK'));
  const result=await f.ctx.sendBackstageCheckWithRecovery(2,'sample','live');
  assert.equal(result.code,'BACKSTAGE_BUSY');
  assert.equal(f.calls.reloads,1);
});

test('busy send is never reloaded or retried by check recovery', async () => {
  const f=backgroundFixture();
  f.replies.push(busy('BTG_BACKSTAGE_SEND_DM'));
  const result=await f.ctx.sendBackstageCheckWithRecovery(2,'sample','live');
  assert.equal(result.busyOperation,'BTG_BACKSTAGE_SEND_DM');
  assert.equal(f.calls.reloads,0);
  assert.equal(f.calls.messages.length,1);
});

test('starting a new session cleans a busy check but preserves a pending send', async () => {
  const check=backgroundFixture();
  check.replies.push({...ready,busy:true,busyOperation:'BTG_BACKSTAGE_CHECK'},ready);
  assert.equal((await check.ctx.prepareBackstageTab(2)).reloaded,true);
  assert.equal(check.calls.reloads,1);
  const send=backgroundFixture();
  send.replies.push({...ready,busy:true,busyOperation:'BTG_BACKSTAGE_SEND_DM'});
  assert.equal((await send.ctx.prepareBackstageTab(2)).ok,false);
  assert.equal(send.calls.reloads,0);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','src/content/backstage-content.js'),'utf8');

function setup(options = {}) {
  let api, clicks = 0, opened = 0, outgoing = [], now = 0;
  const makeOutgoing = (text, state = {}) => {
    const failureText = state.failureText || 'İletişime geçmeye çalıştığınız hesap askıya alındı, dolayısıyla gönderdiğiniz mesajı almayabilir.';
    const item = {
      querySelector: selector => {
        if (selector === '.im-message-item-layout-message-error') {
          return state.failed
            ? {innerText:failureText,textContent:failureText}
            : {innerText:'',textContent:''};
        }
        if (!state.failed) return null;
        if (selector === '[data-id="backstage_IM_error_resend_code"]') return {parentElement:{innerText:failureText}};
        return null;
      }
    };
    const content = {querySelector: selector =>
      selector.includes('readStatusWrapper') && !state.pending && !state.failed ? {} : null};
    return {innerText:text,closest:selector =>
      selector === '.im-message-item-layout' ? item :
      selector === '.im-message-item-layout-message-content' ? content : null};
  };
  const input = {value: options.draft || '',click(){},dispatchEvent(){}};
  const searchInput = {value:'',click(){},dispatchEvent(){}};
  const button = {disabled:false, getAttribute:()=>null, click:()=>{
    clicks++;
    input.value='';
    if (!options.noAck) outgoing.push(makeOutgoing('hello',{
      pending:options.pending,
      failed:options.rejected,
      failureText:options.failureText
    }));
  }};
  const surface={input,button,list:{}};
  const row={isConnected:true,click:()=>opened++};
  if(options.previous) outgoing.push(makeOutgoing(options.previousMessage||'previous'));
  if(options.rejectedExisting) outgoing.push(makeOutgoing('previous',{failed:true}));
  const popup={innerText:'Loading',querySelector:()=>row};
  const context={window:{},document:{body:{}},MutationObserver:class{observe(){}disconnect(){}},KeyboardEvent:class{constructor(){}} ,location:{pathname:'/portal/anchor/instant-messages'},
    chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async message=>message.type==='BTG_BACKSTAGE_FEEDBACK_ACTIVE'
      ? {active:!options.feedbackInactive}
      : {runtime:{running:!options.stopped,mode:options.mode||'manual',existingCreatorNotice:!!options.noticeRun}}}},
    expose:x=>api=x, row, surface, input, searchInput, popup, ineligible:!!options.ineligible,
    getOutgoing:()=>outgoing, rightUser:!options.wrongUser,
    emptyReads:options.emptyReads||0, searches:[],
    Date:class extends Date {static now(){return now;}},
    advanceClock:ms=>{now+=ms;},
    realPolling:!!options.realPolling, chatReadyAfter:options.chatReadyAfter||0,
  };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    const originalWaitFor = waitFor;
    expose({sendInstantMessage, checkInstantMessageCreator, hasCandidate:()=>Boolean(instantCandidate), seed: (feedback=false) => {
      instantCandidate={username:'esra',feedback,time:Date.now(),row};
      findMessageSearchInput=()=>searchInput;
      messageSearchPopup=()=>popup;
      readMessageSearchResult=(_input,_username,sawLoading)=>{
        if(emptyReads>0){emptyReads--;return null;}
        return sawLoading?{ok:true,eligible:!ineligible}:null;
      };
      isVisible=()=>true;
      instantChatMatches=()=>rightUser;
      instantChatSurface=()=>Date.now()>=chatReadyAfter?surface:null;
      instantOutgoing=()=>getOutgoing().slice();
      setNativeValue=(el,value)=>{el.value=value;if(el===searchInput&&value)searches.push(value);};
      delay=async ms=>{if(realPolling)advanceClock(ms);};
      waitFor=realPolling?originalWaitFor:async(fn,timeout,error)=>{const value=fn();if(!value) throw new Error(error);return value;};
    }});
  })();`),context);
  api.seed();
  return {api,clicks:()=>clicks,opened:()=>opened,input,searches:()=>context.searches.length};
}
(async()=>{
  const valid=setup();
  assert.equal((await valid.api.sendInstantMessage('esra','hello')).sent,true);
  assert.equal(valid.clicks(),1);
  await assert.rejects(()=>valid.api.sendInstantMessage('esra','hello'),/Uygunluk/);
  assert.equal(valid.clicks(),1,'Aynı uygunluk sonucu iki kez kullanılamaz');
  const live=setup({mode:'live'});
  assert.equal((await live.api.sendInstantMessage('esra','hello')).sent,true);
  assert.equal(live.clicks(),1,'CANLI modu Backstage sohbetinden bir kez göndermeli');
  const slowChat=setup({mode:'live',realPolling:true,chatReadyAfter:9000});
  assert.equal((await slowChat.api.sendInstantMessage('esra','hello')).sent,true,
    '9 saniyede hazır olan doğru sohbet eski 8 saniyelik hataya düşmemeli');
  assert.equal(slowChat.clicks(),1);
  for(const options of [
    {mode:'live',realPolling:true,chatReadyAfter:9000,wrongUser:true},
    {mode:'live',realPolling:true,chatReadyAfter:13000}
  ]) {
    const chat=setup(options);
    await assert.rejects(()=>chat.api.sendInstantMessage('esra','hello'),/Seçilen Backstage sohbeti doğrulanamadı/);
    assert.equal(chat.clicks(),0,'Yanlış veya süresi içinde hazır olmayan sohbete gönderilmemeli');
    assert.equal(chat.input.value,'','Doğrulanmayan sohbete taslak yazılmamalı');
  }
  const oneSearch=setup();
  assert.equal((await oneSearch.api.checkInstantMessageCreator('esra')).eligible,true);
  assert.equal(oneSearch.searches(),1,'Sonuç ilk aramada okunursa yeniden aranmamalı');
  const retried=setup({emptyReads:1,ineligible:true});
  assert.deepEqual({...await retried.api.checkInstantMessageCreator('esra')},{ok:true,eligible:false},'Boş kalan ilk arama temizlenip bir kez yeniden yapılmalı');
  assert.equal(retried.searches(),2);
  const notFound=setup({emptyReads:2});
  const notFoundResult=await notFound.api.checkInstantMessageCreator('esra');
  assert.equal(notFoundResult.ok,false);
  assert.equal(notFoundResult.notFound,true,'İki boş arama beklenmeyen hata değil, bulunamadı sonucudur');
  assert.equal(notFound.searches(),2,'Üçüncü arama yapılmamalı');
  assert.equal(notFound.api.hasCandidate(),false,'Bulunamayan yayıncı gönderim adayı olmamalı');
  await assert.rejects(()=>notFound.api.sendInstantMessage('esra','hello'),/Uygunluk/);
  assert.equal(notFound.clicks(),0);
  const ineligibleNormal=setup({ineligible:true});
  assert.equal((await ineligibleNormal.api.checkInstantMessageCreator('esra')).eligible,false);
  assert.equal(ineligibleNormal.api.hasCandidate(),false,'Normal kontrol akışında Uygun değil sonucu gönderime aday olmamalı');
  await assert.rejects(()=>ineligibleNormal.api.sendInstantMessage('esra','hello'),/Uygunluk/);
  assert.equal(ineligibleNormal.clicks(),0,'Normal gönderim Uygun değil sonucunu yine engellemeli');
  const ineligibleFeedback=setup({ineligible:true,previous:true,stopped:true});
  assert.equal((await ineligibleFeedback.api.checkInstantMessageCreator('esra',true)).eligible,false);
  assert.equal(ineligibleFeedback.api.hasCandidate(),true,'Geri bildirim akışı ajans yayıncısını davet uygunluğu dışında doğrulamalı');
  assert.equal((await ineligibleFeedback.api.sendInstantMessage('esra','hello',true)).sent,true,'Uygun değil etiketli mevcut sohbete geri bildirim gönderilebilmeli');
  assert.equal(ineligibleFeedback.clicks(),1);
  const inactiveFeedback=setup({ineligible:true,feedbackInactive:true});
  await inactiveFeedback.api.checkInstantMessageCreator('esra',true);
  await assert.rejects(()=>inactiveFeedback.api.sendInstantMessage('esra','hello',true),/geri bildirim kuyruğu/);
  assert.equal(inactiveFeedback.clicks(),0,'Normal otomasyonun etkin olması geri bildirim gönderimine yetki vermemeli');
  const feedbackCandidateAsNormal=setup();
  await feedbackCandidateAsNormal.api.checkInstantMessageCreator('esra',true);
  await assert.rejects(()=>feedbackCandidateAsNormal.api.sendInstantMessage('esra','hello'),/Uygunluk/);
  assert.equal(feedbackCandidateAsNormal.clicks(),0,'Geri bildirim adayı normal otomasyon tarafından kullanılamamalı');
  const normalCandidateAsFeedback=setup();
  await normalCandidateAsFeedback.api.checkInstantMessageCreator('esra');
  await assert.rejects(()=>normalCandidateAsFeedback.api.sendInstantMessage('esra','hello',true),/Uygunluk/);
  assert.equal(normalCandidateAsFeedback.clicks(),0,'Normal aday geri bildirim kuyruğunda kullanılamamalı');
  const sameText=setup({ineligible:true,previous:true,previousMessage:'hello'});
  assert.equal((await sameText.api.checkInstantMessageCreator('esra',true)).eligible,false);
  assert.equal((await sameText.api.sendInstantMessage('esra','hello',true)).alreadySent,true);
  assert.equal(sameText.clicks(),0,'Aynı metin sohbette varsa ikinci kez gönderilmemeli');
  // Listeden Kontrol "Bilgilendirme Mesajı": ajans yayıncısı Uygun değil görünür, eski sohbet vardır.
  const notice=setup({ineligible:true,previous:true,noticeRun:true});
  const noticeCheck=await notice.api.checkInstantMessageCreator('esra',false,true);
  assert.equal(noticeCheck.eligible,true,'Bilgilendirmede Uygun değil etiketi tıklanabilir kartla gönderime uygun sayılmalı');
  assert.match(noticeCheck.reason,/Ajans yayıncısı/);
  assert.equal((await notice.api.sendInstantMessage('esra','hello',false,true)).sent,true,'Eski sohbete bilgilendirme eklenebilmeli');
  assert.equal(notice.clicks(),1);
  const noticeNotArmed=setup({ineligible:true,previous:true});
  await noticeNotArmed.api.checkInstantMessageCreator('esra',false,true);
  await assert.rejects(()=>noticeNotArmed.api.sendInstantMessage('esra','hello',false,true),/durduruldu/);
  assert.equal(noticeNotArmed.clicks(),0,'Bilgilendirme bayrağı olmayan çalışma bu yolu kullanamamalı');
  const noticeAsNormal=setup({ineligible:true,noticeRun:true});
  await noticeAsNormal.api.checkInstantMessageCreator('esra',false,true);
  await assert.rejects(()=>noticeAsNormal.api.sendInstantMessage('esra','hello'),/Uygunluk/);
  assert.equal(noticeAsNormal.clicks(),0,'Bilgilendirme adayı ilk temas gönderiminde kullanılamamalı');
  const noticeAsFeedback=setup({ineligible:true,noticeRun:true});
  await noticeAsFeedback.api.checkInstantMessageCreator('esra',false,true);
  await assert.rejects(()=>noticeAsFeedback.api.sendInstantMessage('esra','hello',true),/Uygunluk/);
  assert.equal(noticeAsFeedback.clicks(),0,'Bilgilendirme adayı geri bildirim kuyruğunda kullanılamamalı');
  const noticeSameText=setup({ineligible:true,previous:true,previousMessage:'hello',noticeRun:true});
  await noticeSameText.api.checkInstantMessageCreator('esra',false,true);
  assert.equal((await noticeSameText.api.sendInstantMessage('esra','hello',false,true)).alreadySent,true);
  assert.equal(noticeSameText.clicks(),0,'Aynı bilgilendirme metni ikinci kez gönderilmemeli');
  const noticeRejectedExisting=setup({ineligible:true,rejectedExisting:true,noticeRun:true});
  await noticeRejectedExisting.api.checkInstantMessageCreator('esra',false,true);
  assert.equal((await noticeRejectedExisting.api.sendInstantMessage('esra','hello',false,true)).unavailableSkipped,true);
  assert.equal(noticeRejectedExisting.clicks(),0,'Görünür teslim hatası olan sohbete bilgilendirme gönderilmemeli');
  for(const [options,pattern] of [[{wrongUser:true},/sohbeti/],[{stopped:true},/durduruldu/],[{draft:'user draft'},/taslak/]]) {
    const test=setup(options);
    await assert.rejects(()=>test.api.sendInstantMessage('esra','hello'),pattern);
    assert.equal(test.clicks(),0);
  }
  const previous=setup({previous:true});
  assert.equal((await previous.api.sendInstantMessage('esra','hello')).alreadySent,true);
  assert.equal(previous.clicks(),0);
  const rejected=setup({mode:'live',rejected:true});
  const rejectedResult=await rejected.api.sendInstantMessage('esra','hello');
  assert.equal(rejectedResult.unavailableSkipped,true);
  assert.equal(rejectedResult.unavailableReason,'account_suspended');
  assert.equal(rejected.clicks(),1,'Askıya alınan hesaba yeniden gönderilmemeli');
  const rejectedExisting=setup({mode:'live',rejectedExisting:true});
  const existingResult=await rejectedExisting.api.sendInstantMessage('esra','hello');
  assert.equal(existingResult.unavailableReason,'account_suspended');
  assert.equal(rejectedExisting.clicks(),0,'Eski kırmızı hata balonu yeniden gönderilmemeli');
  for(const options of [{noAck:true},{pending:true}]) {
    const uncertain=setup(options);
    await assert.rejects(()=>uncertain.api.sendInstantMessage('esra','hello'),/doğrulanamadı/);
    assert.equal(uncertain.clicks(),1,'Belirsiz gönderim tekrarlanmaz');
  }
  console.log('Backstage gönderim: doğru sohbet, tek gönderim, geçmiş, taslak, durdurma ve teslim işareti testleri geçti.');
})().catch(error=>{console.error(error);process.exitCode=1;});

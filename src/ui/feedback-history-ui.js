(() => {
  'use strict';
  const H=BTGFeedbackHistory,$=id=>document.getElementById(id);
  const store=H.createStore(chrome.storage.local,navigator.locks);
  let state=H.empty(),selected=null,dirty=false,page=0,visibleCreators=[];
  const pageSize=12;
  const say=text=>$('historyStatus').textContent=text;
  const fmt=d=>d?d.slice(0,10).split('-').reverse().join('.'):'Henüz yok';
  const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
  const append=(parent,tag,text)=>{const e=node(tag,text);parent.append(e);return e;};
  const recoveryKey=key=>'btg.feedback.editor.'+key;
  function rememberDraft(){if(!selected)return;const c=state.creators[selected];action(async()=>{await chrome.storage.local.set({[recoveryKey(selected)]:{value:draft(),base:JSON.stringify(c.draft),sentCount:c.sent.length}});});}
  async function action(fn){try{await fn();}catch(e){say(e.message);}}
  const ageLabel=c=>{const age=H.feedbackAge(c);return age.never?'Henüz verilmedi'+(age.days===null?'':' · katılalı '+age.days+' gün'):age.days===0?'Bugün verildi':age.days+' gün önce verildi';};
  const statusLabel=c=>H.matches(c,'sent_week')?'Bu hafta gönderildi':c.draft?'Taslak hazır':'Bu hafta bekliyor';
  function selectCreator(key){
    if(key===selected)return;
    if(dirty&&!confirm('Kaydedilmemiş değişiklikler var. Yayıncı değiştirmek istiyor musun?'))return;
    selected=key;dirty=false;
    const index=visibleCreators.findIndex(c=>c.key===key);if(index>=0)page=Math.floor(index/pageSize);
    render();detail();
    if(window.matchMedia?.('(max-width: 760px)').matches)$('creatorDetail').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function updateNavigation(){
    const index=visibleCreators.findIndex(c=>c.key===selected);
    $('prevCreator').disabled=index<=0;$('nextCreator').disabled=index<0||index>=visibleCreators.length-1;
  }
  function showTab(name){
    for(const tab of ['Overview','Message','History']){
      const active=tab.toLowerCase()===name,button=$('detailTab'+tab);
      button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
      $('detail'+tab).hidden=!active;
    }
  }
  function render(){
    const list=$('creatorRows');list.replaceChildren();
    const all=Object.values(state.creators),active=all.filter(c=>c.rosterActive!==false);
    visibleCreators=all.filter(c=>H.matches(c,$('historyFilter').value)&&c.username.toLowerCase().includes($('creatorSearch').value.trim().toLowerCase().replace(/^@/,''))).sort((a,b)=>a.username.localeCompare(b.username));
    $('creatorCount').textContent=active.length+' güncel yayıncı';
    $('weeklyTotal').textContent=active.length;
    const sent=active.filter(c=>H.matches(c,'sent_week')).length;
    $('weeklySent').textContent=sent;$('weeklyPending').textContent=active.length-sent;
    $('filteredCount').textContent=visibleCreators.length+' sonuç';
    const pages=Math.max(1,Math.ceil(visibleCreators.length/pageSize));page=Math.min(page,pages-1);
    for(const c of visibleCreators.slice(page*pageSize,(page+1)*pageSize)){
      const tr=node('tr','');tr.className=c.key===selected?'selected':'';tr.setAttribute('aria-selected',String(c.key===selected));
      const cell=append(tr,'td',''),button=append(cell,'button','@'+c.username);button.className='creator-link';button.onclick=()=>selectCreator(c.key);
      append(cell,'small','Katılım: '+(c.joinedRaw||'Bilinmiyor')).className='creator-joined';
      append(tr,'td',ageLabel(c));const status=append(tr,'td','');
      append(status,'span',statusLabel(c)).className='status-pill'+(H.matches(c,'sent_week')?' sent':c.draft?' draft':' pending');
      append(status,'small',!c.snapshots.length?'Henüz taranmadı':c.snapshots.at(-1)?.status===H.COMPLETE?'Veri hazır':'Kapsam eksik').className='creator-joined';
      list.append(tr);
    }
    $('creatorPageInfo').textContent=(page+1)+' / '+pages;
    $('creatorPrevPage').disabled=page===0;$('creatorNextPage').disabled=page>=pages-1;
    $('emptyHistory').hidden=visibleCreators.length>0;
    $('detailPlaceholder').hidden=!!state.creators[selected];updateNavigation();
  }
  function detail(){
    const c=state.creators[selected];$('creatorDetail').hidden=!c;if(!c)return;
    const latest=c.snapshots.at(-1),p=c.draft||H.period(c);
    $('detailTitle').textContent='@'+c.username;
    $('detailPlaceholder').hidden=true;
    $('detailJoined').textContent=c.joinedRaw||'Bilinmiyor';$('detailFeedbackAge').textContent=ageLabel(c);$('detailStatus').textContent=statusLabel(c);updateNavigation();
    $('identityNote').textContent=c.id?'Sabit yayıncı kimliği: '+c.id:'Kimlik kullanıcı adına bağlı. Kullanıcı adı değişirse geçmiş otomatik birleştirilmez.';
    $('messageFrom').value=p?.from||'';$('messageTo').value=p?.to||'';$('draftText').value=c.draft?.text||'';$('recommendations').value=c.draft?.recommendations||'';count();
    $('coverageWarnings').textContent=(latest?.warnings||[]).join('\n');
    const sum=latest?.summary||{};$('dataSummary').textContent=!latest?'Bu yayıncı listeden eklendi. Henüz performans verisi toplanmadı.':`Veri kapsamı: ${fmt(latest.from)} / ${fmt(latest.to)}. ${sum.dailyRows} günlük satır. Aktif gün: ${sum.activeDays??'Bilinmiyor'}. Elmas: ${sum.diamonds??'Bilinmiyor'}. Yeni takipçi: ${sum.newFollowers??'Bilinmiyor'}. Bu toplamlar tüm kayıt kapsamına aittir; haftalık karşılaştırma değildir.`;
    $('sentHistory').replaceChildren();
    for(const message of [...c.sent].reverse()){const item=node('details','');append(item,'summary',fmt(message.sentAt)+' tarihinde gönderildi • '+fmt(message.from)+' / '+fmt(message.to));append(item,'p',message.text).className='message-snapshot';if(message.recommendations)append(item,'p','Öneri notları: '+message.recommendations);$('sentHistory').append(item);}
    if(!c.sent.length)append($('sentHistory'),'p','Henüz gönderildi olarak işaretlenen mesaj yok.');
    if(chrome.storage.local.get){const key=selected;action(async()=>{const saved=(await chrome.storage.local.get(recoveryKey(key)))[recoveryKey(key)];if(selected!==key||dirty||!saved||saved.base!==JSON.stringify(c.draft)||saved.sentCount!==c.sent.length)return;const v=saved.value;$('draftText').value=v.text||'';$('messageFrom').value=v.from||'';$('messageTo').value=v.to||'';$('recommendations').value=v.recommendations||'';count();});}
  }
  function count(){$('wordCount').textContent=($('draftText').value.trim().match(/\S+/g)||[]).length+' sözcük';}
  const draft=()=>({text:$('draftText').value,from:$('messageFrom').value,to:$('messageTo').value,recommendations:$('recommendations').value});
  async function save(){if(!selected)throw Error('Önce yayıncı seç.');const key=selected,value=draft();state=await store.mutate(s=>H.saveDraft(s,key,value,new Date().toISOString()));dirty=false;render();say('Taslak kaydedildi.');}
  function download(name,value){const url=URL.createObjectURL(new Blob([value],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  window.BTGFeedbackRegister=async report=>{let key;state=await store.mutate(s=>{const result=H.register(s,report,BTGFeedback);key=result.key;return result.state;});render();if(!selected){selected=key;render();detail();}else if(selected===key&&!dirty)detail();};
  $('importReports').onchange=()=>action(async()=>{let ok=0;const errors=[];for(const file of $('importReports').files){try{if(file.size>20*1024*1024)throw Error('Dosya 20 MB sınırını aşıyor.');await window.BTGFeedbackRegister(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));ok++;}catch(e){errors.push(file.name+': '+e.message);}}say(ok+' yayıncı veri dosyası işlendi.'+(errors.length?'\n'+errors.join('\n'):''));$('importReports').value='';});
  $('importDraft').onchange=()=>action(async()=>{if(!selected)throw Error('Önce yayıncı seç.');const key=selected,file=$('importDraft').files[0];if(!file)return;if(file.name.toLowerCase()!==state.creators[key].username.toLowerCase()+'_geribildirim.txt')throw Error('Seçili yayıncı için '+state.creators[key].username+'_geribildirim.txt dosyasını seç.');if(file.size>100000)throw Error('Mesaj dosyası çok büyük.');const text=await file.text();if(selected!==key)throw Error('Yayıncı değişti. Dosyayı tekrar seç.');$('draftText').value=text.replace(/^\uFEFF/,'');dirty=true;count();rememberDraft();say('TXT mesaj alanına alındı. Tarihleri kontrol edip taslağı kaydet.');$('importDraft').value='';});
  $('saveDraft').onclick=()=>action(save);
  $('copyDraft').onclick=()=>action(async()=>{const text=$('draftText').value;await save();await navigator.clipboard.writeText(text);say('Mesaj kopyalandı. Gönderildi olarak işaretlenmedi.');});
  $('markSent').onclick=()=>action(async()=>{if(!selected)throw Error('Önce yayıncı seç.');const key=selected,value=draft();if(!confirm('@'+state.creators[key].username+' için ekrandaki mesajı gerçekten gönderdin mi?'))return;const now=new Date().toISOString();state=await store.mutate(s=>H.markSent(H.saveDraft(s,key,value,now),key,now));if(selected===key){dirty=false;detail();}render();say('Mesajın bu hâli gönderim geçmişine kaydedildi.');});
  $('exportHistory').onclick=()=>action(async()=>{state=await store.read();download('BTG_geri_bildirim_gecmisi_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({purpose:'Sonraki değerlendirme için geçmiş bağlamı. Sadece sent kayıtları gönderilmiş mesajdır. draft gönderilmemiştir. Ham veri dosyalarını ayrıca kullan. İyileşmeyi önerinin uygulandığına veya nedenselliğe kanıt sayma.',...state},null,2));say('Geçmiş bağlamı indirildi. Sonraki analizde yeni veri klasörüyle birlikte ver.');});
  for(const id of ['draftText','messageFrom','messageTo','recommendations'])$(id).oninput=()=>{dirty=true;count();rememberDraft();};
  $('historyFilter').onchange=()=>{page=0;render();};$('creatorSearch').oninput=()=>{page=0;render();};
  $('creatorPrevPage').onclick=()=>{page=Math.max(0,page-1);render();};
  $('creatorNextPage').onclick=()=>{page++;render();};
  $('prevCreator').onclick=()=>{const i=visibleCreators.findIndex(c=>c.key===selected);if(i>0)selectCreator(visibleCreators[i-1].key);};
  $('nextCreator').onclick=()=>{const i=visibleCreators.findIndex(c=>c.key===selected);if(i>=0&&i<visibleCreators.length-1)selectCreator(visibleCreators[i+1].key);};
  const tabs=['Overview','Message','History'];
  for(const [index,tab] of tabs.entries()){
    $('detailTab'+tab).onclick=()=>showTab(tab.toLowerCase());
    $('detailTab'+tab).onkeydown=e=>{let next;if(e.key==='ArrowRight')next=(index+1)%3;else if(e.key==='ArrowLeft')next=(index+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;else return;e.preventDefault();showTab(tabs[next].toLowerCase());$('detailTab'+tabs[next]).focus();};
  }
  showTab('overview');
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[H.KEY])action(async()=>{state=await store.read();render();if(!dirty)detail();});});
  action(async()=>{state=await store.read();render();});
})();

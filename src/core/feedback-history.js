(function(root){
  'use strict';
  const KEY='btg.feedback.history.v1', COMPLETE='requested_daily_range_and_available_tables_complete';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const empty=()=>({version:1,creators:{}});
  const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value).toISOString().slice(0,10)===value;
  function identity(report){
    if(!/^[A-Za-z0-9_.]{1,30}$/.test(report.username||''))throw Error('Geçerli yayıncı kullanıcı adı bulunamadı.');
    const rosterId=String(report.roster?.['İçerik üreticisi']||'').match(/(?:^|\s)(\d{10,25})(?=\s|$)/)?.[1];
    const explicit=report.creatorId??report.creator_id;
    if(explicit!==undefined&&(typeof explicit!=='string'||!/^\d{10,25}$/.test(explicit)))throw Error('Yayıncı kimliği metin olarak saklanmalı.');
    const id=explicit||rosterId;
    if(explicit&&rosterId&&explicit!==rosterId)throw Error('Yayıncı kimlikleri eşleşmiyor.');
    return {key:id?'id:'+id:'username:'+report.username.toLowerCase(),id:id||null,username:report.username};
  }
  function resolveIdentity(state,report){
    const ident=identity(report),all=Object.values(state.creators||{});
    let found=ident.id?all.find(c=>c.id===ident.id):null;
    if(!found){const same=all.filter(c=>String(c.username||'').toLowerCase()===ident.username.toLowerCase()&&(!ident.id||!c.id));if(same.length===1)found=same[0];}
    return found?{...ident,key:found.key,id:ident.id||found.id||null}:ident;
  }
  function recentFeedback(state,report,now=new Date().toISOString()){
    const c=state.creators?.[resolveIdentity(state,report).key],end=Date.parse(now),cutoff=end-7*86400000;
    if(!c||!Number.isFinite(end))return null;
    for(const sent of [...(c.sent||[])].sort((a,b)=>Date.parse(b.sentAt)-Date.parse(a.sentAt))){
      const at=Date.parse(sent.sentAt);if(!Number.isFinite(at)||at<=cutoff||at>end)continue;
      const snapshot=(c.snapshots||[]).find(s=>{
        const scanned=Date.parse(s.source?.collectedAt||s.id);
        return Number.isFinite(scanned)&&scanned>cutoff&&scanned<=at&&!['error','stopped'].includes(s.status)&&(!sent.sourceSnapshotId||sent.sourceSnapshotId===s.id);
      });
      if(snapshot)return {sentAt:sent.sentAt,collectedAt:snapshot.source?.collectedAt||snapshot.id,reason:'recent_scan_and_feedback'};
    }
    return null;
  }
  function syncRoster(state,rows,now,core){
    if(!Array.isArray(rows)||!rows.length)throw Error('Boş ajans listesi eski kayıtların üzerine yazılmadı.');
    const seen=new Set(),names=new Set(),validated=rows.map(roster=>{const username=String(roster['İçerik üreticisi']||'').trim().split(/\s+/)[0],joinedRaw=String(roster['Katılma saati']||'').trim(),joinedDate=core.iso(joinedRaw),ident=resolveIdentity(state,{username,roster});
      if(!date(joinedDate))throw Error('@'+username+': katılma tarihi okunamadı.');
      if(seen.has(ident.key)||names.has(username.toLowerCase()))throw Error('Listede tekrarlanan yayıncı var.');seen.add(ident.key);names.add(username.toLowerCase());return {ident,joinedRaw,joinedDate};});
    const s=clone(state);for(const c of Object.values(s.creators))c.rosterActive=false;
    for(const {ident,joinedRaw,joinedDate} of validated){const c=s.creators[ident.key]||(s.creators[ident.key]={...ident,aliases:[],snapshots:[],draft:null,sent:[]});
      c.id=ident.id;c.id=ident.id;c.username=ident.username;if(!c.aliases.includes(c.username))c.aliases.push(c.username);
      c.joinedRaw=joinedRaw;c.joinedDate=joinedDate;c.rosterActive=true;c.rosterSeenAt=now;
    }
    s.rosterUpdatedAt=now;return s;
  }
  function feedbackAge(c,now=new Date().toISOString()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));const part=k=>parts.find(x=>x.type===k).value;
    const today=part('year')+'-'+part('month')+'-'+part('day');
    const sent=c.sent.filter(x=>Number.isFinite(Date.parse(x.sentAt))).sort((a,b)=>Date.parse(b.sentAt)-Date.parse(a.sentAt))[0];
    if(sent){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(sent.sentAt));const v=k=>p.find(x=>x.type===k).value;const d=v('year')+'-'+v('month')+'-'+v('day');return {sentAt:sent.sentAt,days:Math.max(0,Math.round((Date.parse(today)-Date.parse(d))/86400000)),never:false};}
    return {sentAt:null,days:date(c.joinedDate)?Math.max(0,Math.round((Date.parse(today)-Date.parse(c.joinedDate))/86400000)):null,never:true};
  }
  function register(state,report,core){
    const ident=resolveIdentity(state,report);
    if(report.schemaVersion!==1||!Array.isArray(report.performance)||!Array.isArray(report.warnings)||!date(report.requestedEnd)||!Number.isFinite(Date.parse(report.collectedAt)))throw Error('Bu dosya desteklenen yayıncı veri JSON dosyası değil.');
    const s=clone(state),c=s.creators[ident.key]||(s.creators[ident.key]={...ident,aliases:[],snapshots:[],draft:null,sent:[]});
    c.username=ident.username;if(!c.aliases.includes(ident.username))c.aliases.push(ident.username);
    const fields=['Tarih','CANLI Yayın süresi','Elmaslar','Yeni takipçiler','Görüntülemeler','İzleyici başına ort. izleme süresi'];
    const daily=report.performance.flatMap(p=>(p.rows||[]).map(r=>Object.fromEntries(fields.filter(f=>r[f]!==undefined).map(f=>[f,r[f]]))));
    const analysis=core.analyze(report);
    const snapshot={id:report.collectedAt,from:report.requestedStart,to:report.requestedEnd,status:report.status,warnings:report.warnings,
      summary:Object.fromEntries(['dailyRows','from','to','activeDays','durationSeconds','diamonds','newFollowers','diamondsPerHour','newFollowersPerHour'].map(k=>[k,analysis[k]??null])),daily,
      source:{collectedAt:report.collectedAt,username:report.username,dayTimeZone:'UTC',sessionsTimeZone:'unverified'}};
    if(!c.snapshots.some(x=>x.id===snapshot.id))c.snapshots.push(snapshot);
    c.snapshots.sort((a,b)=>a.id.localeCompare(b.id));
    return {state:s,key:ident.key};
  }
  function saveDraft(state,key,{text,from,to,recommendations},now){
    if(!text?.trim())throw Error('Önce mesajı yaz veya TXT dosyasından yükle.');
    if(!date(from)||!date(to)||from>to)throw Error('Geçerli bir değerlendirme dönemi seç.');
    const s=clone(state),c=s.creators[key];if(!c)throw Error('Yayıncı kaydı bulunamadı.');
    const latest=c.snapshots.at(-1);
    if(!latest||!date(latest.from)||from<latest.from||to>latest.to)throw Error('Mesaj dönemi son kaydın doğrulanmış tarih kapsamı içinde olmalı.');
    c.draft={text:text.trim(),from,to,recommendations:(recommendations||'').trim(),updatedAt:now,sourceSnapshotId:latest.id};
    return s;
  }
  function markSent(state,key,now){
    const s=clone(state),c=s.creators[key];if(!c?.draft)throw Error('Önce taslağı kaydet.');
    const d=c.draft;
    if(c.sent.some(x=>x.text===d.text&&x.from===d.from&&x.to===d.to))throw Error('Bu mesaj bu dönem için zaten gönderildi olarak işaretlenmiş.');
    c.sent.push({...clone(d),sentAt:now,method:'user_marked',id:now});c.draft=null;return s;
  }
  function period(c){const snap=c.snapshots.at(-1);if(!snap)return null;const start=new Date(Date.parse(snap.to)-6*86400000).toISOString().slice(0,10);return {from:start<snap.from?snap.from:start,to:snap.to};}
  function sendWeek(value){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));const val=k=>parts.find(p=>p.type===k).value;const d=new Date(val("year")+"-"+val("month")+"-"+val("day")+"T00:00:00Z");d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
  function matches(c,filter,now=new Date().toISOString()){if(filter==='inactive')return c.rosterActive===false;if(c.rosterActive===false)return false;if(filter==='sent_week'||filter==='unsent_week'){const sent=c.sent.some(m=>m.sentAt&&sendWeek(m.sentAt)===sendWeek(now));return filter==='sent_week'?sent:!sent;}const p=period(c);if(filter==='draft')return !!c.draft;if(filter==='unsent')return !!p&&!c.sent.some(x=>x.from<=p.from&&x.to>=p.to);if(filter==='incomplete')return c.snapshots.at(-1)?.status!==COMPLETE;return true;}
  function createStore(storage,lock){
    let queue=Promise.resolve();
    const read=async()=>{const result=await storage.get(KEY);const state=result[KEY]||empty();if(state.version!==1||!state.creators)throw Error('Kayıt biçimi desteklenmiyor.');return state;};
    const mutate=fn=>{const run=async()=>{const state=await read(),next=fn(state);await storage.set({[KEY]:next});return next;};const task=()=>lock?lock.request(KEY,run):run();const result=queue.then(task);queue=result.catch(()=>{});return result;};
    return {read,mutate};
  }
  const api={KEY,COMPLETE,empty,identity,resolveIdentity,recentFeedback,syncRoster,feedbackAge,register,saveDraft,markSent,period,sendWeek,matches,createStore};
  if(typeof module!=='undefined')module.exports=api;root.BTGFeedbackHistory=api;
})(globalThis);


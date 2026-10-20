(function(root){
  'use strict';
  const KEY='btg.feedback.queue.v1', HISTORY='btg.feedback.history.v1', PACKAGES='btg.feedback.packages.v1';
  const copy=x=>JSON.parse(JSON.stringify(x));
  function week(value){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
    const get=k=>parts.find(p=>p.type===k).value;
    const d=new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);
  }
  function create({storage,validateRows,send,now=()=>new Date().toISOString(),lock,pause=()=>Promise.resolve()}){
    let active=false,stopRequested=false,serial=Promise.resolve();
    const exclusive=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p;};
    const locked=fn=>lock?lock.request(HISTORY,fn):fn();
    const read=async()=> (await storage.get(KEY))[KEY]||null;
    const save=q=>storage.set({[KEY]:q});
    const recovered=(async()=>{const q=await read();if(!q)return;
      for(const r of q.rows)if(r.status==='in_flight'){r.status='needs_review';r.error='Gönderim sırasında bağlantı kesildi. Sohbeti elle kontrol edin.';}
      if(['running','stopping'].includes(q.status))q.status=q.rows.some(r=>r.status==='needs_review')?'needs_review':'paused';
      await save(q);
    })();
    async function status(){await recovered;const q=await read();if(q&&active&&stopRequested)q.status='stopping';return {ok:true,queue:q};}
    async function run(){
      try{
        while(!stopRequested){
          let q=await read(),r=q.rows.find(r=>r.status==='pending');if(!r)break;
          const h=(await storage.get(HISTORY))[HISTORY]||{version:1,creators:{}};
          const c=h.creators[r.creatorKey];
          if(!c)throw Error('Yayıncı geçmiş kaydı bulunamadı.');
          // Named scans and roster scans may use different creator keys. Check
          // current names as well, without merging records or trusting aliases.
          const sameCreator=Object.entries(h.creators).filter(([key,value])=>key===r.creatorKey||String(value.username||'').toLowerCase()===r.username.toLowerCase());
          if(sameCreator.some(([,value])=>(value.sent||[]).some(s=>s.sentAt&&week(s.sentAt)===week(now())))){r.status='skipped_week';await save(q);continue;}
          // Durable marker must precede every external effect. Never automatically retry this state.
          r.status='in_flight';r.startedAt=now();await save(q);
          let result;try{result=await send(r.username,r.message,q.controllerTabId,q.backstageTabId);}catch(e){result={ok:false,error:e.message};}
          await locked(async()=>{
            q=await read();r=q.rows.find(x=>x.recordKey===r.recordKey);
            if(result?.ok&&result.verifiedInConversation===true&&!result.unavailableSkipped&&!result.followerSkipped&&!result.alreadySent){
              const history=(await storage.get(HISTORY))[HISTORY];const creator=history?.creators[r.creatorKey];
              if(!creator)throw Error('Gönderim doğrulandı ancak geçmiş kaydı bulunamadı.');
              r.status='sent';r.sentAt=now();
              creator.sent.push({id:`${q.packageId}:${r.recordKey}`,recommendationIds:r.recommendationIds||[],recommendationFamilies:r.recommendationFamilies||[],text:r.message,from:r.from,to:r.to,recommendations:r.recommendations||'',sourceSnapshotId:r.sourceSnapshotId,sentAt:r.sentAt,updatedAt:r.sentAt,method:'conversation_verified',packageId:q.packageId,recordKey:r.recordKey});
              await storage.set({[HISTORY]:history,[KEY]:q});
            }else{
              r.status=result?.unavailableSkipped||result?.followerSkipped?'unavailable':'needs_review';
              r.error=result?.error||result?.unavailableReason||'Gönderim doğrulanamadı; sohbeti elle kontrol edin.';
              if(r.status==='needs_review')stopRequested=true;
              await save(q);
            }
          });
          if(!stopRequested)await pause();
        }
      }catch(e){const q=await read();if(q){const r=q.rows.find(x=>x.status==='in_flight');if(r){r.status='needs_review';r.error=e.message;}q.error=e.message;q.status='needs_review';await save(q);}}
      finally{const q=await read();if(q){q.status=q.rows.some(r=>r.status==='needs_review')||q.error?'needs_review':q.rows.some(r=>r.status==='pending')?'paused':'completed';await save(q);}active=false;}
    }
    const start=args=>exclusive(async()=>{
      await recovered;if(active)throw Error('Geri bildirim gönderimi zaten çalışıyor.');
      const stored=await storage.get([PACKAGES,'runtime']);if(stored.runtime?.running)throw Error('Önce normal otomasyonu durdurun.');
      const pkg=stored[PACKAGES]?.packages?.[args.packageId];if(!pkg)throw Error('Özgün veri paketi bulunamadı.');
      const checked=validateRows(pkg,args.rows);if(checked.errors.length||!checked.rows.length)throw Error(checked.errors.join('\n')||'Gönderilecek mesaj yok.');
      const previous=await read();if(previous?.rows.some(r=>['in_flight','needs_review'].includes(r.status)))throw Error('Önce belirsiz gönderimleri kontrol edip kuyruktan çıkarın.');
      let q;
      if(previous?.packageId===pkg.id){
        if(JSON.stringify(previous.rows.map(r=>[r.recordKey,r.message]))!==JSON.stringify(checked.rows.map(r=>[r.recordKey,r.message])))throw Error('Mevcut kuyruğun alıcıları veya mesajları değiştirilemez. Yeni paket oluşturun.');
        q=previous;
        // Eski geri bildirim akışında ajans yayıncıları davet uygunluğuna göre
        // atlanmış olabilir. Bu satırlar henüz gönderilmedi; yeni Backstage
        // geri bildirim yoluyla güvenle yeniden kuyruğa alınabilir.
        for(const row of q.rows)if(row.status==='unavailable'&&['Uygun değil','not_eligible'].includes(row.error)){
          row.status='pending';delete row.error;delete row.startedAt;
        }
      }else q={version:1,packageId:pkg.id,createdAt:now(),rows:checked.rows.map(r=>({...copy(r),...copy(pkg.records.find(p=>p.recordKey===r.recordKey)),message:r.message,recommendations:r.recommendations||'',status:'pending'}))};
      q.status='running';q.controllerTabId=args.controllerTabId;q.backstageTabId=args.backstageTabId;delete q.error;stopRequested=false;active=true;
      try{await save(q);}catch(e){active=false;throw e;}void run();return {ok:true,queue:q};
    });
    // Only the worker mutates its running queue. STOP changes an in-memory latch,
    // so it cannot overwrite a concurrent durable send result with a stale copy.
    // A suspended worker never auto-resumes, regardless of this latch.
    const stop=async()=>{await recovered;stopRequested=true;return status();};
    const resolve=args=>exclusive(async()=>{await recovered;if(active)throw Error('Önce gönderimi durdurun.');const q=await read();const r=q?.rows.find(r=>r.recordKey===args.recordKey);if(args.action!=='dismiss'||r?.status!=='needs_review')throw Error('Geçersiz çözüm işlemi.');r.status='dismissed';r.resolvedAt=now();delete q.error;q.status=q.rows.some(r=>r.status==='needs_review')?'needs_review':'paused';await save(q);return {ok:true,queue:q};});
    return {start,stop,status,resolve,isActive:()=>active};
  }
  const api={KEY,HISTORY,PACKAGES,week,create};root.BTGFeedbackQueue=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);

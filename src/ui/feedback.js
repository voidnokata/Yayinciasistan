(() => {
  const $=id=>document.getElementById(id),C=BTGFeedback;
  let folder=null,stopped=false,running=false,owned=new Set();
  const log=text=>{$('log').textContent+=text+'\n';$('log').scrollTop=$('log').scrollHeight;};
  const check=()=>{if(stopped)throw Error('Kullanıcı durdurdu.');};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let folderTouched=false;
  async function displayFolder(){if(!folder)return;const granted=await folder.queryPermission({mode:'readwrite'})==='granted';$('folderName').textContent=folder.name+(granted?'':' · izin yenilenmeli');}
  const folderReady=(async()=>{try{const saved=await BTGOutput.handle?.(undefined,'feedback-directory');if(!folderTouched&&saved){folder=saved;await displayFolder();}}catch(e){$('status').textContent='Kayıt klasörü geri yüklenemedi: '+e.message;}})();
  $('folder').onclick=async()=>{folderTouched=true;try{const chosen=await showDirectoryPicker({mode:'readwrite',startIn:folder||'desktop',id:'btg-feedback'});await BTGOutput.handle?.(chosen,'feedback-directory');folder=chosen;await displayFolder();}catch(e){if(e.name!=='AbortError')$('status').textContent=e.message;}};
  $('stop').onclick=()=>{stopped=true;$('status').textContent='Mevcut okuma bitince durduruluyor; kaydedilen dosyalar korunur.';};
  window.addEventListener('beforeunload',e=>{if(running){e.preventDefault();e.returnValue='';}});
  async function read(id,command='read',extra={}) {
    check();
    let timer;
    try{
      const response=await Promise.race([
        chrome.tabs.sendMessage(id,{type:'BTG_FEEDBACK_READ',command,...extra},{frameId:0}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Okuma süresi aşıldı. Bu okuma tamamlanamadı.')),90000);})
      ]);
      check();if(!response?.ok)throw Error(response?.error||'Veri okuyucu yanıt vermedi.');return response.data;
    }finally{clearTimeout(timer);}
  }
  async function open(url,windowId){
    check();const t=await chrome.tabs.create({url,active:false,windowId});owned.add(t.id);
    try{
    const until=Date.now()+40000;
    while(Date.now()<until){check();const state=await chrome.tabs.get(t.id);if(state.status==='complete'){await sleep(1200);return t.id;}await sleep(300);}
    throw Error('Backstage yüklenemedi.');
    }catch(e){await close(t.id);throw e;}
  }
  async function close(id){if(owned.has(id)){await chrome.tabs.remove(id).catch(()=>{});owned.delete(id);}}
  const retryable=e=>!/kimliği eşleşmiyor|Kullanıcı durdurdu/.test(e.message)&&/süresi aşıldı|zamanında hazır|yüklenemedi|yanıt vermedi|Tarih aralığı|Takvim|message (channel|port) closed|Receiving end does not exist|Could not establish connection|Extension context invalidated|No tab with id/i.test(e.message);
  async function freshRead(url,windowId,scope,report,work){
    let partial=null;
    for(let attempt=0;attempt<2;attempt++){
      let id;
      try{id=await open(url,windowId);return await work(id);}
      catch(e){
        if(e.partialSnapshot&&(!partial||e.partialSnapshot.rows.length>partial.rows.length))partial=e.partialSnapshot;
        if(stopped||attempt===1||!retryable(e)){
          if(partial)e.partialSnapshot=partial;
          throw e;
        }
        report.recoveryAttempts.push({scope,attempt:2,error:e.message});
        log('@'+report.username+' · '+scope+' · okuma yeniden açılan sekmede bir kez deneniyor.');
      }finally{if(id!==undefined)await close(id);}
      check();await sleep(500);
    }
  }
  async function pages(id,first,username){
    let snap=first;const rows=[],seen=new Set(),headers=first.headers;
    const total=first.paging.total;
    if(first.paging.hasPrevious)throw Error('Tablo ilk sayfadan başlamadı.');
    try{for(let page=0;page<1000;page++){
      check();if(JSON.stringify(snap.headers)!==JSON.stringify(headers))throw Error('Sayfalar arasında sütunlar değişti.');
      const signature=JSON.stringify(snap.rows);if(seen.has(signature))throw Error('Sayfalama ilerlemiyor; tekrarlı kayıt önlendi.');seen.add(signature);
      if(snap.paging.total!==total)throw Error('Tarama sırasında tablo toplamı değişti. Yeniden deneyin.');
      rows.push(...snap.rows);
      if(!snap.paging.hasNext){
        if(total!==null&&rows.length!==total)throw Error(`Eksik sayfalama: ${rows.length}/${total} kayıt.`);
        if(total===null&&rows.length===0&&!/veri yok|veri bulunamadı|kayıt yok|no data/i.test(snap.summary))throw Error('Boş tablo doğrulanamadı.');
        const unpagedRegion=first.tab==='Bölgeye göre performans'&&!snap.paging.nextPresent&&first.renderedRowCount===rows.length;
        return {...first,rows,tableComplete:total!==null||unpagedRegion||/veri yok|veri bulunamadı|kayıt yok|no data/i.test(snap.summary),paging:{...snap.paging,total}};
      }
      snap=await read(id,'next',username?{username}:{});
    }
    throw Error('Sayfa sınırına ulaşıldı.');
    }catch(e){
      if(rows.length)e.partialSnapshot={...first,rows,tableComplete:false,paging:{...snap.paging,total},pageError:e.message};
      throw e;
    }
  }
  function rosterRows(snapshot){
    if(!snapshot.headers.includes('İçerik üreticisi')||!snapshot.headers.includes('Katılma saati'))throw Error('Yayıncı listesi sütunları bulunamadı.');
    const names=new Set();return snapshot.rows.map(r=>{
      const username=r['İçerik üreticisi'].split(/\s+/)[0];
      if(!/^[A-Za-z0-9_.]{1,30}$/.test(username))throw Error('Kullanıcı adı okunamadı.');
      if(names.has(username))throw Error('Yayıncı listesinde tekrar var: '+username);names.add(username);
      return {username,joined:r['Katılma saati'],roster:r};
    });
  }
  async function collect(person,windowId,end){
    const report={schemaVersion:1,username:person.username,collectedAt:new Date().toISOString(),requestedStart:C.iso(person.joined),requestedEnd:end,
      status:'partial',roster:person.roster||null,performance:[],regions:[],sessions:null,warnings:[],recoveryAttempts:[],collectionIssues:[]};
    const detail='https://live-backstage.tiktok.com/portal/anchor/detail?username='+encodeURIComponent(person.username);
    const issue=(scope,e,period=null)=>{report.warnings.push(scope+(period?' '+period.start+' / '+period.end:'')+': '+e.message);
      report.collectionIssues.push({scope,requested:period,error:e.message});};
    try{
      try{
        report.sessions=await freshRead(detail+'&activeTab=videos&enter_from=anchor_list_page',windowId,'CANLI Yayınlar',report,async id=>{
          const first=await read(id,'read',{username:person.username});
          report.management=first.management;report.profileStats=first.profileStats;
          report.requestedStart=report.requestedStart||C.iso(first.management);
          report.browserTimeZone=first.browserTimeZone;
          const sessions=first.tab==='CANLI Yayınlar'?first:await read(id,'tab',{name:'CANLI Yayınlar',username:person.username});
          return pages(id,sessions,person.username);
        });
      }catch(e){
        if(stopped||/kimliği eşleşmiyor/.test(e.message))throw e;
        if(e.partialSnapshot)report.sessions=e.partialSnapshot;
        issue('CANLI Yayınlar',e);
      }
      report.warnings.push('Oturum tablosunun saat dilimi ekranda belirtilmeyebilir. Günlük ve bölgesel verilerdeki UTC etiketi bu tabloya uygulanmaz.');
      if(!report.requestedStart)throw Error('Katılım tarihi okunamadı; tam geçmiş aralığı belirlenemedi.');
      const periods=C.collectionRanges(report.requestedStart,end);
      for(const name of ['CANLI Yayın performansı','Bölgeye göre performans']){
        const dest=name==='CANLI Yayın performansı'?report.performance:report.regions;
        for(const [index,period] of periods.entries()){
          check();log('@'+person.username+' · '+name+' · '+period.start+' / '+period.end);
          // Backstage can withhold yesterday's daily row early in the day; allow the newest range to end up to two days earlier.
          const newest=name==='CANLI Yayın performansı'&&period.end===end;
          try{
            let available=period;
            const data=await freshRead(detail,windowId,name+' '+period.start+' / '+period.end,report,async id=>{
              await read(id,'tab',{name,username:person.username});
              const snap=await read(id,'range',{...period,...(newest?{maxLagDays:2}:{}),username:person.username});
              if(snap.filters.length)throw Error('Sadece eşleşme filtresi açık; genel veri alınamadı.');
              available=newest&&/^\d{4}-\d{2}-\d{2}$/.test(snap.availableEnd||'')&&snap.availableEnd>=period.start&&snap.availableEnd<period.end?{...period,end:snap.availableEnd}:period;
              const result=await pages(id,snap,person.username);
              if(name==='CANLI Yayın performansı'){
                const dates=result.rows.map(r=>C.iso(r.Tarih));
                const expected=(Date.parse(available.end)-Date.parse(available.start))/86400000+1;
                if(dates.length!==expected||new Set(dates).size!==expected||dates.some(d=>!d||d<available.start||d>available.end))throw Error('Günlük tabloda istenen tarihlerin tümü doğrulanamadı.');
              }
              return result;
            });
            if(available!==period){
              // Keep every analysis window on the same last day: regions and the report end follow the daily table.
              periods[index]=available;report.requestedEnd=available.end;
              report.warnings.push(`CANLI Yayın performansı: ${period.end} günü Backstage takviminde henüz seçilemiyordu. Veri kapsamı ${available.end} tarihinde bitirildi.`);
              log('@'+person.username+' · '+period.end+' henüz hazır değil; kapsam '+available.end+' tarihinde bitirildi.');
            }
            dest.push({...data,requested:available});
          }catch(e){
            if(stopped||/kimliği eşleşmiyor/.test(e.message))throw e;
            // One failed historical range must not discard later ranges or usable recent data.
            issue(name,e,period);
          }
        }
      }
      const expected=periods.length;
      const complete=report.performance.length===expected&&report.regions.length===expected&&report.sessions?.tableComplete&&report.performance.every(p=>p.tableComplete)&&report.regions.every(p=>p.tableComplete);
      report.status=complete?'requested_daily_range_and_available_tables_complete':'partial';
      report.warnings.push('Tamamlandı durumu yalnız istenen günlük tarih aralığını ve arayüzün sunduğu tablo sayfalarını ifade eder; tüm tarihsel yayın oturumlarının saklandığını kanıtlamaz.');
      if(!expected)report.warnings.push('Katılım bugün veya gelecekte: tamamlanmış gün bulunmuyor.');
    }catch(e){report.warnings.push(e.message);if(stopped)report.status='stopped';}
    report.minimumSessionDuration=C.minimumSessionDuration(report.sessions?.rows||[]);
    return report;
  }
  $('start').onclick=async()=>{
    await folderReady;
    if(running)return;
    if((typeof location!=='undefined'?new URLSearchParams(location.search).get('embedded'):null)==='1'){await chrome.tabs.create({url:chrome.runtime.getURL('src/ui/feedback.html')});return;}
    if(!folder){$('status').textContent='Önce masaüstünde kayıt klasörünü seç.';return;}
    running=true;stopped=false;$('start').disabled=true;$('folder').disabled=true;$('scope').disabled=true;$('stop').disabled=false;$('log').textContent='';
    const reports=[];
    let runDir;const manifest={startedAt:new Date().toISOString(),status:'running',creators:[],errors:[]};
    try{
      if(await folder.queryPermission({mode:'readwrite'})!=='granted'&&await folder.requestPermission({mode:'readwrite'})!=='granted')throw Error('Klasör yazma izni gerekli.');
      const tabs=await chrome.tabs.query({url:'https://live-backstage.tiktok.com/*'});
      const source=tabs.find(t=>t.url?.includes('/portal/anchor/detail'))||tabs[0];
      if(!source)throw Error('Önce Backstage ekranını aç ve giriş yap.');
      runDir=await folder.getDirectoryHandle('BTG_Geribildirim_'+new Date().toISOString().replace(/[:.]/g,'-'),{create:true});
      const write=(name,value)=>BTGOutput.write(runDir,name,new Blob([value],{type:'text/plain;charset=utf-8'}));
      await write('00_geri_bildirim_yonergesi.txt',C.prompt+'\nAJANSIN VERDİĞİ HEDEFLER\n'+($('targets').value.trim()||'Belirtilmedi. Hedef uydurma.'));
      let creators;
      if($('scope').value==='named'){
        const username=$('namedUsername').value.trim().replace(/^@/,'');if(!/^[A-Za-z0-9_.]{1,30}$/.test(username))throw Error('Geçerli bir yayıncı kullanıcı adı yaz.');creators=[{username}];
      }else if($('scope').value==='current'){
        const username=new URL(source.url).searchParams.get('username');if(!username)throw Error('Bir yayıncı detay sayfasını açık tut.');creators=[{username}];
      }else{
        $('status').textContent='Ajans yayıncı listesi okunuyor…';
        const rosterId=await open('https://live-backstage.tiktok.com/portal/anchor/list',source.windowId);
        try{const roster=await pages(rosterId,await read(rosterId));creators=rosterRows(roster);manifest.rosterComplete=roster.tableComplete;if(!roster.tableComplete)throw Error('Ajans listesinin tamamı doğrulanamadı.');}finally{await close(rosterId);}
      }
      manifest.totalListedCreators=creators.length;manifest.skippedCreators=[];
      if($('scope').value==='all'&&typeof BTGFeedbackHistory!=='undefined'){
        const H=BTGFeedbackHistory,history=(await chrome.storage.local.get(H.KEY))[H.KEY]||H.empty();
        creators=creators.filter(person=>{const recent=H.recentFeedback(history,person,manifest.startedAt);if(!recent)return true;manifest.skippedCreators.push({username:person.username,...recent});log('@'+person.username+' · atlandı: son 7 günde tarandı ve geri bildirim gönderildi.');return false;});
      }
      manifest.expectedCreators=creators.length;$('progress').max=Math.max(creators.length,1);$('progress').value=0;
      const end=new Date(Date.now()-86400000).toISOString().slice(0,10);
      // Parallel reads have isolated tabs; shared history and output commits stay ordered.
      let cursor=0,fatal=null,commitTail=Promise.resolve();
      const active=new Set();
      manifest.concurrency=Math.min(4,creators.length);
      const progress=()=>{$('status').textContent=`${manifest.creators.length}/${creators.length} kaydedildi · Taranıyor: ${[...active].map(n=>'@'+n).join(', ')}`;};
      async function commit(person,report){
        await write(person.username+'.json',JSON.stringify(report,null,2));reports.push(report);await write(person.username+'.txt',C.txt(report));
        if(window.BTGFeedbackRegister)try{await window.BTGFeedbackRegister(report);}catch(e){log('Geçmiş kaydı eklenemedi; dosyalar diskte korundu: '+e.message);}
        manifest.creators.push({username:person.username,status:report.status,warnings:report.warnings});
        $('progress').value=manifest.creators.length;log('@'+person.username+' · kaydedildi · '+report.status);
        for(const warning of report.warnings)log('  '+warning);
        if(!stopped&&report.warnings.some(w=>/süresi aşıldı|kimliği eşleşmiyor/.test(w)))log('@'+person.username+' için okuma tamamlanamadı; eksik kapsam kaydedildi, sıradaki yayıncıya geçiliyor.');
      }
      async function worker(){
        while(!stopped&&!fatal&&cursor<creators.length){
          const person=creators[cursor++];active.add(person.username);progress();
          try{
            const report=await collect(person,source.windowId,end);
            const pending=commitTail.then(()=>{if(fatal)throw fatal;return commit(person,report);});
            commitTail=pending.catch(e=>{fatal=fatal||e;});
            await pending;
          }catch(e){fatal=fatal||e;}
          finally{active.delete(person.username);if(!stopped)progress();}
        }
      }
      await Promise.all(Array.from({length:manifest.concurrency},()=>worker()));
      if(fatal)throw fatal;
      check();
      manifest.incompleteCreators=manifest.creators.filter(c=>c.status!=='requested_daily_range_and_available_tables_complete').length;
      manifest.status=manifest.incompleteCreators?'finished_with_warnings':'finished';$('status').textContent=`${manifest.creators.length} yayıncı dosyası kaydedildi; ${manifest.incompleteCreators} yayıncıda kapsam eksik. Klasör: ${runDir.name}. Ayrıntılar: 00_oturum.json.`;
      if(manifest.skippedCreators.length)$('status').textContent+=' '+manifest.skippedCreators.length+' yayıncı son 7 günde işlem tamamlandığı için atlandı.';
      if(!creators.length){$('status').textContent='Taranması gereken yayıncı yok. '+manifest.skippedCreators.length+' yayıncı son 7 günde taranmış ve geri bildirimi gönderilmiş.';$('progress').value=1;}
    }catch(e){manifest.status=stopped?'stopped':'error';manifest.errors.push(e.message);$('status').textContent=e.message;log(e.message);}
    finally{
      manifest.finishedAt=new Date().toISOString();
      if(runDir && reports.length && typeof BTGFeedbackPackage!=='undefined')try{
        const eligible=reports.filter(r=>r.requestedStart&&r.requestedStart<=r.requestedEnd&&Array.isArray(r.performance));
        if(eligible.length!==reports.length)log((reports.length-eligible.length)+' yayıncı: analiz edilebilir tarih/veri bulunamadığı için MD paketine alınmadı.');
        if(eligible.length){
          const history=(await chrome.storage.local.get(BTGFeedbackHistory.KEY))[BTGFeedbackHistory.KEY]||BTGFeedbackHistory.empty();
          const pack=BTGFeedbackPackage.create(eligible,history,C,$('targets').value.trim());
          await BTGFeedbackPackage.save(chrome.storage.local,pack.manifest);
          await BTGOutput.write(runDir,'01_ChatGPT_geri_bildirim.md',new Blob([pack.markdown],{type:'text/markdown;charset=utf-8'}));
          manifest.packageId=pack.manifest.id;
          window.dispatchEvent(new CustomEvent('btg-package-ready',{detail:{packageId:pack.manifest.id}}));
          log('ChatGPT için MD dosyası hazır: 01_ChatGPT_geri_bildirim.md');
        }
      }catch(e){manifest.errors.push('MD paketi: '+e.message);manifest.status='error';$('status').textContent+=' MD paketi oluşturulamadı: '+e.message;}

      if(runDir)try{await BTGOutput.write(runDir,'00_oturum.json',new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}));}catch(e){$('status').textContent+=' Oturum özeti kaydedilemedi: '+e.message;}
      for(const id of [...owned])await close(id);
      running=false;$('start').disabled=false;$('folder').disabled=false;$('scope').disabled=false;$('stop').disabled=true;
    }
  };
})();

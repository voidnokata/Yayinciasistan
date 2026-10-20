/* Read-only Backstage export commands. Does not call TikTok APIs or messaging flows. */
(() => {
  if(globalThis.__BTG_FEEDBACK_READER__)return;
  globalThis.__BTG_FEEDBACK_READER__=true;
  let busy=false,commandDeadline=Infinity;
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible);
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const label=e=>clean(e?.innerText||e?.textContent);
  const disabled=e=>!e||e.disabled||e.getAttribute('aria-disabled')==='true';
  const panel=()=>all('[role="tabpanel"]')[0]||document.querySelector('main');
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function wait(fn,ms=45000){
    const end=Math.min(Date.now()+ms,commandDeadline);let tableError;
    do{
      try{const value=fn();tableError=null;if(value)return value;}
      catch(e){if(!e.message.includes('Tablo sütun sayısı değişti'))throw e;tableError=e;}
      await pause(200);
    }while(Date.now()<end);
    if(Date.now()>=commandDeadline)throw Error('Okuma komutunun süresi aşıldı.');
    throw tableError||Error('Ekran zamanında hazır olmadı. Oturum ve sayfa düzenini kontrol edin.');
  }
  function grid(root=panel()){
    const table=all('table[role="grid"]',root)[0];
    if(!table) return {headers:[],rows:[]};
    const headers=[...table.querySelectorAll('thead th,thead td[role="columnheader"]')].map(label);
    const rows=[...table.querySelectorAll('tbody tr')].map(tr=>{
      const cells=[...tr.querySelectorAll('td')];
      if(!cells.length)return null;
      if(cells.length!==headers.length)throw Error('Tablo sütun sayısı değişti; veri eşleştirilmedi.');
      return Object.fromEntries(headers.map((h,i)=>[h,cells[i].innerText.trim()]));
    }).filter(Boolean);
    return {headers,rows,renderedRowCount:Number(table.getAttribute('aria-rowcount'))||null};
  }
  function paging(root=panel()){
    const text=root.innerText;
    const a=text.match(/([\d.]+)\s*-\s*([\d.]+)\s*\/\s*([\d.]+)\s*gösteriliyor/);
    const b=text.match(/([\d.]+) içinden ([\d.]+)\s*-\s*([\d.]+) göster/);
    const num=s=>Number(s.replace(/\./g,''));
    const next=all('button[aria-label="Next"],[role="button"][aria-label="Next"]',root)[0];
    const prev=all('button[aria-label="Previous"],[role="button"][aria-label="Previous"]',root)[0];
    return {total:a?num(a[3]):b?num(b[1]):null,first:a?num(a[1]):b?num(b[2]):null,
      nextPresent:!!next,hasNext:!!next&&!disabled(next),hasPrevious:!!prev&&!disabled(prev)};
  }
  function snapshot(){
    const root=panel();if(!root)throw Error('Backstage ana ekranı bulunamadı.');
    const heading=document.querySelector('main h5');
    const selected=all('[role="tab"][aria-selected="true"]')[0];
    const input=p=>all('input',root).find(e=>e.placeholder===p)?.value||null;
    const main=document.querySelector('main');
    const text=root.innerText;
    const mainText=main?.innerText||'';
    const management=mainText.match(/Yönetim tarihleri\s*\n([^\n]+)/)?.[1]||null;
    const table=grid(root);
    return {url:location.href,username:heading?.innerText.trim()||null,tab:label(selected),
      management,sourceTimeZone:text.match(/UTC[+-]\d{2}:\d{2}/)?.[0]||null,
      browserTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      start:input('Başlangıç tarihi'),end:input('Bitiş tarihi'),
      // Profile free text and representative email deliberately excluded.
      profileStats:mainText.match(/(?:\d[\d.,]*\s*\nTakipçiler)[\s\S]*?(?=Temsilci)/)?.[0]?.trim()||null,
      summary:text.split(/Günlük trendler|CANLI Yayın kapağı/)[0].trim(),
      ...table,paging:paging(root),
      rosterSearchActive:location.pathname==='/portal/anchor/list'&&all('input',main||root).some(e=>['text','search'].includes(e.type)&&!e.readOnly&&e.getAttribute('role')!=='combobox'&&String(e.value||'').trim()),
      filters:all('input[type="checkbox"]',root).filter(e=>e.checked&&clean(e.closest('label')?.innerText).includes('Sadece eşleşme')).map(()=> 'Sadece eşleşme verileri')};
  }
  async function stable(expected=null,timeout=45000){
    let last='',since=Date.now();
    await wait(()=>{
      if(all('[aria-busy="true"],.semi-spin-spinning').length){since=Date.now();return false;}
      const root=panel();if(!root)return false;
      if(expected){
        const inputs=all('input',root),start=inputs.find(e=>e.placeholder==='Başlangıç tarihi')?.value,end=inputs.find(e=>e.placeholder==='Bitiş tarihi')?.value;
        const tr=s=>s.split('-').reverse().join('.');
        if(start!==tr(expected.start)||end!==tr(expected.end)){since=Date.now();return false;}
        // The date inputs can change before the old daily table is replaced.
        const table=grid(root);
        if(table.headers.includes('Tarih')){
          const dates=table.rows.map(r=>String(r.Tarih||'').match(/^(\d{2})\.(\d{2})\.(\d{4})/)).map(m=>m?m[3]+'-'+m[2]+'-'+m[1]:null);
          if(!dates.length||dates.some(d=>!d||d<expected.start||d>expected.end)||!dates.includes(expected.end)||paging(root).hasPrevious){since=Date.now();return false;}
        }
      }
      if(/anchor_\w+_dynamic/.test(root.innerText)){since=Date.now();return false;}
      if(!grid(root).headers.length&&!/veri yok|veri bulunamadı|kayıt yok|no data/i.test(root.innerText))return false;
      // Unrelated live counters and timers must not reset table readiness.
      const value=JSON.stringify({grid:grid(root),paging:paging(root),username:document.querySelector('main h5')?.innerText.trim(),tab:label(all('[role="tab"][aria-selected="true"]')[0]),dates:all('input',root).filter(e=>['Başlangıç tarihi','Bitiş tarihi'].includes(e.placeholder)).map(e=>e.value)});
      if(value!==last){last=value;since=Date.now();return false;}
      return Date.now()-since>1200;
    },timeout);
    return snapshot();
  }
  async function next(){
    const root=panel(),before=JSON.stringify(grid(root).rows),button=all('button[aria-label="Next"],[role="button"][aria-label="Next"]',root)[0];
    if(disabled(button))throw Error('Sonraki sayfa yok.');button.click();
    await wait(()=>JSON.stringify(grid(panel()).rows)!==before);return stable();
  }
  async function selectTab(name){
    if(!['CANLI Yayın performansı','CANLI Yayınlar','Bölgeye göre performans'].includes(name))throw Error('Geçersiz sekme.');
    const e=all('[role="tab"]').find(e=>label(e)===name);if(!e)throw Error('Sekme bulunamadı: '+name);
    e.click();await wait(()=>e.getAttribute('aria-selected')==='true');return stable();
  }
  const dayCells=root=>all('[role="gridcell"][aria-label]',root).filter(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.getAttribute('aria-label')));
  async function showMonth(date){
    for(let i=0;i<130;i++){
      const dialog=all('[role="dialog"]')[0];if(!dialog)throw Error('Tarih seçici açılmadı.');
      const cells=dayCells(dialog);
      if(cells.some(e=>e.getAttribute('aria-label')===date))return dialog;
      const first=cells[0]?.getAttribute('aria-label');if(!first)throw Error('Takvim günleri okunamadı.');
      const dir=date<first?'Previous month':'Next month';
      const button=all('button[aria-label]',dialog).find(e=>e.getAttribute('aria-label')===dir);
      if(disabled(button))throw Error('Takvim ayına gidilemedi.');
      button.click();await wait(()=>all('[role="gridcell"][aria-label]',dialog).find(e=>/^\d{4}-/.test(e.getAttribute('aria-label')))?.getAttribute('aria-label')!==first);
    }
    throw Error('Tarih çok eski; takvim gezinme sınırına ulaşıldı.');
  }
  async function dateCell(date){
    const dialog=await showMonth(date);
    const enabled=()=>all('[role="gridcell"][aria-label]',all('[role="dialog"]')[0]||dialog).find(e=>e.getAttribute('aria-label')===date&&!disabled(e));
    let target=enabled();
    if(!target)try{target=await wait(enabled,3000);}catch{throw Error('Takvimde tarih seçilemedi: '+date+'. Tarih kısıtı veya alan geçişi doğrulanamadı.');}
    target.click();
  }
  // Newest selectable day in [floor, date]; Backstage may not offer yesterday's daily row yet.
  async function latestSelectable(date,floor){
    const dialog=await showMonth(date);
    const current=()=>all('[role="dialog"]')[0]||dialog;
    try{await wait(()=>dayCells(current()).some(e=>e.getAttribute('aria-label')===date&&!disabled(e)),3000);return date;}catch{}
    return dayCells(current()).filter(e=>!disabled(e)).map(e=>e.getAttribute('aria-label')).filter(d=>d>=floor&&d<date).sort().at(-1)||null;
  }
  function enterDates(start,end){
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(!setter)throw Error('Tarih metni girilemedi.');
    for(const [name,date] of [['Başlangıç tarihi',start],['Bitiş tarihi',end]]){
      const input=all('input',panel()).find(e=>e.placeholder===name);
      if(!input||input.readOnly||disabled(input))throw Error('Tarih alanı düzenlenemiyor: '+name);
      input.focus();setter.call(input,date.split('-').reverse().join('.'));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
      input.blur();
    }
  }
  async function range(start,end,maxLagDays=0){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw Error('Geçersiz tarih.');
    if(start>end)throw Error('Başlangıç tarihi bitişten sonra olamaz.');
    const root=panel(),input=all('input',root).find(e=>e.placeholder==='Başlangıç tarihi');
    if(!input)throw Error('Tarih filtresi yok.');
    const tr=s=>s.split('-').reverse().join('.');
    const field=name=>all('input',panel()).find(e=>e.placeholder===name);
    const close=async()=>{
      if(!all('[role="dialog"]').length)return;
      const title=all('h4,h6',panel())[0];if(title){
        title.dispatchEvent?.(new MouseEvent('mousedown',{bubbles:true}));title.click();
      }
      await wait(()=>!all('[role="dialog"]').length,3000);
    };
    const requestedEnd=end;
    if(maxLagDays>0){
      // Only the newest boundary may move back, and only by a few days; older gaps still fail.
      const lagFloor=new Date(Date.parse(end)-maxLagDays*86400000).toISOString().slice(0,10),floor=lagFloor>start?lagFloor:start;
      const target=field('Bitiş tarihi');
      if(target){
        try{
          await close();target.focus();target.click();await wait(()=>all('[role="dialog"]').length,8000);
          const latest=await latestSelectable(end,floor);if(latest)end=latest;
        }catch{}finally{try{await close();}catch{}}
      }
    }
    const withEnd=result=>maxLagDays>0?{...result,requestedEnd,availableEnd:end}:result;
    if(input.value===tr(start)&&field('Bitiş tarihi')?.value===tr(end))return withEnd(await stable({start,end},20000));
    let failure;
    for(let attempt=0;attempt<2;attempt++)try{
      await close();
      if(attempt===0)enterDates(start,end);
      else for(const [name,date] of [['Başlangıç tarihi',start],['Bitiş tarihi',end]]){
        const target=field(name);if(!target)throw Error('Tarih alanı bulunamadı: '+name);
        // HTMLElement.click() does not focus an input. Semi's range picker uses focus to select the boundary.
        target.focus();target.click();await wait(()=>all('[role="dialog"]').length,8000);
        await dateCell(date);
        await wait(()=>field(name)?.value===tr(date),8000);
      }
      await close();
      await wait(()=>field('Başlangıç tarihi')?.value===tr(start)&&field('Bitiş tarihi')?.value===tr(end),8000);
      const result=await stable({start,end},20000);
      if(result.start!==tr(start)||result.end!==tr(end))throw Error(`Tarih filtresi uygulanmadı: ${result.start} – ${result.end}`);
      return withEnd(result);
    }catch(e){failure=e;try{await close();}catch{}}
    throw Error('Tarih aralığı iki denemede doğrulanamadı ('+start+' / '+end+'): '+failure.message);
  }
  async function execute(m){
    if(location.hostname!=='live-backstage.tiktok.com')throw Error('Yanlış kaynak.');
    const matches=()=>new URL(location.href).searchParams.get('username')===m.username&&document.querySelector('main h5')?.innerText.trim()===m.username;
    if(m.username){
      if(new URL(location.href).searchParams.get('username')!==m.username)throw Error('Yayıncı kimliği eşleşmiyor.');
      try{await wait(matches);}catch{throw Error('Yayıncı kimliği eşleşmiyor.');}
    }
    let result;
    if(m.command==='read')result=await stable();
    else if(m.command==='tab')result=await selectTab(m.name);
    else if(m.command==='next')result=await next();
    else if(m.command==='range')result=await range(m.start,m.end,Math.min(Math.max(Number(m.maxLagDays)||0,0),2));
    else throw Error('Bilinmeyen okuma komutu.');
    if(m.username&&(!matches()||result.username!==m.username))throw Error('Yayıncı kimliği eşleşmiyor.');
    return result;
  }
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(m?.type!=='BTG_FEEDBACK_READ')return;
    if(sender.id!==chrome.runtime.id)return;
    if(busy){reply({ok:false,error:'Önceki okuma sürüyor.'});return;}
    busy=true;commandDeadline=Date.now()+75000;
    execute(m).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message})).finally(()=>{busy=false;commandDeadline=Infinity;});return true;
  });
})();



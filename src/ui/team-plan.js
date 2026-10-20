(() => {
  const $=id=>document.getElementById(id);
  const folderLink=document.createElement('a');folderLink.href='output-folder.html';folderLink.target='_blank';folderLink.textContent='Çıktı klasörünü seç / izni yenile';document.querySelector('header').after(folderLink);
  let members=Array.from({length:6},()=>({name:'',priority:false})), records=[], plan=null, reading=false;
  let history=[],committedId=null,mode='class';
  const core=()=>mode==='league'?window.BTGLeaguePlan:window.BTGTeamPlan;
  const formatCoins=n=>Number(n).toLocaleString('tr-TR');
  function setMode(next){
    if(reading)return;mode=next;invalidate();records=[];$('files').value='';$('fileInfo').textContent='Henüz dosya seçilmedi.';$('allocate').disabled=true;
    const league=mode==='league';$('classTab').setAttribute('aria-pressed',String(!league));$('leagueTab').setAttribute('aria-pressed',String(league));
    $('confirmedEligible').closest('label').hidden=league;
    $('files').accept=league?'.xlsx,.csv':'.xlsx';
    $('sourceHelp').textContent=league?'BTG Lig Tarayıcı çıktısını seç (.xlsx veya .csv). Yalnız Backstage sonucu Uygun olan, yapılandırılmış kullanıcı adları dağıtıma alınır. Eski kontrolsüz çıktılar kabul edilmez.':'Bir veya birden fazla .xlsx seç. ID, sınıf ve kısa değerlendirme birlikte korunur.';
    $('memberHelp').textContent=league?'Yayıncılar kişi sayısına göre paylaştırılır. Her üyenin grubu jetonu yüksekten düşüğe sıralanır. Toplam jeton eşitlemesi yapılmaz.':'İşaretli üyeler 3. sınıf yayıncı dağıtımında 3 kat ağırlık alır. Diğer yayıncılar toplam yükü dengeleyecek şekilde paylaşılır.';
    $('priorityHelp').hidden=league;renderMembers();
    function head(id,labels){$(id).replaceChildren();appendRow($(id),labels);}
    head('totalsHead',league?['Takım üyesi','Yayıncı sayısı','Toplam jeton']:['Takım üyesi','0. sınıf','1. sınıf','2. sınıf','3. sınıf','Toplam']);
    head('previewHead',league?['Takım üyesi','Yayıncı ID','Jeton','Lig / Sıra / Profil','Rapor']:['Takım üyesi','Yayıncı ID','Sınıf','Kısa değerlendirme','Rapor']);
  }
  $('classTab').addEventListener('click',()=>setMode('class'));
  $('leagueTab').addEventListener('click',()=>setMode('league'));
  function invalidate(){plan=null;committedId=null;$('download').textContent='Excel’i kaydet';$('download').disabled=true;$('result').hidden=true;$('error').textContent='';}
  async function refreshHistory(){history=await window.BTGTeamHistory.read();$('historyInfo').textContent=`${history.length} geçmiş çıktı · ${history.reduce((n,b)=>n+b.rows.length,0)} atama kaydı korunuyor.`;}
  refreshHistory().catch(e=>{$('historyInfo').textContent='Geçmiş okunamadı.';$('error').textContent=e.message;});
  $('confirmedEligible').addEventListener('change',invalidate);
  $('backupHistory').addEventListener('click',()=>window.BTGTeamHistory.backup().catch(e=>{$('error').textContent=e.message;}));
  $('restoreHistory').addEventListener('change',async()=>{const f=$('restoreHistory').files[0];if(!f)return;invalidate();document.querySelector('main').inert=true;try{await window.BTGTeamHistory.restore(JSON.parse(await f.text()));await refreshHistory();}catch(e){$('error').textContent=e.message;}finally{document.querySelector('main').inert=false;$('restoreHistory').value='';}});
  function save(){localStorage.setItem('btg-team-members',JSON.stringify({members,count:Number($('memberCount').value)}));}
  function renderMembers(){
    $('members').replaceChildren();
    const count=Number($('memberCount').value);
    while(members.length<count) members.push({name:'',priority:false});
    members.slice(0,count).forEach((m,i)=>{
      const card=document.createElement('div');card.className='member';
      const label=document.createElement('label');label.textContent=`Takım üyesi ${i+1}`;
      const name=document.createElement('input');name.type='text';name.maxLength=80;name.value=m.name;name.placeholder='Ad soyad';name.setAttribute('aria-label',`Takım üyesi ${i+1}`);
      name.addEventListener('input',()=>{m.name=name.value;invalidate();save();});label.append(name);
      const priority=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=m.priority;checkbox.setAttribute('aria-label',`${i+1}. üye için 3. sınıf önceliği`);
      checkbox.addEventListener('change',()=>{m.priority=checkbox.checked;invalidate();save();});priority.append(checkbox,document.createTextNode('3. sınıf önceliği'));
      priority.hidden=mode==='league';card.append(label,priority);$('members').append(card);
    });
  }
  try{const saved=JSON.parse(localStorage.getItem('btg-team-members'));if(saved&&Array.isArray(saved.members)&&Number.isInteger(saved.count)&&saved.count>=1&&saved.count<=50){members=saved.members.map(m=>({name:String(m.name||''),priority:Boolean(m.priority)}));$('memberCount').value=saved.count;}}catch{}
  renderMembers();
  $('memberCount').addEventListener('input',()=>{invalidate();let n=Number($('memberCount').value);if(!Number.isInteger(n)||n<1||n>50){$('error').textContent='Üye sayısı 1–50 arasında tam sayı olmalı.';$('allocate').disabled=true;return;}renderMembers();save();$('allocate').disabled=reading||!records.length;});
  $('files').addEventListener('change',async()=>{
    invalidate();records=[];reading=true;$('allocate').disabled=true;$('files').disabled=true;$('fileInfo').textContent='Dosyalar okunuyor…';
    const files=[...$('files').files];
    try{
      if(!files.length){$('fileInfo').textContent='Henüz dosya seçilmedi.';return;}
      const combined=[];let skipped=0;
      for(const file of files){
        const csv=mode==='league'&&/\.csv$/i.test(file.name);
        if(!csv&&!/\.xlsx$/i.test(file.name))throw new Error(mode==='league'?'Yalnız .xlsx veya .csv seçin.':'Yalnız .xlsx dosyası seçin.');
        const rows=csv?window.BTGLeaguePlan.parseCsv(await file.text()):await window.BTGSpreadsheetReader.readXlsxRows(await file.arrayBuffer(),true);
        const parsed=core().parseRows(rows,file.name);
        if(mode==='league'){combined.push(...parsed.rows);skipped+=parsed.skipped;}else combined.push(...parsed);
      }
      const merged=core().mergeRecords(combined);records=merged.rows;
      $('fileInfo').textContent=`${files.length} dosya · ${records.length} benzersiz yayıncı · ${merged.duplicates} tekrar birleştirildi${mode==='league'?` · ${skipped} uygun olmayan/kontrol edilmemiş veya eksik kayıt atlandı`:""}${merged.conflicts ? (mode==='league'?` · ${merged.conflicts} jeton farkında en yüksek değer korundu (toplanmadı)`:` · ${merged.conflicts} sınıf farkında yüksek sınıf korundu`) : ''}. Dosyalar: ${files.map(f=>f.name).join(', ')}`;
    }catch(error){$('error').textContent=error.message;$('fileInfo').textContent='Dosyalar yüklenemedi; seçimi kontrol edin.';}
    finally{reading=false;$('files').disabled=false;$('allocate').disabled=!records.length;}
  });
  function appendRow(body,values){const tr=document.createElement('tr');for(const value of values){const td=document.createElement(body.tagName==='THEAD'?'th':'td');td.textContent=value;tr.append(td);}body.append(tr);}
  $('allocate').addEventListener('click',async()=>{
    invalidate();document.querySelector('main').inert=true;try{
      await refreshHistory();
      const count=Number($('memberCount').value);if(!Number.isInteger(count)||count<1||count>50)throw new Error('Geçerli üye sayısı girin.');
      plan=core().distribute(records,members.slice(0,count),history,Date.now(),mode==='league'||$('confirmedEligible').checked);
      plan.sourceFiles=[...$('files').files].map(f=>f.name);
      $('totals').replaceChildren();$('preview').replaceChildren();
      for(const m of plan.totals)appendRow($('totals'),mode==='league'?[m.name,m.total,formatCoins(m.coins)]:[m.name,...[0,1,2,3].map(c=>m.classes[c]),m.total]);
      for(const r of [...plan.rows,...plan.exhausted])appendRow($('preview'),[r.member,r.username,mode==='league'?formatCoins(r.coins):r.classId,mode==='league'?[r.league,r.rank?`${r.rank}. sıra`:'',r.displayName].filter(Boolean).join(' · '):r.summary,r.report]);
      $('resultInfo').textContent=`${plan.rows.length} yayıncı, ${count} takım üyesine dağıtıldı. Bekleme süresinde olduğu için ${plan.waiting} yayıncı atlandı. Tüm ekibin denediği ${plan.exhausted.length} yayıncı ayrı sayfada raporlanacak.`;
      $('result').hidden=false;$('download').disabled=!plan.rows.length&&!plan.exhausted.length;
    }catch(error){$('error').textContent=error.message;}finally{document.querySelector('main').inert=false;}
  });
  $('download').addEventListener('click',async()=>{
    if(!plan)return;document.querySelector('main').inert=true;
    try{
      // Validate/build before committing, then preserve this exact export for retries.
      await window.BTGOutput.requireFolder();
      window.BTGXlsxWriter.buildTeamPlanWorkbook(plan.rows,plan.exhausted,{league:mode==='league'});
      if(!committedId){const batch={id:crypto.randomUUID(),createdAt:new Date().toISOString(),rows:plan.rows,exhausted:plan.exhausted,sourceFiles:plan.sourceFiles};await window.BTGTeamHistory.append(batch,history.length);committedId=batch.id;}
      await window.BTGXlsxWriter.downloadTeamPlan(plan.rows,plan.exhausted,{league:mode==='league'});
      await refreshHistory();
      $('download').textContent='Aynı Excel’i tekrar kaydet';
      await window.BTGTeamHistory.backup();
    }catch(error){$('error').textContent=error.message+(committedId?' Atama geçmişi kaydedildi; aynı Excel’i tekrar kaydedebilirsiniz.':'');}
    finally{document.querySelector('main').inert=false;}
  });
})();

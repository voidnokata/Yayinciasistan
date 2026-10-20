(() => {
  const key = value => String(value ?? '').trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[\s_-]+/g,' ');
  function parseRows(rows, fileName = 'Excel') {
    let columns = null;
    const records = [];
    for (const [index, cells] of rows.entries()) {
      if (!cells.some(c=>String(c ?? '').trim())) continue;
      const headers = cells.map(key);
      const userCol = headers.findIndex(c=>['yayinci id','kullanici adi','username','tiktok username'].includes(c));
      const classCol = headers.indexOf('sinif');
      if (userCol >= 0 && classCol >= 0) {
        columns = {user:userCol, cls:classCol, note:headers.indexOf('kisa degerlendirme')};
        continue;
      }
      if (!columns) throw new Error(`${fileName}: “Yayıncı ID” ve “Sınıf” başlıkları gerekli.`);
      const username = String(cells[columns.user] ?? '').trim().replace(/^@/,'');
      const classText = String(cells[columns.cls] ?? '').trim();
      const match = classText.match(/^([0123])(?:\.?\s*s[ıi]n[ıi]f)?$/i);
      if (!/^[a-z0-9._]{2,32}$/i.test(username) || !match) throw new Error(`${fileName}, satır ${index+1}: geçerli yayıncı ID ve 0/1/2/3 sınıfı gerekli.`);
      records.push({username,classId:Number(match[1]),summary:String(cells[columns.note] ?? '').trim()});
    }
    if (!records.length) throw new Error(`${fileName}: dağıtılacak yayıncı bulunamadı.`);
    return records;
  }
  function mergeRecords(records) {
    const map = new Map(); let duplicates=0,conflicts=0;
    for (const row of records) {
      const id = row.username.toLowerCase(), old = map.get(id);
      if (!old) {map.set(id,{...row});continue;}
      duplicates++;
      if (old.classId !== row.classId) conflicts++;
      if (row.classId > old.classId) map.set(id,{...row});
      else if (row.classId === old.classId && !old.summary && row.summary) old.summary=row.summary;
    }
    return {rows:[...map.values()],duplicates,conflicts};
  }
  function distribute(records, rawMembers, history = [], now = Date.now(), confirmedEligible = false) {
    const members=rawMembers.map(m=>({name:String(m.name||'').trim(),priority:Boolean(m.priority)}));
    if (!members.length || members.some(m=>!m.name)) throw new Error('Tüm takım üyelerinin isimlerini yazın.');
    if (new Set(members.map(m=>key(m.name))).size!==members.length) throw new Error('Takım üyelerinin isimleri birbirinden farklı olmalı.');
    if (!records.length) throw new Error('Önce Excel dosyası seçin.');
    const totals=members.map(m=>({...m,total:0,classes:{0:0,1:0,2:0,3:0}})), rows=[], exhausted=[];
    const byPublisher=new Map();
    for(const batch of history)for(const r of batch.rows||[]){const id=r.username.toLowerCase();if(!byPublisher.has(id))byPublisher.set(id,[]);byPublisher.get(id).push({...r,at:batch.createdAt});}
    for(const entries of byPublisher.values())entries.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    let waiting=0;
    for (const row of [...records].sort((a,b)=>b.classId-a.classId || a.username.localeCompare(b.username))) {
      const past=byPublisher.get(row.username.toLowerCase())||[];
      const latest=past[0], elapsed=latest ? now-Date.parse(latest.at) : Infinity;
      if(elapsed<3*86400000){waiting++;continue;}
      const tried=new Set(past.map(r=>key(r.member)));
      const availability=confirmedEligible ? 'hâlâ müsait' : 'güncel uygunluk doğrulanmadı';
      const previous=latest ? `${Math.floor(elapsed/86400000)} gün önce ${latest.member} yazdı / ${availability}` : '';
      const choices=totals.map((m,i)=>({m,i,load:row.classId===3 ? (m.classes[3]+1)/(m.priority?3:1) : m.total})).filter(c=>!tried.has(key(c.m.name)));
      if(!choices.length){exhausted.push({...row,member:'Tüm Ekip Denedi',report:`Tüm ekip yazdı / alınamadı / ${availability}`});continue;}
      choices.sort((a,b)=>a.load-b.load || a.m.classes[row.classId]-b.m.classes[row.classId] || a.m.total-b.m.total || a.i-b.i);
      const winner=choices[0]; winner.m.total++; winner.m.classes[row.classId]++;
      rows.push({...row,member:winner.m.name,memberIndex:winner.i,report:previous});
    }
    rows.sort((a,b)=>a.memberIndex-b.memberIndex || b.classId-a.classId || a.username.localeCompare(b.username));
    return {rows,totals,waiting,exhausted};
  }
  const api={parseRows,mergeRecords,distribute};
  if(typeof module!=='undefined') module.exports=api;
  if(typeof window!=='undefined') window.BTGTeamPlan=api;
})();

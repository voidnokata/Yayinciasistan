(() => {
  const normalize = v => String(v ?? '').trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[\s_-]+/g,' ');
  function parseRows(rows, fileName='Lig çıktısı') {
    let columns=null, skipped=0; const records=[];
    for(const [i,cells] of rows.entries()) {
      if(!cells.some(v=>String(v??'').trim()))continue;
      const keys=cells.map(normalize), user=keys.indexOf('kullanici adi'), coins=keys.indexOf('jeton');
      if(user>=0 && coins>=0){columns={user,coins,status:keys.indexOf('kullanici adi durumu'),league:keys.indexOf('lig'),rank:keys.indexOf('sira'),name:keys.indexOf('profil ismi'),eligibility:keys.indexOf('backstage durumu'),checkedAt:keys.indexOf('backstage kontrol zamani')};continue;}
      if(!columns)throw new Error(`${fileName}: BTG Lig Tarayıcı çıktısındaki “Kullanıcı Adı” ve sayısal “Jeton” başlıkları gerekli.`);
      if(columns.eligibility<0 || columns.checkedAt<0)throw new Error(`${fileName}: Backstage kontrolü yok. Dosyayı güncel BTG Lig Tarayıcı ile oluşturun.`);
      if(normalize(cells[columns.eligibility])!=='uygun'||!Number.isFinite(Date.parse(String(cells[columns.checkedAt]??'')))){skipped++;continue;}
      const username=String(cells[columns.user]??'').trim().replace(/^@/,'');
      const status=normalize(cells[columns.status]);
      if(!username || (columns.status>=0 && status!=='structured')){skipped++;continue;}
      if(!/^[a-z0-9._]{2,32}$/i.test(username)||username.startsWith('.')||username.endsWith('.')||username.includes('..'))throw new Error(`${fileName}, satır ${i+1}: kullanıcı adı geçersiz.`);
      const raw=String(cells[columns.coins]??'').trim();
      const clean=/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)?raw.replace(/[.,]/g,''):raw;
      const amount=Number(clean);
      if(!/^\d+(?:\.0+)?$/.test(clean)||!Number.isSafeInteger(amount)||amount<0)throw new Error(`${fileName}, satır ${i+1}: Jeton sütununda geçerli sayısal değer gerekli.`);
      const rank=Number(cells[columns.rank]);
      records.push({username,coins:amount,league:String(cells[columns.league]??'').trim(),rank:Number.isInteger(rank)&&rank>0?rank:null,displayName:String(cells[columns.name]??'').trim(),sourceType:'league',backstageStatus:'eligible',backstageCheckedAt:String(cells[columns.checkedAt])});
    }
    if(!columns)throw new Error(`${fileName}: lig çıktısı başlıkları bulunamadı.`);
    return {rows:records,skipped};
  }
  function mergeRecords(records){
    const map=new Map();let duplicates=0,conflicts=0;
    for(const r of records){const id=r.username.toLowerCase(),old=map.get(id);if(!old){map.set(id,{...r});continue;}duplicates++;if(old.coins!==r.coins)conflicts++;if(r.coins>old.coins)map.set(id,{...r});}
    return {rows:[...map.values()],duplicates,conflicts};
  }
  function distribute(records,members,history=[],now=Date.now(),confirmed=false){
    if(records.some(r=>r.backstageStatus!=='eligible'||!Number.isFinite(Date.parse(r.backstageCheckedAt))))throw new Error('Yalnız Backstage kontrolünden geçen yayıncılar dağıtılabilir.');
    const core=typeof module!=='undefined'?require('./team-plan-core.js'):window.BTGTeamPlan;
    // Use the existing total-count and history rules. Coin amounts do not change assignment weights.
    const plan=core.distribute(records.map(r=>({...r,classId:0})),members.map(m=>({...m,priority:false})),history,now,confirmed);
    for(const r of [...plan.rows,...plan.exhausted])delete r.classId;
    const order=(a,b)=>b.coins-a.coins||a.username.localeCompare(b.username);
    plan.rows.sort((a,b)=>a.memberIndex-b.memberIndex||order(a,b));plan.exhausted.sort(order);
    for(const m of plan.totals){delete m.classes;m.coins=plan.rows.filter(r=>r.member===m.name).reduce((n,r)=>n+r.coins,0);}
    return plan;
  }
  function parseCsv(text){
    const first=text.replace(/^\uFEFF/,'').split(/\r?\n/,1)[0];
    const delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(!quoted&&c===delimiter){row.push(cell);cell='';}
      else if(!quoted&&(c==='\n'||c==='\r')){row.push(cell);rows.push(row);row=[];cell='';if(c==='\r'&&text[i+1]==='\n')i++;}
      else cell+=c;}
    if(quoted)throw new Error('CSV dosyasında kapanmamış tırnak var.');
    if(cell||row.length){row.push(cell);rows.push(row);}return rows;
  }
  const api={parseRows,mergeRecords,distribute,parseCsv};
  if(typeof module!=='undefined')module.exports=api;
  if(typeof window!=='undefined')window.BTGLeaguePlan=api;
})();

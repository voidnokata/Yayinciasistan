/* Append-only local export journal. IDB transactions serialize parallel tabs. */
(() => {
  function open(){return new Promise((resolve,reject)=>{
    const req=indexedDB.open('btg-team-history',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('exports',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}
  async function read(){const db=await open();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('exports','readonly'),req=tx.objectStore('exports').getAll();
    tx.oncomplete=()=>resolve(req.result.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}}
  async function append(batch,expectedCount){const db=await open();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('exports','readwrite'),store=tx.objectStore('exports'),count=store.count();
    let stale=false;
    count.onsuccess=()=>{if(count.result!==expectedCount){stale=true;tx.abort();return;}store.add(batch);};
    tx.oncomplete=()=>resolve(batch);tx.onabort=()=>reject(new Error(stale?'Geçmiş başka sekmede değişti; dağıtımı yeniden oluşturun.':'Geçmiş kaydedilemedi; Excel oluşturulmadı.'));tx.onerror=()=>{};
  });}finally{db.close();}}
  async function restore(data){
    if(data?.format!=='btg-team-history-v1'||!Array.isArray(data.exports))throw new Error('Geçersiz geçmiş yedeği.');
    for(const b of data.exports){if(typeof b.id!=='string'||!Number.isFinite(Date.parse(b.createdAt))||!Array.isArray(b.rows)||b.rows.some(r=>typeof r.username!=='string'||typeof r.member!=='string'||(r.sourceType==='league'?(!Number.isSafeInteger(r.coins)||r.coins<0):![0,1,2,3].includes(r.classId))))throw new Error('Yedekte geçersiz atama kaydı var.');}
    const db=await open();try{await new Promise((resolve,reject)=>{
      const tx=db.transaction('exports','readwrite'),store=tx.objectStore('exports');
      for(const b of data.exports){const req=store.get(b.id);req.onsuccess=()=>{if(!req.result)store.add(b);};}
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
    });}finally{db.close();}
  }
  async function backup(){const data={format:'btg-team-history-v1',exports:await read()};return window.BTGOutput.save(`BTG_Atama_Gecmisi_${new Date().toISOString().replace(/[:.]/g,'-')}.json`,new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));}
  window.BTGTeamHistory={read,append,restore,backup};
})();

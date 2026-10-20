(function(root){
'use strict';
const URL_BASE='https://live-backstage.tiktok.com/portal/anchor/list';
function verifyPage(s,previousCount,total,headers){
 if(!s||!Array.isArray(s.headers)||!Array.isArray(s.rows)||!Array.isArray(s.filters))throw Error('Yayıncı listesi okunamadı.');
 const url=new URL(s.url);if(url.origin+url.pathname!==URL_BASE||url.search)throw Error('Filtresiz yayıncı listesi açılamadı.');
 if(s.filters.length)throw Error('Listede etkin filtre var. Tüm yayıncılar doğrulanamadı.');
 if(s.rosterSearchActive===true)throw Error('Listede arama filtresi var. Tüm yayıncılar doğrulanamadı.');
 if(s.tab&&!/^Tüm içerik üreticiler/i.test(s.tab))throw Error('Tüm içerik üreticiler sekmesi açık değil.');
 if(!s.headers.includes('İçerik üreticisi')||!s.headers.includes('Katılma saati'))throw Error('Yayıncı listesi sütunları bulunamadı.');
 if(headers&&JSON.stringify(headers)!==JSON.stringify(s.headers))throw Error('Liste sütunları tarama sırasında değişti.');
 const p=s.paging;
 if(!p||!Number.isInteger(p.total)||p.total<0)throw Error('Yayıncı toplamı doğrulanamadı.');
 if(total!==undefined&&p.total!==total)throw Error('Yayıncı toplamı tarama sırasında değişti.');
 if(previousCount===0&&p.hasPrevious)throw Error('Liste ilk sayfadan başlamadı.');
 if(p.total>0&&p.first!==previousCount+1)throw Error('Sayfa sırası doğrulanamadı.');
 if(s.rows.length===0&&p.total!==0)throw Error('Yayıncı listesinde beklenmeyen boş sayfa var.');
 if(previousCount+s.rows.length>p.total)throw Error('Liste toplamı ile satır sayısı uyuşmuyor.');
 if(!p.hasNext&&previousCount+s.rows.length!==p.total)throw Error('Yayıncı listesi eksik.');
 return s;
}
async function collect(read,maxPages=1000){
 const rows=[],pages=new Set(),names=new Set();let total,headers;
 for(let i=0;i<maxPages;i++){
  const s=verifyPage(await read(i?'next':'read'),rows.length,total,headers);total=s.paging.total;headers=s.headers;
  const signature=JSON.stringify(s.rows);if(pages.has(signature))throw Error('Tekrarlanan liste sayfası.');pages.add(signature);
  for(const row of s.rows){const username=String(row['İçerik üreticisi']||'').trim().split(/\s+/)[0];
   if(!/^[A-Za-z0-9_.]{1,30}$/.test(username)||!String(row['Katılma saati']||'').trim())throw Error('Yayıncı adı veya katılma tarihi okunamadı.');
   const key=username.toLowerCase();if(names.has(key))throw Error('Tekrarlanan yayıncı: '+username);names.add(key);rows.push(row);
  }
  if(!s.paging.hasNext)return rows;
 }
 throw Error('Yayıncı listesi sayfalama sınırını aştı.');
}
function create({tabs,commit,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now(),timeoutMs=30000}){
 let active=false;
 const bounded=promise=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Backstage okuma zaman aşımı.')),timeoutMs);Promise.resolve(promise).then(resolve,reject).finally(()=>clearTimeout(timer));});
 async function refresh(windowId){
  if(active)throw Error('Yayıncı listesi yenileniyor.');active=true;let ownTab;
  try{
   ownTab=await tabs.create({url:URL_BASE,active:false,...(Number.isInteger(windowId)?{windowId}:{})});
   const deadline=now()+timeoutMs;let loaded=false;
   while(now()<deadline){const tab=await tabs.get(ownTab.id);if(tab.status==='complete'){loaded=true;break;}await sleep(250);}
   if(!loaded)throw Error('Backstage sayfası zamanında yüklenmedi.');
   let first=true;
   const read=async command=>{
    let response;
    for(let attempt=0;attempt<5;attempt++){
     try{response=await bounded(tabs.sendMessage(ownTab.id,{type:'BTG_FEEDBACK_READ',command},{frameId:0}));break;}
     catch(e){if(!first||!/Receiving end does not exist|Could not establish connection|alıcı|bağlantı kurulamadı/i.test(e.message)||attempt===4)throw e;await sleep(500);}
    }
    first=false;if(!response?.ok)throw Error(response?.error||'Yayıncı listesi okunamadı.');return response.data;
   };
   const rows=await collect(read);const updatedAt=new Date(now()).toISOString();
   await commit(rows,updatedAt);return {ok:true,count:rows.length,updatedAt};
  }finally{if(ownTab?.id)await tabs.remove(ownTab.id).catch(()=>{});active=false;}
 }
 return {refresh,isActive:()=>active};
}
const api={URL_BASE,verifyPage,collect,create};root.BTGFeedbackRoster=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);

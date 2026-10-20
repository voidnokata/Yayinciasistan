(() => {
  function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open('btg-output-folder',1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function handle(value,key='directory'){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('settings',value?'readwrite':'readonly');const r=value?tx.objectStore('settings').put(value,key):tx.objectStore('settings').get(key);tx.oncomplete=()=>resolve(value||r.result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};});}finally{db.close();}}
  async function requireFolder(){const dir=await handle();if(!dir||await dir.queryPermission({mode:'readwrite'})!=='granted')throw new Error('Çıktı klasörü seçilmeli veya yazma izni yenilenmeli. Eklentide “Çıktı klasörü” alanını açın.');return dir;}
  async function write(directory,name,blob){
    if(!/^[^\\/:*?"<>|]+\.(xlsx|json|txt|md)$/i.test(name))throw new Error('Geçersiz çıktı dosyası adı.');
    let candidate=name,index=1;
    while(true){try{await directory.getFileHandle(candidate);candidate=name.replace(/(\.[^.]+)$/,`_${index++}$1`);}catch(e){if(e.name==='NotFoundError')break;throw e;}}
    const file=await directory.getFileHandle(candidate,{create:true}),stream=await file.createWritable();
    try{await stream.write(blob);await stream.close();}catch(e){await stream.abort().catch(()=>{});throw e;}
    return {ok:true,name:candidate,folder:directory.name};
  }
  async function save(name,blob){return navigator.locks.request('btg-output-write',async()=>write(await requireFolder(),name,blob));}
  globalThis.BTGOutput={handle,requireFolder,save,write};
})();

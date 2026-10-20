(() => {
 const state=document.getElementById('folderState'),error=document.getElementById('folderError');let selected;
 async function refresh(){selected=await BTGOutput.handle();state.textContent=selected?`Seçili klasör: ${selected.name} · ${await selected.queryPermission({mode:'readwrite'})==='granted'?'Yazma izni hazır':'Yazma izni gerekiyor'}`:'Henüz klasör seçilmedi.';}
 document.getElementById('chooseFolder').addEventListener('click',async()=>{try{error.textContent='';const dir=await showDirectoryPicker({mode:'readwrite',id:'btg-output'});await BTGOutput.handle(dir);await refresh();}catch(e){if(e.name!=='AbortError')error.textContent=e.message;}});
 document.getElementById('renewFolder').addEventListener('click',async()=>{try{if(!selected)throw new Error('Önce klasör seçin.');await selected.requestPermission({mode:'readwrite'});await refresh();}catch(e){error.textContent=e.message;}});
 refresh().catch(e=>{error.textContent=e.message;});
})();

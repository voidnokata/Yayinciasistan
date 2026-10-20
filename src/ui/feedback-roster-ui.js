(() => {
 'use strict';
 const button=document.getElementById('refreshRoster'),status=document.getElementById('rosterStatus'),H=BTGFeedbackHistory;
 let busy=false;
 const stamp=async()=>{if(busy)return;const data=(await chrome.storage.local.get(H.KEY))[H.KEY];if(data?.rosterUpdatedAt)status.textContent='Son liste güncellemesi: '+new Date(data.rosterUpdatedAt).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})+' · '+Object.values(data.creators).filter(c=>c.rosterActive===true).length+' güncel yayıncı.';};
 button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;status.textContent='Backstage yayıncı listesinin tüm sayfaları okunuyor…';try{const tab=await chrome.tabs.getCurrent();const result=await chrome.runtime.sendMessage({type:'BTG_FEEDBACK_REFRESH_ROSTER',controllerTabId:tab?.id});if(!result?.ok)throw Error(result?.error||'Liste güncellenemedi.');status.textContent=result.count+' yayıncı güncellendi. Haftalık durum ekranından katılma tarihlerini ve geri bildirim sürelerini görebilirsin.';}catch(e){status.textContent=e.message+' Önceki kayıtlar korunur.';}finally{busy=false;button.disabled=false;}};
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[H.KEY])stamp().catch(()=>{});});stamp().catch(()=>{});
})();

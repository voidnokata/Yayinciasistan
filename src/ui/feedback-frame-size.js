(() => {
  'use strict';
  const HEIGHT='BTG_FEEDBACK_FRAME_HEIGHT',REQUEST='BTG_FEEDBACK_FRAME_MEASURE',origin=location.origin;
  const frame=document.getElementById('feedbackFrame');
  if(frame){
    const request=()=>frame.contentWindow?.postMessage({type:REQUEST},origin);
    window.addEventListener('message',event=>{
      if(event.origin!==origin||event.source!==frame.contentWindow||event.data?.type!==HEIGHT)return;
      const height=event.data.height;
      if(typeof height!=='number'||!Number.isFinite(height)||height<=0||!Number.isSafeInteger(height))return;
      frame.style.height=height+'px';
    });
    frame.addEventListener('load',request);
    const workspace=document.getElementById('feedbackWorkspace');
    if(workspace)new MutationObserver(()=>{if(!workspace.hidden)requestAnimationFrame(request);}).observe(workspace,{attributes:true,attributeFilter:['hidden']});
    request();return;
  }
  if(window.parent===window||new URLSearchParams(location.search).get('embedded')!=='1')return;
  const main=document.querySelector('main');if(!main)return;
  document.documentElement.classList.add('embedded-document');
  let scheduled=false,lastHeight=0;
  function measure(){
    scheduled=false;
    const box=main.getBoundingClientRect();
    // Main has no viewport-height minimum: the measurement can shrink as well as grow.
    if(box.width<=0||box.height<=0)return;
    const height=Math.ceil(Math.max(box.height,main.scrollHeight)+Math.max(0,box.top));
    if(height===lastHeight)return;lastHeight=height;
    window.parent.postMessage({type:HEIGHT,height},origin);
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(measure);}}
  new ResizeObserver(schedule).observe(main);
  window.addEventListener('message',event=>{if(event.origin===origin&&event.source===window.parent&&event.data?.type===REQUEST){lastHeight=0;schedule();}});
  window.addEventListener('load',schedule);
  document.fonts?.ready.then(schedule);
  schedule();
})();

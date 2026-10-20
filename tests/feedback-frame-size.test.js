const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/ui/feedback-frame-size.js'),'utf8');
test('Popup accepts height only from its own same-origin frame; accepts shrink as well as growth',()=>{
 const listeners={},frame={style:{},contentWindow:{postMessage(){}},addEventListener(){}},workspace={hidden:false};
 const context={location:{origin:'chrome-extension://btg'},document:{getElementById:id=>id==='feedbackFrame'?frame:workspace},window:{addEventListener:(type,fn)=>listeners[type]=fn},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn()};
 vm.runInNewContext(source,context);
 const send=(height,origin='chrome-extension://btg',source=frame.contentWindow)=>listeners.message({origin,source,data:{type:'BTG_FEEDBACK_FRAME_HEIGHT',height}});
 send(1900,'https://attacker.test');assert.equal(frame.style.height,undefined);send(1900,undefined,{});assert.equal(frame.style.height,undefined);
 for(const bad of [0,-1,NaN,Infinity,'1900',1.2])send(bad);assert.equal(frame.style.height,undefined);
 send(1900);assert.equal(frame.style.height,'1900px');send(340);assert.equal(frame.style.height,'340px');
});
test('Child measures natural main size, skips hidden zero size, and remeasures on observer and parent request',()=>{
 let box={width:0,height:0,top:0},resize;const calls=[],listeners={},parent={postMessage:(message,origin)=>calls.push({message,origin})};
 const main={getBoundingClientRect:()=>box,get scrollHeight(){return box.height;}};
 const context={URLSearchParams,location:{origin:'chrome-extension://btg',search:'?embedded=1'},document:{getElementById:()=>null,querySelector:()=>main,documentElement:{classList:{add(){}}}},window:{parent,addEventListener:(type,fn)=>listeners[type]=fn},ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},requestAnimationFrame:fn=>fn()};
 vm.runInNewContext(source,context);assert.equal(calls.length,0);
 box={width:380,height:1700,top:0};resize();assert.equal(calls.at(-1).message.height,1700);
 box.height=800;resize();assert.equal(calls.at(-1).message.height,800);
 resize();assert.equal(calls.length,2);
 listeners.message({origin:'chrome-extension://btg',source:parent,data:{type:'BTG_FEEDBACK_FRAME_MEASURE'}});assert.equal(calls.length,3);
 assert.equal(calls.at(-1).origin,'chrome-extension://btg');
});

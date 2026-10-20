const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core/output-folder.js'),'utf8'),ctx);
(async()=>{
 const saved=new Map([['Eylul.xlsx','old']]);let aborted=false;
 const directory={name:'BTG',getFileHandle:async(name,options)=>{
   if(!options?.create&&!saved.has(name))throw Object.assign(new Error('missing'),{name:'NotFoundError'});
   return {createWritable:async()=>({write:async blob=>{saved.set(name,blob);},close:async()=>{},abort:async()=>{aborted=true;}})};
 }};
 const r=await ctx.BTGOutput.write(directory,'Eylul.xlsx','new');assert.equal(r.name,'Eylul_1.xlsx');assert.equal(saved.get('Eylul.xlsx'),'old');assert.equal(saved.get('Eylul_1.xlsx'),'new');
 await ctx.BTGOutput.write(directory,'01_ChatGPT_geri_bildirim.md','# yönerge');assert.equal(saved.get('01_ChatGPT_geri_bildirim.md'),'# yönerge');
 const second=await ctx.BTGOutput.write(directory,'Eylul.xlsx','next');assert.equal(second.name,'Eylul_2.xlsx');
 await assert.rejects(()=>ctx.BTGOutput.write(directory,'../bad.xlsx','x'),/Geçersiz/);
 const failure={getFileHandle:async(n,o)=>{if(!o)throw Object.assign(new Error(),{name:'NotFoundError'});return {createWritable:async()=>({write:async()=>{throw new Error('disk full');},abort:async()=>{aborted=true;}})};}};
 await assert.rejects(()=>ctx.BTGOutput.write(failure,'data.json','x'),/disk full/);assert.equal(aborted,true);
 console.log('Çıktı klasörü: eski dosyayı koruma, isim çakışması ve yazma hatası testleri geçti.');
})().catch(e=>{console.error(e);process.exitCode=1;});


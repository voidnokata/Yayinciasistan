const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/ui/popup.js'),'utf8');
const start=source.indexOf('async function stopAndExportCollection()');
const end=source.indexOf('\nelements.exportHistoryButton',start);
async function run(mode,rows,stopOk=true){
 const calls=[],downloads=[];
 const context={chrome:{runtime:{sendMessage:async m=>{calls.push(m.type);return m.type==='BTG_STOP'?{ok:stopOk}:{ok:true,mode,rows};}}},window:{BTGXlsxWriter:{downloadNameCollection:r=>downloads.push(r)}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 let error;try{await context.stopAndExportCollection();}catch(e){error=e;}
 return {calls,downloads,error};
}
(async()=>{
 const rows=[{username:'test_yayinci',classId:2,summary:'Düzenli.'}];
 const result=await run('collect',rows);
 assert.deepEqual(result.calls,['BTG_STOP','BTG_EXPORT_REPORT']);assert.deepEqual(result.downloads,[rows]);
 assert.equal((await run('collect',[])).downloads.length,0);
 assert.equal((await run('live',rows)).downloads.length,0);
 const failed=await run('collect',rows,false);assert.ok(failed.error);assert.equal(failed.calls.length,1);assert.equal(failed.downloads.length,0);
 console.log('Durdurunca kayıtlı isimleri indirme, boş liste ve diğer modları koruma testleri geçti.');
})().catch(e=>{console.error(e);process.exitCode=1;});

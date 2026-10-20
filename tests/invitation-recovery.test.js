const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const harness=fs.readFileSync(path.join(__dirname,'xlsx-reader.test.js'),'utf8');
const parser=harness.slice(harness.indexOf('class XmlNode'),harness.indexOf('const context ='));
const ctx={window:{},TextEncoder,TextDecoder,Uint8Array,DataView,Blob,Response,DecompressionStream,URL,console};
vm.createContext(ctx);vm.runInContext(parser+';globalThis.DOMParser=SimpleDOMParser;',ctx);
for(const file of ['src/core/xlsx-reader.js','src/core/xlsx-writer.js','src/core/invitation-core.js'])vm.runInContext(read(file),ctx);
const W=ctx.window.BTGXlsxWriter,R=ctx.window.BTGSpreadsheetReader,I=ctx.window.BTGInvitations;
(async()=>{
  const checkedAt=new Date().toISOString();
  const oldRow={username:'test_legacy',classId:3,checkedAt,assessment:{version:4,summary:'Çok düzenli yayın.',metrics:{activeDays:11,medianLikes:24000,hours:20,fans:500,followers:20000,viewers:150}}};
  const records=I.readCollection(await R.readXlsxRows(W.buildNameCollectionWorkbook([oldRow]).buffer));
  assert.equal(records[0].schema,'2');assert.equal(records[0].capturedAt,checkedAt);
  assert.equal(records[0].periodStart,'');assert.equal(records[0].periodEnd,'');
  assert.equal(records[0].meanLikes,null);assert.equal(records[0].sessions,null);
  const draft=I.draft(records[0]);assert.match(draft.message,/11 farklı gün/);
  assert.match(draft.message,/24 bin civarında bir beğeni seviyesi/);assert.doesNotMatch(draft.message,/ortalama|medyan|ortanca|\d+ geçmiş yayınınızın/);
  const natural=I.draft({...records[0],activeDays:13,medianLikes:11850});
  assert.match(natural.observation,/12 bin civarında/);
  assert.doesNotMatch(natural.observation,/tarihli|değerlendirme|11[.,]850|ortalama/);
  const imported=I.readMessages(await R.readXlsxRows(W.buildInvitationWorkbook([draft]).buffer));
  assert.equal(imported.messages.test_legacy,draft.message);
  assert.equal(I.draft({...records[0],capturedAt:''}).message,'');
  assert.equal(I.draft({...records[0],capturedAt:'2020-01-01T00:00:00Z'}).message,'');
  const noDate={...oldRow,checkedAt:undefined};
  assert.equal(I.draft(I.readCollection(await R.readXlsxRows(W.buildNameCollectionWorkbook([noDate]).buffer))[0]).message,'');

  // Actual reported workbook: confirm missing measurements, not a parser issue.
  if(process.env.BTG_USER_COLLECTION){
    const b=fs.readFileSync(process.env.BTG_USER_COLLECTION);
    const rows=await R.readXlsxRows(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
    const input=I.readCollection(rows);
    assert.ok(input.length>0);assert.ok(input.every(r=>!r.schema&&!r.capturedAt&&r.activeDays===null&&r.meanLikes===null));
    assert.ok(input.every(r=>I.draft(r).status.includes('Excel’de eksik alanlar')));
    console.log(`Reported workbook reproduced: ${rows.length-1} rows, ${input.length} class-3 rows, all without stored measurements.`);
  }

  // Recovery UI uses the loaded file's recipient set; never replaces it with all stored users.
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{listeners:{},children:[],files:[],value:'',textContent:'',disabled:false,hidden:false,addEventListener(k,f){this.listeners[k]=f},append(...c){this.children.push(...c)},replaceChildren(){this.children=[]},setAttribute(){}});return nodes.get(id)};
  let stored={runtime:{collectionRows:[oldRow,{...oldRow,username:'not_in_file'}]}};
  let writes=0;
  ctx.document={getElementById:node,createElement:tag=>({children:[],value:'',textContent:'',append(...c){this.children.push(...c)},addEventListener(){},setAttribute(){}})};
  ctx.chrome={storage:{local:{get:async()=>stored,set:async()=>{writes++}}}};
  vm.runInContext(read('src/ui/invitations.js'),ctx);
  const oldFileBytes=W.buildNameCollectionWorkbook([{username:'test_legacy',classId:3,summary:'Düzenli'},{username:'standard_in_file',classId:2,summary:'Korunacak'}]);
  node('file').files=[{name:'old.xlsx',arrayBuffer:async()=>oldFileBytes.buffer}];
  await node('file').listeners.change();assert.equal(node('save').disabled,false,'Missing-message class-3 rows remain exportable with status in their own file');
  await node('recover').listeners.click();assert.equal(node('save').disabled,false);
  assert.match(node('status').textContent,/1 üçüncü sınıf yayıncı: 1 mesaj hazır/);
  assert.equal(node('preview').children.length,1);
  assert.equal(writes,0,'Recovery must be read-only and keep original storage intact');
  const outputs=[];ctx.window.BTGOutput={save:async(name,blob)=>{outputs.push({name,bytes:await blob.arrayBuffer()});return{ok:true,name}}};
  await node('save').listeners.click();assert.equal(outputs.length,2);
  const standard=await R.readXlsxRows(outputs[1].bytes);
  assert.deepEqual(Array.from(I.readStandardList(standard)),['standard_in_file']);
  assert.equal(standard[1][2],'Korunacak');
  await node('save').listeners.click();assert.equal(outputs.length,2);
  stored={runtime:{collectionRows:[],running:false}};
  await node('recover').listeners.click();assert.match(node('error').textContent,/son toplama kaydı bulunamadı/);
  stored={runtime:{collectionRows:[oldRow],running:true}};
  await node('recover').listeners.click();assert.match(node('error').textContent,/otomasyonu durdurun/);
  console.log('Legacy metrics recovery, preserved capture timestamp, correct median wording, recipient restriction and missing-record messages passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

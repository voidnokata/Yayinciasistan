const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const harness=fs.readFileSync(path.join(__dirname,'xlsx-reader.test.js'),'utf8');
const parser=harness.slice(harness.indexOf('class XmlNode'),harness.indexOf('const context ='));
const ctx={window:{},TextEncoder,TextDecoder,Uint8Array,DataView,Blob,Response,DecompressionStream,URL,console};
vm.createContext(ctx);vm.runInContext(parser+';globalThis.DOMParser=SimpleDOMParser;',ctx);
for(const name of ['src/core/xlsx-reader.js','src/core/xlsx-writer.js','src/core/invitation-core.js'])vm.runInContext(read(name),ctx);
const I=ctx.window.BTGInvitations,W=ctx.window.BTGXlsxWriter,R=ctx.window.BTGSpreadsheetReader;
(async()=>{
  const source=[['Yayıncı ID','Sınıf','Kısa Değerlendirme','Ek veri'],['class_one',1,'Yeni','Keep & <exact>'],['special_three',3,'Düzenli',42],['class_two',2,'Gelişiyor',0],['zero_user',0,'Yeni',''],['SPECIAL_THREE',3,'Düzenli',42],['missing_three',3,'Eksik','']];
  const original=JSON.stringify(source),split=I.splitCollection(source);
  assert.equal(JSON.stringify(source),original,'Do not mutate source');
  assert.deepEqual(Array.from(split.thirdUsernames),['special_three','missing_three']);
  assert.deepEqual(Array.from(split.remainingUsernames),['class_one','class_two','zero_user']);
  assert.ok(!split.remainingUsernames.some(n=>split.thirdUsernames.includes(n)));
  const drafts=[{username:'special_three',classId:3,message:'Özel mesaj\n\n👋',status:'Hazır'},{username:'missing_three',classId:3,message:'',status:'Eksik veri'}];
  const job=W.createInvitationExport(drafts,split.remainingRows);
  assert.equal(job.length,2);
  const special=await R.readXlsxRows(job[0].bytes.buffer),regular=await R.readXlsxRows(job[1].bytes.buffer);
  assert.equal(special.length,3);assert.equal(special[2][0],'missing_three');assert.equal(special[2][1],'');
  assert.match(special[2][4],/gönderime alınmaz/);
  assert.equal(regular.length,4);assert.equal(regular[1][3],'Keep & <exact>');assert.equal(regular[2][3],'0');
  assert.deepEqual(Array.from(I.readStandardList(regular)),['class_one','class_two','zero_user']);
  assert.deepEqual(Array.from(I.readMessages(special).usernames),['special_three']);
  assert.throws(()=>I.readStandardList(source),/3. sınıflar var/);
  assert.throws(()=>I.splitCollection([...source,['SPECIAL_THREE',1,'Düzenli',42]]),/çelişen/);
  assert.throws(()=>I.splitCollection([source[0],['bad',9,'','']]),/geçerli bir sınıf/);
  assert.equal(I.splitCollection([source[0],source[1]]).thirdRows.length,1);
  assert.equal(I.splitCollection([source[0],source[2]]).remainingRows.length,1);
  // A partial write retries only the missing file, retaining the pair's identity.
  const calls=[],successes=[];let failSecond=true;
  ctx.window.BTGOutput={save:async(name)=>{calls.push(name);if(name.includes('standart')&&failSecond){failSecond=false;throw new Error('disk error')}successes.push(name);return{ok:true,name};}};
  await assert.rejects(W.saveInvitationExport(job),/Kaydedilen:.*yalnız eksik çıktı/);
  assert.equal(successes.length,1);await W.saveInvitationExport(job);assert.equal(successes.length,2);assert.equal(calls.length,3);
  await W.saveInvitationExport(job);assert.equal(calls.length,3,'Repeated save must not duplicate a completed pair');
  if(process.env.BTG_USER_COLLECTION){
    const b=fs.readFileSync(process.env.BTG_USER_COLLECTION),rows=await R.readXlsxRows(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
    const actual=I.splitCollection(rows);
    assert.equal(actual.thirdUsernames.length,38);assert.equal(actual.remainingUsernames.length,202);
    assert.ok(!actual.thirdUsernames.some(n=>new Set(actual.remainingUsernames).has(n)));
    console.log('Actual source: 240 unique publishers → 38 special + 202 standard; zero overlap.');
  }
  console.log('Disjoint XLSX pair, original fields/order, blank-message class-3 retention, standard import, conflicts and partial-write retry passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

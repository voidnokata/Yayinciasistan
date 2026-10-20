const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../src/core/feedback-package'),C=require('../src/core/feedback-core'),H=require('../src/core/feedback-history');

function session(day,{duration='1s',viewers='100'}={}){
 return {'Başlangıç zamanı':`${day}.09.2026 12:00:00`,'CANLI Yayın süresi':duration,'İzleyici başına ort. izleme süresi':'35sn',İzleyiciler:viewers,Elmaslar:'0','CANLI Yayın türü':'Normal'};
}
function pack(sessions,id){
 const report={schemaVersion:1,username:id,requestedStart:'2026-09-07',requestedEnd:'2026-09-20',collectedAt:'2026-09-21T08:00:00Z',status:'partial',warnings:[],performance:[],sessions:{rows:sessions,tableComplete:true}};
 return P.create([report],H.empty(),C,'',{id,now:'2026-09-23T06:50:52Z'});
}
function validate(p,message){
 const record=p.manifest.records[0],rules=p.manifest.messageRules[record.recordKey];
 return P.validateRows(p.manifest,[{...record,message,...rules.fixedCells}]).errors;
}

test('A viewer count before a date cannot contribute its trailing digits as another date',()=>{
 const p=pack([session(17,{viewers:'712'}),session(10,{viewers:'235'})],'novazzzy');
 assert.equal(p.manifest.messageRules['novazzzy:1'].primaryKey,'standout-live');
 assert.deepEqual(validate(p,"Selamlar, 17 Eylül yayınında 712, 10 Eylül’de ise 235 izleyici görünmüş. O gün işe yaradığını düşündüklerini yeniden deneyebilirsin."),[]);
});

test('Natural date lists and ranges still resolve, while foreign dates remain rejected',()=>{
 const p=pack([session(17,{viewers:'712'}),session(10,{viewers:'235'})],'dates');
 for(const dates of ['10 ve 17 Eylül','10, 17 Eylül','10,17 Eylül','10–17 Eylül','10-17 Eylül']){
  assert.deepEqual(validate(p,`Selamlar, ${dates} yayınlarında 235 ve 712 izleyiciye ulaşmışsın. İşe yaradığını düşündüklerini yeniden deneyebilirsin.`),[],dates);
 }
 for(const dates of ['11 ve 17 Eylül','11, 17 Eylül','11–17 Eylül']){
  assert.ok(validate(p,`Selamlar, ${dates} yayınlarını karşılaştırdım.`).some(error=>error.includes('Mesajdaki tarih')),dates);
 }
 assert.ok(validate(p,'Selamlar, 10 ve 12 ve 17 Eylül yayınlarını karşılaştırdım.').some(error=>error.includes('Mesajdaki tarih')));
});

test('One-hour targets accept natural wording for each day the creator goes live',()=>{
 const p=pack([14,17,19].map(day=>session(day,{duration:'30dk'})),'user.emir0');
 assert.equal(p.manifest.messageRules['user.emir0:1'].primaryKey,'short-lives');
 const observations='Selamlar, 17 ve 19 Eylül yayınların 30 dakika sürmüş. ';
 for(const target of [
  'Yayın açtığın her gün en az bir yayını 1 saate tamamlamayı hedefleyebilirsin.',
  'Yayın yaptığın her gün en az bir yayında bir saate ulaşmayı hedefleyelim.',
  'Yayına çıktığın her gün en az bir yayını 60 dakikaya tamamlayabilirsin.',
  'Her yayın gününde en az bir yayını bir saate tamamlamayı hedefleyelim.'
 ])assert.deepEqual(validate(p,observations+target),[],target);
});

test('Past-only daily results and a one-hour requirement for every live are still rejected',()=>{
 const p=pack([14,17,19].map(day=>session(day,{duration:'30dk'})),'hours');
 const observations='Selamlar, 17 ve 19 Eylül yayınların 30 dakika sürmüş. ';
 for(const target of [
  'Yayın açtığın her gün en az bir yayını 1 saate tamamladın.',
  'Her yayın gününde en az bir yayını bir saate tamamlamayı hedefledin.',
  'Her yayını bir saate tamamlamalısın.',
  'Her yayında 1 saat kalmalısın.',
  'Her yayın gününde en az bir yayını 1 saate tamamlamayı hedefleyelim. Her yayını 1 saate tamamlamalısın.'
 ])assert.ok(validate(p,observations+target).some(error=>error.includes('aynı yayın günündeki koşulu')),target);
});

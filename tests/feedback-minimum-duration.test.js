const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core/feedback-core');
test('60 dakika sınırı, kısa yayınların ayrı değerlendirilmesi ve eksik süre',()=>{
 const r=C.minimumSessionDuration(['59dk 59sn','1s','1s 1sn','30dk','30dk','-'].map(s=>({'CANLI Yayın süresi':s})));
 assert.deepEqual(r.sessions.map(s=>s.meetsMinimum),[false,true,true,false,false,null]);
 assert.equal(r.qualifyingSessions,2);assert.equal(r.shortSessions,3);assert.equal(r.unknownDurationSessions,1);
 assert.equal(r.calculatedValidDays,null);
});
test('Oturum bulunamaması sıfır geçerli gün iddiasına dönüşmez',()=>{assert.equal(C.minimumSessionDuration([]).calculatedValidDays,null);});
test('45 dakika dahil, 60 dakika hariç oturumlar ve kalan süre ayrılır',()=>{
 const r=C.minimumSessionDuration(['44dk 59sn','45dk','55dk','59dk 59sn','1s','-'].map(s=>({'CANLI Yayın süresi':s})));
 assert.deepEqual(r.sessions.map(s=>s.nearMinimum),[false,true,true,true,false,null]);
 assert.deepEqual(r.sessions.map(s=>s.secondsToMinimum),[901,900,300,1,0,null]);
 assert.equal(r.nearMinimumSessions,3);
});

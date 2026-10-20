const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core/feedback-core');
test('Türkçe sayılar ve eksik veri ayrımı',()=>{
  assert.equal(C.number('3.975'),3975);assert.equal(C.number('%7,46'),7.46);
  for(const v of ['-','','%∞','1,2,3',null])assert.equal(C.number(v),null);
  assert.equal(C.number('0'),0);assert.equal(C.ratio(3,0),null);
});
test('Türkçe s saat, sn saniye; belirsiz süre reddedilir',()=>{
  assert.equal(C.seconds('1s 3dk 55sn'),3835);assert.equal(C.seconds('4dk 18sn'),258);
  assert.equal(C.seconds('9s 57dk 0sn'),35820);assert.equal(C.seconds('-'),null);assert.equal(C.seconds('3 saat?'),null);
});
test('30 günlük pencereler katılımdan itibaren boşluksuz',()=>{
  const periods=C.ranges('2026-07-01','2026-09-14');assert.equal(periods.length,3);
  assert.deepEqual(periods[0],{start:'2026-07-01',end:'2026-07-30'});
  assert.equal(periods[1].start,'2026-07-31');assert.equal(periods.at(-1).end,'2026-09-14');
  assert.deepEqual(C.ranges('2026-09-15','2026-09-14'),[]);
  assert.equal(C.iso('31.02.2026'),null);assert.equal(C.iso('10.09.2026 23:18:58'),'2026-09-10');
});
test('Gerçek cfrkn2 günlük örneği: 567 elmas, 14 takipçi, 9s57dk',()=>{
  const raw=[['14', '322','1s 3dk 55sn','7'],['13','0','0','0'],['12','145','2s 59dk 43sn','1'],['11','38','4s 11dk 19sn','4'],['10','62','1s 42dk 3sn','2']];
  const rows=raw.map(([d,e,s,f])=>({Tarih:d+'.09.2026(UTC+00:00)',Elmaslar:e,'CANLI Yayın süresi':s,'Yeni takipçiler':f}));
  const a=C.analyze({performance:[{rows}],sessions:{rows:[]}});
  assert.equal(a.diamonds,567);assert.equal(a.newFollowers,14);assert.equal(a.durationSeconds,35820);assert.equal(a.activeDays,4);
  assert.ok(Math.abs(a.diamondsPerHour-56.9849)<0.001);
  rows[0].Elmaslar='-';assert.equal(C.analyze({performance:[{rows}]}).diamonds,null);
});
test('Eksik izleyici ve çift tarihte yanlış oran/toplam üretilmez',()=>{
  const row={Tarih:'10.09.2026',Elmaslar:'10','CANLI Yayın süresi':'1s','Yeni takipçiler':'1'};
  const a=C.analyze({performance:[{rows:[row,row]}],sessions:{rows:[{'İzleyiciler':'-','Yeni takipçiler':'2'}]}});
  assert.equal(a.dailyRows,1);assert.equal(a.diamonds,10);assert.equal(a.sessions[0].followConversion,null);
  assert.ok(a.warnings.some(w=>w.includes('Tekrarlanan')));
});

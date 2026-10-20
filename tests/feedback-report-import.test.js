const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../src/core/feedback-package'),C=require('../src/core/feedback-core'),H=require('../src/core/feedback-history');
const file=(name,value)=>({name,size:100,text:async()=>typeof value==='string'?value:JSON.stringify(value)});
const report=username=>({schemaVersion:1,username,collectedAt:'2026-09-17T08:00:00Z',requestedStart:'2026-09-01',requestedEnd:'2026-09-16',performance:[{rows:[]}],warnings:[]});
test('Selecting 54 creator JSONs plus the scan summary keeps all creators and produces a valid package',async()=>{
 const files=[file('00_oturum.json',{creators:[]}),...Array.from({length:54},(_,i)=>file('creator'+i+'.json',report('creator'+i)))];
 const result=await P.readReportFiles(files);
 assert.equal(result.reports.length,54);assert.equal(result.skipped.length,1);assert.match(result.skipped[0].reason,/Toplu tarama özeti/);
 assert.equal(P.create(result.reports,H.empty(),C,'',{id:'import-test'}).manifest.records.length,54);
});
test('Mixed folder selection excludes invalid or unavailable records with filenames while retaining partial usable data',async()=>{
 const usable={...report('partial'),status:'partial',warnings:['Regional data missing']};
 const result=await P.readReportFiles([file('notes.txt','plain'),file('bad.json','{'),file('null.json','null'),file('no-data.json',{...report('empty'),performance:[]}),file('bad-date.json',{...report('badDate'),requestedStart:null}),file('conflict.json',{...report('conflict'),creatorId:42}),file('partial.json','\uFEFF'+JSON.stringify(usable))]);
 assert.deepEqual(result.reports,[{...report('empty'),performance:[]},usable]);assert.equal(result.skipped.length,5);assert.ok(result.skipped.every(f=>f.name&&f.reason));
});
test('Empty selection and unreadable files never become a usable report',async()=>{
 assert.deepEqual(await P.readReportFiles([]),{reports:[],skipped:[]});
 const result=await P.readReportFiles([{name:'large.json',size:21*1024*1024,text:async()=>{throw Error('Must not read');}}, {name:'failed.json',size:1,text:async()=>{throw Error('Read failed');}}]);
 assert.equal(result.reports.length,0);assert.equal(result.skipped.length,2);
});
test('A missing daily table does not discard usable single-live evidence',async()=>{
 const r={...report('creator'),performance:[],sessions:{rows:[13,14,15].map(day=>({'Başlangıç zamanı':day+'.09.2026 12:00:00','CANLI Yayın süresi':'59dk','İzleyiciler':'100'}))},warnings:['Daily table unavailable'],status:'partial'};
 const result=await P.readReportFiles([file('creator.json',r)]);assert.equal(result.reports.length,1);assert.equal(result.skipped.length,0);
 const pack=P.create(result.reports,H.empty(),C,'',{id:'partial'});assert.equal(pack.manifest.records.length,1);assert.equal(pack.manifest.messageRules['partial:1'].primaryKey,'short-lives');
});

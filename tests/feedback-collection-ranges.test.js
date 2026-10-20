const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectionRanges}=require('../src/core/feedback-core');
test('Most recent 14 days come first; older windows cover every date exactly once',()=>{
 const periods=collectionRanges('2026-06-03','2026-09-20');
 assert.deepEqual(periods[0],{start:'2026-09-07',end:'2026-09-20'});
 const dates=periods.flatMap(p=>{const days=[];for(let t=Date.parse(p.start);t<=Date.parse(p.end);t+=86400000)days.push(t);assert.ok(days.length<=30);return days;});
 assert.equal(new Set(dates).size,dates.length);assert.equal(dates.length,(Date.parse('2026-09-20')-Date.parse('2026-06-03'))/86400000+1);
 for(let i=1;i<periods.length;i++)assert.ok(periods[i].end<periods[i-1].start);
});
test('New join has one bounded window and a future join has no completed window',()=>{
 assert.deepEqual(collectionRanges('2026-09-14','2026-09-20'),[{start:'2026-09-14',end:'2026-09-20'}]);
 assert.deepEqual(collectionRanges('2026-09-21','2026-09-20'),[]);
});

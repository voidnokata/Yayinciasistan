const {test}=require('node:test'),assert=require('node:assert/strict'),H=require('../src/core/feedback-history');
const now='2026-09-16T12:00:00Z',scan='2026-09-14T12:00:00Z';
function sample(){return {creators:{'username:demo':{key:'username:demo',username:'demo',id:null,snapshots:[{id:scan,status:'partial',source:{collectedAt:scan}}],sent:[{sentAt:'2026-09-15T12:00:00Z',sourceSnapshotId:scan}]}}};}
test('Recent scan and confirmed sent history together skip, draft or scan alone do not',()=>{
 const s=sample();assert.ok(H.recentFeedback(s,{username:'demo'},now));s.creators['username:demo'].sent=[];s.creators['username:demo'].draft={text:'draft'};assert.equal(H.recentFeedback(s,{username:'demo'},now),null);
});
test('Rolling seven days expire exactly, future sends and old linked data do not skip',()=>{
 for(const sentAt of ['2026-09-09T12:00:00Z','2026-09-17T12:00:00Z','bad']){const s=sample();s.creators['username:demo'].sent[0].sentAt=sentAt;assert.equal(H.recentFeedback(s,{username:'demo'},now),null);}
 const s=sample();s.creators['username:demo'].sent[0].sourceSnapshotId='old';assert.equal(H.recentFeedback(s,{username:'demo'},now),null);
 s.creators['username:demo'].sent[0].sourceSnapshotId=scan;s.creators['username:demo'].snapshots[0].status='error';assert.equal(H.recentFeedback(s,{username:'demo'},now),null);
});
test('Stable identity supports renamed creator but not another known ID',()=>{
 const s=sample();s.creators['username:demo'].id='123456789012';assert.ok(H.recentFeedback(s,{username:'renamed',creatorId:'123456789012'},now));assert.equal(H.recentFeedback(s,{username:'demo',creatorId:'987654321098'},now),null);
});

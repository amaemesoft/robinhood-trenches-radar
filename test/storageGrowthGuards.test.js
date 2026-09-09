'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Storage=require('../lib/storage');
const ShadowStore=require('../lib/shadowStore');
const CycleRuntime=require('../lib/cycleRuntime');
const {buildCycleUniverse}=require('../lib/cycleUniverse');
const A='0x1111111111111111111111111111111111111111';

test('updatedAt-only saves do not rewrite radar_state',async()=>{
  const s=new Storage({filePath:'/tmp/nope',databaseUrl:''});
  let writes=0;
  s.pool={query:async sql=>{if(String(sql).startsWith('INSERT INTO radar_state'))writes++;return{rows:[]};}};
  s.lastPersistedHash=Storage.contentHash({value:1,updatedAt:'old'});
  s.save({value:1});await s.flush();assert.equal(writes,0);
  s.save({value:2});await s.flush();assert.equal(writes,1);
});

test('shadow decision fingerprint ignores time-only churn',()=>{
  const base={kind:'decision',id:'a',at:'2026-09-09T06:00:00Z',tokenAddress:A,decision:'WAIT',evidence:{market:{priceUsd:1}},agents:{ATLAS:{status:'PASS',ageSeconds:1}}};
  const a=ShadowStore.decisionFingerprint(base);
  const b=ShadowStore.decisionFingerprint({...base,id:'b',at:'2026-09-09T06:02:00Z',agents:{ATLAS:{status:'PASS',ageSeconds:121}}});
  assert.equal(a,b);
  assert.notEqual(a,ShadowStore.decisionFingerprint({...base,evidence:{market:{priceUsd:2}}}));
});

test('cycle score history samples at 15m instead of rewriting every 2m',()=>{
  const r=new CycleRuntime({maxScoreSnapshots:100}),db={};
  assert.equal(r.recordScore(db,A,50,'EMERGING','2026-09-09T06:00:00Z'),true);
  assert.equal(r.recordScore(db,A,51,'EMERGING','2026-09-09T06:02:00Z'),false);
  assert.equal(r.recordScore(db,A,52,'EMERGING','2026-09-09T06:15:00Z'),true);
  assert.equal(db.cycleScoreHistory[A].length,2);
});

test('tokenState alone cannot permanently expand Cycle universe',()=>{
  const now=Date.parse('2026-09-09T06:00:00Z');
  const rows=buildCycleUniverse({events:[],tokenState:{[A]:{contractExists:true,observedAt:new Date(now).toISOString()}},holderHistory:{},marketHistory:{},now});
  assert.equal(rows.some(x=>x.tokenAddress===A),false);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const CycleRuntime=require('../lib/cycleRuntime');

const ADDRESS='0x1111111111111111111111111111111111111111';

test('holder snapshot writes exact-contract history and respects interval cache',async()=>{
  let calls=0;
  const runtime=new CycleRuntime({snapshotIntervalMs:3600000,holderProvider:{snapshot:async()=>{calls++;return{status:'MEASURED',observedAt:'2026-09-07T20:00:00Z',holders:1000,top10Pct:22,source:'test'};}}});
  const db={marketHistory:{},holderHistory:{},holderSnapshotStatus:{}};
  const first=await runtime.maybeSnapshotHolders(db,ADDRESS,{priceUsd:0.01,execution:{pairAddress:'0x2222222222222222222222222222222222222222'}},{force:true});
  assert.equal(first.status,'MEASURED');
  assert.equal(db.holderHistory[ADDRESS].length,1);
  assert.equal(db.holderHistory[ADDRESS][0].holders,1000);
  const second=await runtime.maybeSnapshotHolders(db,ADDRESS,{priceUsd:0.02});
  assert.equal(second.skipped,true);
  assert.equal(calls,1);
});

test('unknown holder provider result never creates fake history',async()=>{
  const runtime=new CycleRuntime({holderProvider:{snapshot:async()=>({status:'UNKNOWN',reason:'provider_unavailable',holders:null,top10Pct:null})}});
  const db={marketHistory:{},holderHistory:{},holderSnapshotStatus:{}};
  const result=await runtime.maybeSnapshotHolders(db,ADDRESS,{}, {force:true});
  assert.equal(result.status,'UNKNOWN');
  assert.equal(db.holderHistory[ADDRESS],undefined);
  assert.equal(db.holderSnapshotStatus[ADDRESS].status,'UNKNOWN');
});

test('metrics exposes current holder snapshot while growth remains unknown with one observation',()=>{
  const runtime=new CycleRuntime({});
  const db={marketHistory:{},holderHistory:{[ADDRESS]:[{at:'2026-09-07T20:00:00Z',holders:1234,top10Pct:25}]},holderSnapshotStatus:{}};
  const metrics=runtime.metrics(db,ADDRESS);
  assert.equal(metrics.holders.status,'UNKNOWN');
  assert.equal(metrics.holders.currentHolders,1234);
  assert.equal(metrics.holders.top10Pct,25);
});

test('score velocity measures improvement in Cycle Potential rather than event count',()=>{
  const runtime=new CycleRuntime({});
  const now=Date.parse('2026-09-08T00:00:00Z');
  const db={cycleScoreHistory:{[ADDRESS]:[
    {at:'2026-09-04T00:00:00Z',score:40,stage:'EMERGING'},
    {at:'2026-09-07T00:00:00Z',score:55,stage:'BREAKOUT'},
    {at:'2026-09-07T18:00:00Z',score:61,stage:'BREAKOUT'},
    {at:'2026-09-08T00:00:00Z',score:66,stage:'BREAKOUT'}
  ]}};
  const v=runtime.scoreVelocity(db,ADDRESS,now);
  assert.equal(v.delta6h,5);
  assert.equal(v.delta24h,11);
  assert.equal(v.delta3d,26);
  assert.equal(v.direction,'RISING_FAST');
});

test('current holdings snapshots are cached independently from holder-count snapshots',async()=>{
  let calls=0;
  const runtime=new CycleRuntime({holdingsIntervalMs:3600000,holdingsProvider:{snapshot:async()=>{calls++;return{status:'MEASURED',qualifiedHolders:2,provisionalHolders:1,observedAt:new Date().toISOString()};}}});
  const db={};
  const first=await runtime.maybeSnapshotMoneyHoldings(db,ADDRESS,[],{force:true});
  assert.equal(first.qualifiedHolders,2);
  const second=await runtime.maybeSnapshotMoneyHoldings(db,ADDRESS,[]);
  assert.equal(second.skipped,true);
  assert.equal(calls,1);
});

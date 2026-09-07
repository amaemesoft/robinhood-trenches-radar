'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Cycle=require('../lib/cycleEngine');

const now=Date.parse('2026-09-08T00:00:00Z');
const atDays=d=>new Date(now-d*86400e3).toISOString();
const safety={tokenControl:'PASS',upgradeAuthority:'PASS',canonicalLp:'PASS',sellRestriction:'PASS'};
const execution={liquidityUsd:800000,sellImpactPct:1.5,currentMarketCap:12e6};
const actors={
  m1:{id:'m1',kind:'money',identityConfidence:'verified',adaptiveScore:85},
  m2:{id:'m2',kind:'money',identityConfidence:'strong',adaptiveScore:78},
  p1:{id:'p1',kind:'money',identityConfidence:'attributed',attributionStatus:'provisional',sampleSize:0,adaptiveScore:20},
  s1:{id:'s1',kind:'social',adaptiveScore:70},s2:{id:'s2',kind:'social',adaptiveScore:68}
};

test('social discovery can build culture but never smart-money score',()=>{
  const r=Cycle.evaluateCycleToken({actors,safety,execution,token:{marketCap:12e6},now,events:[
    {actorId:'s1',action:'SCOUT',source:'fxtwitter',at:atDays(1)},
    {actorId:'s2',action:'SCOUT',source:'telegram',at:atDays(2)}
  ]});
  assert.ok(r.components.culture>0);
  assert.equal(r.components.money,0);
  assert.equal(r.evidence.moneyActors,0);
});

test('current established holdings support Cycle adoption without creating a BUY event',()=>{
  const r=Cycle.evaluateCycleToken({actors,safety,execution,token:{marketCap:12e6},now,events:[],cycleMetrics:{holdings:{status:'MEASURED',coverage:1,qualifiedActorIds:['m1','m2'],qualifiedHolders:2,provisionalActorIds:[]}}});
  assert.ok(r.components.money>=60);
  assert.equal(r.evidence.currentQualifiedMoneyHolders,2);
});

test('provisional wallet activity and balances are observation-only',()=>{
  const r=Cycle.evaluateCycleToken({actors,safety,execution,token:{marketCap:12e6},now,events:[
    {actorId:'p1',action:'BUY',at:atDays(1),marketCap:10e6}
  ],cycleMetrics:{holdings:{status:'MEASURED',coverage:1,qualifiedActorIds:[],qualifiedHolders:0,provisionalActorIds:['p1'],provisionalHolders:1}}});
  assert.equal(r.components.money,0);
  assert.equal(r.evidence.provisionalMoneyObserved,1);
  assert.ok(r.risks.some(x=>x.includes('provisional')));
});

test('missing holder and resilience history caps generational stages',()=>{
  const r=Cycle.evaluateCycleToken({actors,safety,execution,token:{marketCap:40e6},now,events:[
    {actorId:'m1',action:'BUY',at:atDays(1),marketCap:4e6},{actorId:'m2',action:'BUY',at:atDays(1),marketCap:4e6},
    {actorId:'s1',action:'SCOUT',source:'x',at:atDays(1)},{actorId:'s2',action:'SCOUT',source:'telegram',at:atDays(1)}
  ],cycleMetrics:{holdings:{status:'MEASURED',coverage:1,qualifiedActorIds:['m1','m2']}}});
  assert.ok(r.score<=84);
  assert.notEqual(r.stage,'CHAIN_ICON');
  assert.notEqual(r.stage,'CYCLE_MEME');
});

test('measured holders plus post-crash resilience can unlock upper stages without tactical semantics',()=>{
  const r=Cycle.evaluateCycleToken({actors,safety,execution:{...execution,exitabilityScore:95},token:{marketCap:35e6},now,events:[
    {actorId:'m1',action:'BUY',at:atDays(12),marketCap:5e6},{actorId:'m2',action:'BUY',at:atDays(9),marketCap:6e6},
    {actorId:'s1',action:'SCOUT',source:'fxtwitter',at:atDays(4)},{actorId:'s2',action:'SCOUT',source:'telegram',at:atDays(2)}
  ],cycleMetrics:{
    holdings:{status:'MEASURED',coverage:1,qualifiedActorIds:['m1','m2']},
    holders:{status:'MEASURED',score:92,confidence:.85,currentHolders:20000,changes:{'24h':8,'72h':20,'168h':45}},
    organic:{status:'MEASURED',score:90},resilience:{status:'MEASURED',score:88,confidence:.8,maxDrawdownPct:48,peakRecoveryPct:95},
    marketStructure:{status:'MEASURED',score:90,confidence:1,liquidityToMcap:.08,volumeToMcap:.6}
  }});
  assert.ok(r.score>=70);
  assert.equal(r.gates.chainIconGate,true);
  assert.equal(r.version,3);
});

test('hypervelocity with weak holder absorption gets meteor warning rather than durability credit',()=>{
  const recent=Array.from({length:10},(_,i)=>({actorId:i%2?'s1':'s2',action:'SCOUT',source:i%2?'x':'telegram',at:new Date(now-i*20*60e3).toISOString()}));
  const r=Cycle.evaluateCycleToken({actors,safety,execution,token:{marketCap:8e6},now,events:recent,cycleMetrics:{
    holders:{status:'MEASURED',score:55,confidence:.3,currentHolders:5000},organic:{status:'MEASURED',score:25},resilience:{status:'NOT_TESTED',score:null,confidence:.2},marketStructure:{status:'MEASURED',score:70}
  },candidateMeta:{firstSeenAt:atDays(5)}});
  assert.ok(r.analogues.some(a=>['BODEN','BOME'].includes(a.key)));
  assert.ok(r.score<=84);
});

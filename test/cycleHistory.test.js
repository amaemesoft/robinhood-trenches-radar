'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const History=require('../lib/cycleHistory');

const HOUR=3600e3;
const start=Date.parse('2026-09-01T00:00:00Z');
const row=(hours,price,liquidity=100000)=>({at:new Date(start+hours*HOUR).toISOString(),priceUsd:price,liquidityUsd:liquidity});

test('resilience remains unknown with too little history',()=>{
  const r=History.longHorizonResilience([row(0,1),row(1,0.9),row(2,1.05)]);
  assert.equal(r.status,'UNKNOWN');
  assert.equal(r.score,null);
});

test('absence of a stress event is NOT_TESTED, not a resilience pass',()=>{
  const rows=Array.from({length:20},(_,i)=>row(i*3,1+i*0.005,100000+i*1000));
  const r=History.longHorizonResilience(rows,{minSnapshots:12,minHistoryHours:36});
  assert.equal(r.status,'NOT_TESTED');
  assert.equal(r.score,null);
  assert.equal(r.reason,'no_material_stress_event');
});

test('material drawdown with strong recovery earns measured resilience',()=>{
  const prices=[1,1.05,1.1,1.0,0.85,0.68,0.55,0.58,0.64,0.72,0.82,0.9,0.98,1.02,1.04,1.06];
  const rows=prices.map((p,i)=>row(i*6,p,120000+i*4000));
  const r=History.longHorizonResilience(rows,{minSnapshots:12,minHistoryHours:36,minPostStressHours:12});
  assert.equal(r.status,'MEASURED');
  assert.ok(r.maxDrawdownPct>=45);
  assert.ok(r.score>=75);
  assert.ok(r.confidence>0.5);
});

test('material drawdown that stays broken scores low',()=>{
  const prices=[1,1.08,1.1,0.9,0.7,0.5,0.42,0.39,0.4,0.41,0.4,0.38,0.37,0.36,0.35,0.34];
  const rows=prices.map((p,i)=>row(i*6,p,i<7?150000:45000));
  const r=History.longHorizonResilience(rows,{minSnapshots:12,minHistoryHours:36,minPostStressHours:12});
  assert.equal(r.status,'MEASURED');
  assert.ok(r.maxDrawdownPct>60);
  assert.ok(r.score<50);
});

test('recent crash stays TESTING until enough post-stress time passes',()=>{
  const prices=[1,1.02,1.04,1.05,1.03,1.02,1.01,1.0,0.98,0.96,0.9,0.7,0.55];
  const rows=prices.map((p,i)=>row(i*4,p,100000));
  const r=History.longHorizonResilience(rows,{minSnapshots:12,minHistoryHours:36,minPostStressHours:12});
  assert.equal(r.status,'TESTING');
  assert.equal(r.score,null);
});

test('holder score rewards persistent growth and improving concentration',()=>{
  const holders=[1000,1100,1200,1300,1450,1600,1800,2100];
  const rows=holders.map((h,i)=>({at:new Date(start+i*24*HOUR).toISOString(),holders:h,top10Pct:30-i,priceUsd:1}));
  const r=History.holderGrowthMetrics(rows);
  assert.equal(r.status,'MEASURED');
  assert.ok(r.score>=80);
  assert.ok(r.changes['24h']>0);
  assert.ok(r.distributionScore>=80);
});

test('holder count without history stays unknown',()=>{
  const r=History.holderGrowthMetrics([{at:new Date(start).toISOString(),holders:20000}]);
  assert.equal(r.status,'UNKNOWN');
  assert.equal(r.score,null);
});

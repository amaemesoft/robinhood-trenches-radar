'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {holderPriceDivergence,marketStructure,marketTrajectory}=require('../lib/cycleOrganic');
const H=3600e3,start=Date.parse('2026-09-01T00:00:00Z');
const holder=(h,holders,price)=>({at:new Date(start+h*H).toISOString(),holders,priceUsd:price});
const market=(h,mc,liq=100000)=>({at:new Date(start+h*H).toISOString(),marketCap:mc,liquidityUsd:liq});

test('holders expanding faster than price is strong organic evidence',()=>{
  const r=holderPriceDivergence([holder(0,1000,1),holder(24,1120,1.05)],24);
  assert.equal(r.status,'MEASURED');
  assert.ok(r.score>=90);
  assert.equal(r.holderGrowthPct,12);
});

test('price pump without holder expansion is penalized as chase-like',()=>{
  const r=holderPriceDivergence([holder(0,1000,1),holder(24,1010,1.8)],24);
  assert.equal(r.status,'MEASURED');
  assert.ok(r.score<=30);
});

test('market structure rewards real liquidity and volume relative to market cap',()=>{
  const r=marketStructure([{at:'2026-09-07T00:00:00Z',marketCap:10e6,liquidityUsd:800000,volume24h:8e6,buys24h:2000,sells24h:1500}]);
  assert.equal(r.status,'MEASURED');
  assert.ok(r.score>=85);
  assert.equal(r.liquidityToMcap,0.08);
});

test('missing market fields remain unknown',()=>{
  const r=marketStructure([{at:'2026-09-07T00:00:00Z'}]);
  assert.equal(r.status,'UNKNOWN');
  assert.equal(r.score,null);
});

test('observed 5x within 72 hours is classified as hypervelocity rather than durability',()=>{
  const r=marketTrajectory([market(0,1e6),market(12,1.8e6),market(30,3e6),market(60,5.5e6),market(72,5e6)]);
  assert.equal(r.status,'MEASURED');
  assert.equal(r.trajectory,'HYPERVELOCITY');
  assert.ok(r.timeTo5xHours<=72);
  assert.ok(r.peakMultiple>=5);
});

test('multi-week expansion with limited current drawdown is compounding',()=>{
  const r=marketTrajectory([market(0,1e6),market(7*24,1.5e6),market(15*24,2.2e6),market(25*24,2.8e6),market(35*24,3.4e6),market(40*24,3.0e6)]);
  assert.equal(r.status,'MEASURED');
  assert.equal(r.trajectory,'LONG_COMPOUNDER');
  assert.ok(r.observedHours>=30*24);
});

test('market trajectory never calls one snapshot a trend',()=>{
  const r=marketTrajectory([market(0,5e6)]);
  assert.equal(r.status,'UNKNOWN');
  assert.equal(r.multipleFromFirst,null);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CYCLE_SEEDS,buildCycleUniverse,groupCycleEvents}=require('../lib/cycleUniverse');

const MICRO='0xd5f1afea47b1a9eab414d2ee740cf1d6d039e725';
const FRONG='0x6245e67affa44a23077f0ea7f981a8dc743a0c47';
const OTHER='0x1111111111111111111111111111111111111111';
const now=Date.parse('2026-09-07T21:00:00Z');
const atDaysAgo=d=>new Date(now-d*24*3600e3).toISOString();

test('cycle universe always retains exact seeded contracts even without 24h events',()=>{
  const universe=buildCycleUniverse({events:[],now});
  const addresses=new Set(universe.map(x=>x.tokenAddress));
  assert.ok(addresses.has(MICRO));
  assert.ok(addresses.has(FRONG));
});

test('cycle universe keeps 30d cultural history while tactical 24h can be empty',()=>{
  const events=[{tokenAddress:OTHER,actorId:'s1',action:'SCOUT',at:atDaysAgo(8)}];
  const universe=buildCycleUniverse({events,now,windowDays:30});
  assert.ok(universe.some(x=>x.tokenAddress===OTHER));
  const groups=groupCycleEvents(events,now,30);
  assert.equal(groups.get(OTHER).length,1);
});

test('events older than cycle window do not resurrect arbitrary tokens',()=>{
  const events=[{tokenAddress:OTHER,actorId:'s1',action:'SCOUT',at:atDaysAgo(45)}];
  const universe=buildCycleUniverse({events,now,windowDays:30,tokenState:{},holderHistory:{},marketHistory:{}});
  assert.equal(universe.some(x=>x.tokenAddress===OTHER),false);
});

test('cycle seeds use exact distinct valid contracts',()=>{
  assert.equal(CYCLE_SEEDS.length,2);
  assert.equal(new Set(CYCLE_SEEDS.map(x=>x.tokenAddress)).size,2);
  assert.ok(CYCLE_SEEDS.every(x=>/^0x[a-f0-9]{40}$/.test(x.tokenAddress)));
});

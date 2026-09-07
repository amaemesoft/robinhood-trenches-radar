'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCycleBoard}=require('../lib/cycleBoard');
const CycleRuntime=require('../lib/cycleRuntime');

const MICRO='0xd5f1afea47b1a9eab414d2ee740cf1d6d039e725';
const FRONG='0x6245e67affa44a23077f0ea7f981a8dc743a0c47';
const OTHER='0x1111111111111111111111111111111111111111';
const now=Date.parse('2026-09-08T00:00:00Z');

function dbBase(){return{events:[],tokenState:{},marketHistory:{},holderHistory:{},holderSnapshotStatus:{},moneyHoldingsStatus:{},cycleScoreHistory:{}};}

test('MICRODUCK and FRONG remain on Cycle board with zero tactical events',()=>{
  const board=buildCycleBoard({db:dbBase(),actors:{},cycleRuntime:new CycleRuntime({}),tacticalSignals:[],now});
  const addresses=new Set(board.map(x=>x.tokenAddress));
  assert.ok(addresses.has(MICRO));
  assert.ok(addresses.has(FRONG));
  assert.equal(board.find(x=>x.tokenAddress===MICRO).state,'NO_RECENT_SIGNAL');
  assert.equal(board.find(x=>x.tokenAddress===FRONG).cyclePinned,true);
});

test('an 8-day-old scout disappears from tactical board but remains Cycle evidence',()=>{
  const db=dbBase();
  db.events.push({tokenAddress:OTHER,actorId:'s1',action:'SCOUT',source:'x',at:new Date(now-8*86400e3).toISOString(),symbol:'OLD'});
  const actors={s1:{kind:'social',adaptiveScore:70}};
  const board=buildCycleBoard({db,actors,cycleRuntime:new CycleRuntime({}),tacticalSignals:[],now});
  const row=board.find(x=>x.tokenAddress===OTHER);
  assert.ok(row);
  assert.equal(row.state,'NO_RECENT_SIGNAL');
  assert.ok(row.cycleComponents.culture>0);
});

test('Cycle score history drives rising-fastest deltas independently from event freshness',()=>{
  const db=dbBase();
  db.cycleScoreHistory[MICRO]=[
    {at:'2026-09-07T00:00:00Z',score:50,stage:'EMERGING'},
    {at:'2026-09-07T18:00:00Z',score:58,stage:'BREAKOUT'}
  ];
  const board=buildCycleBoard({db,actors:{},cycleRuntime:new CycleRuntime({}),tacticalSignals:[],now,recordScores:true});
  const row=board.find(x=>x.tokenAddress===MICRO);
  assert.ok(Number.isFinite(row.cycleDelta6h));
  assert.ok(Number.isFinite(row.cycleDelta24h));
});

test('tactical state is joined by exact contract and never recomputed from 90d Cycle events',()=>{
  const db=dbBase();
  db.events.push({tokenAddress:OTHER,actorId:'m1',action:'BUY',at:new Date(now-20*86400e3).toISOString(),marketCap:1e6});
  const actors={m1:{kind:'money',identityConfidence:'verified',adaptiveScore:80}};
  const board=buildCycleBoard({db,actors,cycleRuntime:new CycleRuntime({}),tacticalSignals:[],now});
  const row=board.find(x=>x.tokenAddress===OTHER);
  assert.equal(row.state,'NO_RECENT_SIGNAL');
  assert.notEqual(row.reason,'alpha_safety_execution_align');
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ShadowDesk=require('../lib/shadowDesk');
const TOKEN='0x1111111111111111111111111111111111111111';
function state(price,observedAt,safety='PASS',impact=3){return{[TOKEN]:{priceUsd:price,observedAt,safety:{tokenControl:safety,upgradeAuthority:safety,canonicalLp:safety,sellRestriction:safety},execution:{exitQuoteStatus:'PASS',sellImpactPct:impact,exitabilityTargetUsd:250}}};}
function sig(stateName='ENTRY_CANDIDATE'){return[{tokenAddress:TOKEN,symbol:'TEST',state:stateName,score:80}]}

test('SENTINEL blocks UNKNOWN safety and no paper entry occurs',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString(),'UNKNOWN'),now:t});
  r=desk.run({state:r.state,tacticalSignals:sig(),tokenState:state(.95,new Date(t+1000).toISOString(),'UNKNOWN'),now:t+1000});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.recentDecisions[0].agents.SENTINEL.status,'BLOCK');
});

test('VECTOR waits, PULSE accepts later pullback, FUSE opens shadow position',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1000,minPullbackPct:3,maxPullbackPct:18});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.setups.length,1);
  r=desk.run({state:r.state,tacticalSignals:sig(),tokenState:state(.95,new Date(t+61000).toISOString()),now:t+61000});
  assert.equal(r.snapshot.positions.length,1);
  assert.equal(r.snapshot.recentTrades[0].side,'BUY_SHADOW');
  assert.equal(r.snapshot.recentDecisions[0].agents.FUSE.status,'APPROVE');
});

test('PULSE does not chase when there is no pullback',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1000});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
  r=desk.run({state:r.state,tacticalSignals:sig(),tokenState:state(1.2,new Date(t+61000).toISOString()),now:t+61000});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.recentDecisions[0].agents.PULSE.status,'WAIT');
});

test('LEDGER closes paper position on DISTRIBUTION',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1000});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
  r=desk.run({state:r.state,tacticalSignals:sig(),tokenState:state(.95,new Date(t+61000).toISOString()),now:t+61000});
  assert.equal(r.snapshot.positions.length,1);
  r=desk.run({state:r.state,tacticalSignals:sig('DISTRIBUTION'),tokenState:state(1.1,new Date(t+122000).toISOString()),now:t+122000});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.recentTrades[0].side,'SELL_SHADOW');
  assert.match(r.snapshot.recentTrades[0].reason,/distribution/);
});

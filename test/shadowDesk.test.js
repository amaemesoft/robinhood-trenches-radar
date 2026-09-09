'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ShadowDesk=require('../lib/shadowDesk');
const actors={a:{kind:'money',identityConfidence:'verified'},b:{kind:'money',identityConfidence:'strong'}};
const TOKEN='0x1111111111111111111111111111111111111111';
function state(price,observedAt,safety='PASS',impact=3){return{[TOKEN]:{priceUsd:price,observedAt,contractExists:true,safety:{tokenControl:safety,upgradeAuthority:safety,canonicalLp:safety,sellRestriction:safety},execution:{exitQuoteStatus:'PASS',sellImpactPct:impact,exitabilityTargetUsd:250,liquidityUsd:100000}}};}
function sig(stateName='ENTRY_CANDIDATE'){return[{tokenAddress:TOKEN,symbol:'TEST',state:stateName,score:80,events:['a','b'].map((actorId,i)=>({actorId,action:'BUY',tokenAddress:TOKEN,at:'2026-09-08T19:59:00Z',txHash:'0x'+String(i+1).repeat(64)}))}]}

test('SENTINEL blocks UNKNOWN safety and no paper entry occurs',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({actors,tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString(),'UNKNOWN'),now:t});
  r=desk.run({actors,state:r.state,tacticalSignals:sig(),tokenState:state(.95,new Date(t+1000).toISOString(),'UNKNOWN'),now:t+1000});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.recentDecisions[0].agents.SENTINEL.status,'BLOCK');
});

test('VECTOR waits, PULSE accepts later pullback, FUSE opens shadow position',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1000,minPullbackPct:3,maxPullbackPct:18});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({actors,tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.setups.length,1);
  r=desk.run({actors,state:r.state,tacticalSignals:sig(),tokenState:state(.95,new Date(t+61000).toISOString()),now:t+61000});
  assert.equal(r.snapshot.positions.length,1);
  assert.equal(r.snapshot.recentTrades[0].side,'BUY_SHADOW');
  assert.equal(r.snapshot.recentDecisions[0].agents.FUSE.status,'APPROVE');
});

test('PULSE does not chase when there is no pullback',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1000});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({actors,tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
  r=desk.run({actors,state:r.state,tacticalSignals:sig(),tokenState:state(1.2,new Date(t+61000).toISOString()),now:t+61000});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.recentDecisions[0].agents.PULSE.status,'WAIT');
});

test('LEDGER closes paper position on DISTRIBUTION',()=>{
  const desk=new ShadowDesk({minSetupAgeMs:1000});
  const t=Date.parse('2026-09-08T20:00:00Z');
  let r=desk.run({actors,tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
  r=desk.run({actors,state:r.state,tacticalSignals:sig(),tokenState:state(.95,new Date(t+61000).toISOString()),now:t+61000});
  assert.equal(r.snapshot.positions.length,1);
  r=desk.run({actors,state:r.state,tacticalSignals:sig('DISTRIBUTION'),tokenState:state(1.1,new Date(t+122000).toISOString()),now:t+122000});
  assert.equal(r.snapshot.positions.length,0);
  assert.equal(r.snapshot.recentTrades[0].side,'SELL_SHADOW');
  assert.match(r.snapshot.recentTrades[0].reason,/distribution/);
});

test('future timestamps, missing impact and absent liquidity fail closed',()=>{
  const t=Date.parse('2026-09-08T20:00:00Z'),desk=new ShadowDesk({minSetupAgeMs:1});
  for(const mutate of [m=>m[TOKEN].observedAt=new Date(t+100000).toISOString(),m=>m[TOKEN].execution.sellImpactPct=null,m=>m[TOKEN].execution.liquidityUsd=null,m=>m[TOKEN].contractExists=false]){
    let r=desk.run({actors,tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
    const m=state(.95,new Date(t+1000).toISOString());mutate(m);
    r=desk.run({actors,state:r.state,tacticalSignals:sig(),tokenState:m,now:t+1000});assert.equal(r.trades.length,0);
  }
});
test('SCOUT, ACQUIRE, provisional identities and same-transaction actors cannot authorize entry',()=>{
  const desk=new ShadowDesk(),t=Date.parse('2026-09-08T20:00:00Z');
  for(const action of ['SCOUT','ACQUIRE','TRANSFER_OUT']){const s=sig()[0];s.events.forEach(e=>e.action=action);assert.equal(desk.signalGate(s,actors,t).status,'WAIT');}
  const s=sig()[0];s.events[1].txHash=s.events[0].txHash;assert.equal(desk.signalGate(s,actors,t).status,'WAIT');
  assert.equal(desk.signalGate(sig()[0],{...actors,b:{kind:'money',identityConfidence:'attributed'}},t).status,'WAIT');
  const f=sig()[0];f.events[0].at=new Date(t+1).toISOString();assert.equal(desk.signalGate(f,actors,t).status,'WAIT');
});
test('blocked and price-missing observations are journaled; Cycle alone cannot enter',()=>{
  const r=new ShadowDesk().run({actors,tacticalSignals:sig('BLOCKED'),cycleMemes:[{tokenAddress:TOKEN,cyclePotential:100}],now:Date.parse('2026-09-08T20:00:00Z')});
  assert.equal(r.journal[0].decision,'BLOCK');assert.equal(r.trades.length,0);assert.equal(r.auditUpdates.length,1);
});
test('no fill is invented when a position needs exit but quote is missing; input is immutable',()=>{
  const t=Date.parse('2026-09-08T20:00:00Z'),desk=new ShadowDesk({minSetupAgeMs:1});
  let r=desk.run({actors,tacticalSignals:sig(),tokenState:state(1,new Date(t).toISOString()),now:t});
  r=desk.run({actors,state:r.state,tacticalSignals:sig(),tokenState:state(.95,new Date(t+1000).toISOString()),now:t+1000});
  const before=JSON.stringify(r.state),m=state(.5,new Date(t+2000).toISOString());m[TOKEN].execution.exitQuoteStatus='UNKNOWN';
  const next=desk.run({actors,state:r.state,tacticalSignals:sig('DISTRIBUTION'),tokenState:m,now:t+2000});
  assert.equal(JSON.stringify(r.state),before);assert.equal(next.trades.length,0);assert.equal(next.snapshot.positions.length,1);assert.equal(next.snapshot.positions[0].pendingExitReason,'signal_distribution');
});
test('archive retains decisions beyond bounded UI cache and ledger mode cannot become live',()=>{
  const t=Date.parse('2026-09-08T20:00:00Z'),desk=new ShadowDesk({maxDecisionHistory:1});
  const old=desk.defaultState(t);old.mode='LIVE';
  const r=desk.run({state:old,actors,tacticalSignals:[...sig(),{...sig()[0],tokenAddress:'0x'+'2'.repeat(40)}],now:t});
  assert.equal(r.journal.length,2);assert.equal(r.state.decisions.length,1);assert.equal(r.snapshot.mode,'SHADOW');assert.equal(r.snapshot.execution,'PAPER_ONLY');
});
test('unchanged evidence does not duplicate journal decisions but evaluations continue',()=>{
  const desk=new ShadowDesk(),t=Date.parse('2026-09-08T20:00:00Z'),m=state(1,new Date(t).toISOString(),'UNKNOWN');
  const a=desk.run({actors,tacticalSignals:sig(),tokenState:m,now:t});
  const b=desk.run({actors,state:a.state,tacticalSignals:sig(),tokenState:m,now:t+1000});
  assert.equal(b.journal.filter(x=>x.kind==='decision').length,0);assert.equal(b.state.counters.evaluations,2);
});

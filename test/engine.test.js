'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Engine=require('../lib/engine');

const PASS={tokenControl:'PASS',upgradeAuthority:'PASS',canonicalLp:'PASS',sellRestriction:'PASS'};
const actors={
  alpha:{roleScores:{execution:90},identityConfidence:'verified'},
  beta:{roleScores:{execution:85},identityConfidence:'verified'}
};

test('receive-only ACQUIRE fan-out is not entry confluence',()=>{
  const events=['alpha','beta'].map(actorId=>({
    actorId,action:'ACQUIRE',txHash:'0xairdrop',eventStrength:80
  }));
  const result=Engine.evaluateToken({events,actors,safety:{}});
  assert.equal(result.state,'IGNORE');
  assert.equal(result.reason,'no_entry_evidence');
  assert.equal(result.independentActors,0);
  assert.equal(result.alpha,0);
});

test('same-transaction fan-out collapses actors into one independent source',()=>{
  const events=['alpha','beta'].map(actorId=>({
    actorId,action:'BUY',txHash:'0xshared',signalRole:'execution',eventStrength:80
  }));
  const result=Engine.evaluateToken({events,actors,safety:PASS});
  assert.equal(result.independentActors,1);
  assert.equal(result.state,'WATCH');
  assert.equal(result.reason,'needs_second_independent_actor');
});

test('one actor stays one source across separate transactions',()=>{
  const events=[
    {actorId:'alpha',action:'BUY',txHash:'0xone',eventStrength:60},
    {actorId:'alpha',action:'BUY',txHash:'0xtwo',eventStrength:90}
  ];
  const independent=Engine.independentActors(events);
  assert.equal(independent.length,1);
  assert.equal(independent[0].txHash,'0xtwo');
});

test('separate BUY transactions remain independent',()=>{
  const events=[
    {actorId:'alpha',action:'BUY',txHash:'0xone',signalRole:'execution',eventStrength:80},
    {actorId:'beta',action:'BUY',txHash:'0xtwo',signalRole:'execution',eventStrength:80}
  ];
  const result=Engine.evaluateToken({events,actors,safety:PASS,execution:{exitabilityScore:80}});
  assert.equal(result.independentActors,2);
  assert.deepEqual(new Set(result.actorIds),new Set(['alpha','beta']));
});

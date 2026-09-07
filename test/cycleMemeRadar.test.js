'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Engine=require('../lib/engine');

const actors={
  m1:{kind:'money',roleScores:{confirmation:92},adaptiveScore:85},
  m2:{kind:'money',roleScores:{confirmation:82},adaptiveScore:78},
  s1:{kind:'social',roleScores:{discovery:90},adaptiveScore:70},
  s2:{kind:'social',roleScores:{discovery:82},adaptiveScore:65}
};
const now=Date.now();
const at=h=>new Date(now-h*3600e3).toISOString();

test('cycle radar remains independent from tactical entry state',()=>{
  const result=Engine.evaluateToken({
    actors,
    events:[
      {actorId:'m1',action:'BUY',at:at(3),marketCap:10e6},
      {actorId:'m2',action:'BUY',at:at(2),marketCap:10.5e6},
      {actorId:'s1',action:'SCOUT',at:at(5)},
      {actorId:'s2',action:'SCOUT',at:at(1)}
    ],
    safety:{tokenControl:'PASS',upgradeAuthority:'PASS',canonicalLp:'PASS',sellRestriction:'PASS'},
    execution:{liquidityUsd:700000,sellImpactPct:1.5,currentMarketCap:35e6},
    token:{marketCap:35e6}
  });
  assert.equal(result.state,'DO_NOT_CHASE');
  assert.ok(result.cyclePotential>=60);
  assert.ok(['BREAKOUT','CULTURAL_CONTENDER'].includes(result.cycleStage));
  assert.equal(result.cycleEvidence.moneyActors,2);
  assert.equal(result.cycleEvidence.socialScouts,2);
});

test('unknown safety constrains cycle quality without erasing cultural observation',()=>{
  const result=Engine.evaluateToken({
    actors,
    events:[
      {actorId:'s1',action:'SCOUT',at:at(2)},
      {actorId:'s2',action:'SCOUT',at:at(1)}
    ],safety:{},execution:{},token:{}
  });
  assert.equal(result.state,'WATCH');
  assert.ok(result.cyclePotential>0);
  assert.ok(result.cycleRisks.includes('critical safety still unknown'));
  assert.ok(result.cycleMissingData.includes('holder_growth'));
});

test('V1 cannot label a token chain icon without holder and long-horizon data',()=>{
  const score=Engine.cyclePotentialScore({
    events:Array.from({length:12},(_,i)=>({actorId:'x'+i,action:'BUY',at:at(i/2),liquidityUsd:5e6})),
    actorRows:Array.from({length:5},()=>({score:100})),scoutRows:Array.from({length:5},()=>({score:100})),
    independent:Array.from({length:5},(_,i)=>({actorId:'m'+i,at:at(i)})),
    scouts:Array.from({length:5},(_,i)=>({actorId:'s'+i,at:at(i)})),
    exits:[],distribution:false,safetyResult:{status:'PASS'},exitabilityResult:{status:'PASS'},exitability:100,currentMc:100e6,firstMc:10e6
  });
  assert.ok(score.score<=84);
  assert.notEqual(score.stage,'CHAIN_ICON');
  assert.notEqual(score.stage,'CYCLE_MEME');
});

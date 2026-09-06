'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Performance=require('../lib/performance');
const Engine=require('../lib/engine');

test('social Discovery keeps the technical prior until there is resolved evidence',()=>{
  const actor={kind:'social',roleScores:{discovery:82}};
  const weight=Performance.socialDiscoveryWeight(actor,{resolved:0,confirmationRate:null,medianLeadMinutes:null});
  assert.equal(weight.score,82);
  assert.equal(weight.confidencePct,0);
});

test('resolved confirmations and useful lead time progressively replace the prior',()=>{
  const actor={kind:'social',roleScores:{discovery:80}};
  const weight=Performance.socialDiscoveryWeight(actor,{resolved:8,confirmationRate:100,medianLeadMinutes:400});
  assert.equal(weight.confidencePct,50);
  assert.ok(weight.score>80);
  assert.ok(weight.measuredScore>=95);
});

test('matured misses reduce Discovery without letting one small sample dominate',()=>{
  const actor={kind:'social',roleScores:{discovery:85}};
  const small=Performance.socialDiscoveryWeight(actor,{resolved:1,confirmationRate:0,medianLeadMinutes:null});
  const mature=Performance.socialDiscoveryWeight(actor,{resolved:20,confirmationRate:0,medianLeadMinutes:null});
  assert.ok(small.score>mature.score);
  assert.ok(small.score>60);
  assert.ok(mature.score<50);
});

test('engine uses measured social Discovery but still creates zero Alpha',()=>{
  const actor={
    id:'scout',kind:'social',role:'discovery',roleScores:{discovery:20},measuredDiscoveryScore:90
  };
  const result=Engine.evaluateToken({
    events:[{actorId:'scout',action:'SCOUT',tokenAddress:'0x1111111111111111111111111111111111111111'}],
    actors:{scout:actor}
  });
  assert.equal(result.state,'WATCH');
  assert.equal(result.reason,'social_scout_only');
  assert.equal(result.discovery,90);
  assert.equal(result.alpha,0);
  assert.equal(result.independentActors,0);
});

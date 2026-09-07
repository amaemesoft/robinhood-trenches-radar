'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {REFERENCES,buildAnalogues,numericOrNull}=require('../lib/cycleAnalogues');

test('historical calibration includes compounders, hybrids and meteor counterexamples',()=>{
  for(const key of ['PEPE','WIF','POPCAT','BONK','MEW','FARTCOIN','BODEN','BOME','PNUT','MOODENG'])assert.ok(REFERENCES[key]);
  assert.equal(REFERENCES.POPCAT.class,'COMPOUNDER');
  assert.equal(REFERENCES.BODEN.class,'METEOR');
  assert.equal(REFERENCES.PNUT.class,'HYBRID');
});

test('null historical metrics remain null instead of coercing to zero',()=>{
  assert.equal(numericOrNull(null),null);
  assert.equal(numericOrNull(undefined),null);
  assert.equal(numericOrNull('72'),72);
});

test('slow durable growth maps to survivor analogues rather than hypervelocity',()=>{
  const rows=buildAnalogues({culture:76,holders:82,resilience:88,attention:60,market:82,organic:78,ageDays:90,resilienceStatus:'MEASURED',sourceDiversity:2});
  const keys=new Set(rows.map(x=>x.key));
  assert.ok(keys.has('POPCAT'));
  assert.ok(keys.has('BONK'));
  assert.equal(keys.has('BOME'),false);
  assert.equal(keys.has('BODEN'),false);
});

test('extreme early attention without resilience surfaces meteor/event warnings',()=>{
  const rows=buildAnalogues({culture:78,holders:55,resilience:null,attention:94,market:75,organic:28,ageDays:5,resilienceStatus:'NOT_TESTED',sourceDiversity:2});
  const keys=new Set(rows.map(x=>x.key));
  assert.ok(keys.has('BOME'));
  assert.ok(keys.has('BODEN'));
  assert.ok([...keys].some(k=>['PNUT','MOODENG'].includes(k)));
  assert.ok(rows.some(x=>x.warning));
});

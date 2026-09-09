'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../lib/shadowAuditor');
const t=Date.parse('2026-09-09T00:00:00Z');
const decision={id:'d',at:new Date(t).toISOString(),marketPriceUsd:1,decision:'BLOCK',agents:{SENTINEL:{status:'BLOCK',reason:'unknown'}}};
test('AUDITOR only observes later available marks and cannot mutate original gates',()=>{
  const r=A.register(decision),before=JSON.stringify(decision);
  assert.equal(A.observe(r,{priceUsd:2,observedAt:new Date(t+300000).toISOString()},t).observations,0);
  let out=A.observe(r,{priceUsd:.8,observedAt:new Date(t+300000).toISOString()},t+300000);assert.equal(out.maePct,-20);
  out=A.observe(out,{priceUsd:1.5,observedAt:new Date(t+86400000).toISOString()},t+86400000);
  assert.equal(out.mfePct,50);assert.equal(out.classification,'BLOCKED_THEN_ROSE');assert.equal(out.returns['24h'].returnPct,50);
  assert.equal(JSON.stringify(decision),before);assert.equal(A.summarize([out]).canChangeGates,false);
});
test('missing horizon prices remain absent instead of forward-filling distant observations',()=>{
  const r=A.observe(A.register(decision),{priceUsd:3,observedAt:new Date(t+3600000).toISOString()},t+3600000);
  assert.equal(r.returns['5m'],undefined);assert.equal(r.returns['1h'].returnPct,200);
});

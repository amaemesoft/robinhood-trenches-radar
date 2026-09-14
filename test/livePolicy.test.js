'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {LivePolicy,SELECTORS,SWAP_ROUTER_02}=require('../lib/livePolicy');

const OWNER='0x71c50c7f6ba3962fe37b6c6e16757427b21debcb';
const TOKEN='0x1111111111111111111111111111111111111111';
const passingDecision=()=>({
  id:'decision-1',decision:'ENTRY',tokenAddress:TOKEN,at:new Date().toISOString(),
  agents:{SIGNAL:{status:'PASS'},ATLAS:{status:'PASS'},SENTINEL:{status:'PASS'},VECTOR:{status:'PASS'},PULSE:{status:'PASS'},ANCHOR:{status:'PASS'},FUSE:{status:'APPROVE'}}
});
const passingState=()=>({
  [TOKEN]:{chainId:4663,contractExists:true,priceUsd:1,marketObservedAt:new Date().toISOString(),safety:{tokenControl:'PASS',upgradeAuthority:'PASS',canonicalLp:'PASS',sellRestriction:'PASS'},
    safetyEvidence:{evaluatedAt:new Date().toISOString(),poolFee:3000,marketPairMatches:true},execution:{exitQuoteStatus:'PASS',sellImpactPct:2.4}}
});

test('live policy is owner-locked and never grants a root session',()=>{
  const policy=new LivePolicy({allowed:true,ownerAddress:OWNER});
  assert.equal(policy.validateOwner(OWNER).ok,true);
  assert.equal(policy.validateOwner(TOKEN).ok,false);
  const permissions=policy.permissions();
  assert.equal(permissions.some(permission=>permission.type==='root'),false);
  assert.ok(permissions.some(permission=>permission.type==='functions-on-contract'&&permission.data.address===SWAP_ROUTER_02&&permission.data.functions.includes(SELECTORS.exactInputSingle)));
});

test('live entry requires fresh exact-contract evidence and every gate',()=>{
  const policy=new LivePolicy({allowed:true});
  const signal={state:'ENTRY_CANDIDATE',tokenAddress:TOKEN,chaseMultiple:1.1};
  assert.equal(policy.validateEntry({decision:passingDecision(),signal,tokenState:passingState(),amountWei:1000000000000000n}).ok,true);
  const unknown=passingState();unknown[TOKEN].safety.sellRestriction='UNKNOWN';
  assert.equal(policy.validateEntry({decision:passingDecision(),signal,tokenState:unknown,amountWei:1000000000000000n}).reason,'critical_safety_not_pass');
  const stale=passingDecision();stale.at=new Date(Date.now()-10*60*1000).toISOString();
  assert.equal(policy.validateEntry({decision:stale,signal,tokenState:passingState(),amountWei:1000000000000000n}).reason,'stale_entry_decision');
  const missingPrice=passingState();missingPrice[TOKEN].priceUsd=null;
  assert.equal(policy.validateEntry({decision:passingDecision(),signal,tokenState:missingPrice,amountWei:1000000000000000n}).reason,'missing_market_price');
  const staleMarket=passingState();staleMarket[TOKEN].marketObservedAt=new Date(Date.now()-10*60*1000).toISOString();
  assert.equal(policy.validateEntry({decision:passingDecision(),signal,tokenState:staleMarket,amountWei:1000000000000000n}).reason,'stale_market_evidence');
  const staleSafety=passingState();staleSafety[TOKEN].safetyEvidence.evaluatedAt=new Date(Date.now()-10*60*1000).toISOString();
  assert.equal(policy.validateEntry({decision:passingDecision(),signal,tokenState:staleSafety,amountWei:1000000000000000n}).reason,'stale_safety_evidence');
  const wrongPair=passingState();wrongPair[TOKEN].safetyEvidence.marketPairMatches=false;
  assert.equal(policy.validateEntry({decision:passingDecision(),signal,tokenState:wrongPair,amountWei:1000000000000000n}).reason,'market_pair_not_canonical');
  assert.equal(policy.validateEntry({decision:passingDecision(),signal:{state:'ENTRY_CANDIDATE',tokenAddress:TOKEN},tokenState:passingState(),amountWei:1000000000000000n}).reason,'missing_chase_evidence');
});

test('live execution defaults to disabled',()=>{
  const policy=new LivePolicy({allowed:false});
  const result=policy.validateEntry({decision:passingDecision(),signal:{state:'ENTRY_CANDIDATE',tokenAddress:TOKEN},tokenState:passingState(),amountWei:1n});
  assert.equal(result.reason,'live_execution_not_allowed');
});

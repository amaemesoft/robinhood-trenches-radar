'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {TokenIntelligence,PONS_FACTORIES,WETH,V3_FACTORY,QUOTER_V2,SELECTORS}=require('../lib/tokenIntelligence');

const TOKEN='0x1111111111111111111111111111111111111111';
const DEPLOYER='0x2222222222222222222222222222222222222222';
const POOL='0x3333333333333333333333333333333333333333';
const POSITION_MANAGER='0x4444444444444444444444444444444444444444';
const addressWord=a=>a.slice(2).padStart(64,'0');
const uintWord=n=>BigInt(n).toString(16).padStart(64,'0');
const result=(...values)=>'0x'+values.join('');
const singleAddress=a=>result(addressWord(a));
const singleUint=n=>result(uintWord(n));

function launchResult(exists=true){
  return result(
    addressWord(exists?TOKEN:'0x0000000000000000000000000000000000000000'),addressWord(DEPLOYER),addressWord(WETH),
    addressWord(POSITION_MANAGER),uintWord(1),uintWord(0),uintWord(0),uintWord(100),
    uintWord(1_000_000_000n*10n**18n),uintWord(1),uintWord(10000),uintWord(exists?1:0),uintWord(0)
  );
}

function rpcFor({known=true,badPool=false}={}){
  return async(method,params)=>{
    if(method==='eth_blockNumber')return '0x200';
    if(method==='eth_getCode')return '0x60006000';
    assert.equal(method,'eth_call');
    const {to,data}=params[0],address=to.toLowerCase(),selector=data.slice(2,10);
    if(PONS_FACTORIES.some(f=>f.address===address)&&selector===SELECTORS.getLaunchedToken){
      return address===PONS_FACTORIES[0].address&&known?launchResult(true):launchResult(false);
    }
    if(address===TOKEN&&selector===SELECTORS.liquidityPool)return singleAddress(POOL);
    if(address===TOKEN&&selector===SELECTORS.totalSupply)return singleUint(1_000_000_000n*10n**18n);
    if(address===TOKEN&&selector===SELECTORS.decimals)return singleUint(18);
    if(address===POOL&&selector===SELECTORS.factory)return singleAddress(badPool?DEPLOYER:V3_FACTORY);
    if(address===POOL&&selector===SELECTORS.token0)return singleAddress(TOKEN);
    if(address===POOL&&selector===SELECTORS.token1)return singleAddress(WETH);
    if(address===POOL&&selector===SELECTORS.fee)return singleUint(10000);
    if(address===QUOTER_V2&&selector===SELECTORS.quoteExactInputSingle){
      return result(uintWord(95_000_000_000_000_000n),uintWord(0),uintWord(0),uintWord(100000));
    }
    throw new Error(`unexpected call ${address} ${selector}`);
  };
}

test('verified pons launch closes all four critical safety checks',async()=>{
  const intel=new TokenIntelligence({rpc:rpcFor(),targetsUsd:[250],primaryTargetUsd:250});
  const state=await intel.inspect(TOKEN,{priceUsd:0.001,priceNative:0.0000004,liquidityUsd:100000,pairAddress:POOL,dexId:'uniswap',marketSource:'dexscreener'});
  assert.deepEqual(state.safety,{tokenControl:'PASS',upgradeAuthority:'PASS',canonicalLp:'PASS',sellRestriction:'PASS'});
  assert.equal(state.safetyEvidence.provenance,'pons-active');
  assert.equal(state.safetyEvidence.marketPairMatches,true);
  assert.equal(state.execution.exitQuoteStatus,'PASS');
  assert.equal(state.execution.exitabilityTargetUsd,250);
  assert.equal(state.execution.sellImpactPct,5);
});

test('unknown factory provenance never becomes a safety pass',async()=>{
  const intel=new TokenIntelligence({rpc:rpcFor({known:false}),targetsUsd:[250],primaryTargetUsd:250});
  const state=await intel.inspect(TOKEN,{priceUsd:0.001,priceNative:0.0000004,liquidityUsd:100000});
  assert.deepEqual(state.safety,{tokenControl:'UNKNOWN',upgradeAuthority:'UNKNOWN',canonicalLp:'UNKNOWN',sellRestriction:'UNKNOWN'});
  assert.equal(state.execution.exitQuoteStatus,'UNKNOWN');
  assert.equal(state.execution.exitQuotes.length,0);
});

test('a mismatched pool factory fails canonical LP and prevents quoting',async()=>{
  const intel=new TokenIntelligence({rpc:rpcFor({badPool:true}),targetsUsd:[250],primaryTargetUsd:250});
  const state=await intel.inspect(TOKEN,{priceUsd:0.001,priceNative:0.0000004,liquidityUsd:100000,pairAddress:POOL});
  assert.equal(state.safety.canonicalLp,'FAIL');
  assert.equal(state.execution.exitQuoteStatus,'UNKNOWN');
  assert.equal(state.execution.sellImpactPct,null);
});

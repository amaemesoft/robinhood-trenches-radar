'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {LivePolicy,SWAP_ROUTER_02,WETH}=require('../lib/livePolicy');
const {LiveSwap,encodeUint}=require('../lib/liveSwap');

const ACCOUNT='0x3333333333333333333333333333333333333333';
const TOKEN='0x1111111111111111111111111111111111111111';
const uint=value=>`0x${encodeUint(value)}`;

test('buy is freshly quoted, slippage-bounded, simulated and router-only',async()=>{
  const calls=[],policy=new LivePolicy({allowed:true,slippageBps:300});
  const rpc=async(method,params)=>{calls.push({method,params});if(method==='eth_estimateGas')return'0x5208';if(method==='eth_call'&&params[0].to===SWAP_ROUTER_02)return'0x';return uint(1000000n);};
  const swap=new LiveSwap({rpc,policy}),built=await swap.buildBuy({account:ACCOUNT,token:TOKEN,amountWei:1000n,poolFee:3000});
  assert.equal(built.minimumOutRaw,'970000');
  assert.equal(built.calls.length,1);assert.equal(built.calls[0].to,SWAP_ROUTER_02);assert.equal(built.calls[0].value,'1000');
  assert.ok(calls.some(call=>call.method==='eth_estimateGas'));
});

test('sell approves exactly the verified router and unwraps only after the swap',async()=>{
  const policy=new LivePolicy({allowed:true}),swap=new LiveSwap({policy,rpc:async()=>uint(5000n)});
  const built=await swap.buildSell({account:ACCOUNT,token:TOKEN,amountRaw:100n,poolFee:3000});
  assert.equal(built.calls.length,3);assert.equal(built.calls[0].to,TOKEN);assert.equal(built.calls[1].to,SWAP_ROUTER_02);assert.equal(built.calls[2].to,WETH);
  const tampered=structuredClone(built.calls);tampered[0].data=tampered[0].data.slice(0,34)+'44'.repeat(20)+tampered[0].data.slice(74);
  assert.throws(()=>swap.validateCalls({side:'SELL',calls:tampered,token:TOKEN,amountRaw:100n,account:ACCOUNT,poolFee:3000}),/approval is not exact|outside router policy/);
  const redirected=structuredClone(built.calls),recipientWord=3;
  redirected[1].data=redirected[1].data.slice(0,10+recipientWord*64+24)+'44'.repeat(20)+redirected[1].data.slice(10+(recipientWord+1)*64);
  assert.throws(()=>swap.validateCalls({side:'SELL',calls:redirected,token:TOKEN,amountRaw:100n,account:ACCOUNT,poolFee:3000}),/outside router policy/);
});

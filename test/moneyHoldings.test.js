'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MoneyHoldingsProvider,balanceOfData,isProvisional}=require('../lib/moneyHoldings');

const TOKEN='0x1111111111111111111111111111111111111111';
const W1='0x2222222222222222222222222222222222222222';
const W2='0x3333333333333333333333333333333333333333';
const W3='0x4444444444444444444444444444444444444444';

test('balanceOf calldata uses exact wallet address',()=>{
  const data=balanceOfData(W1);
  assert.equal(data.length,74);
  assert.ok(data.endsWith(W1.slice(2)));
});

test('provisional sample-zero wallet is observation-only',()=>{
  assert.equal(isProvisional({kind:'money',attributionStatus:'provisional',sampleSize:0}),true);
  assert.equal(isProvisional({kind:'money',attributionStatus:'provisional',sampleSize:3}),false);
  assert.equal(isProvisional({kind:'money',identityConfidence:'verified',sampleSize:0}),false);
});

test('current holdings separate established from provisional wallets',async()=>{
  const balances=new Map([[W1.toLowerCase(),'0x5'],[W2.toLowerCase(),'0x9'],[W3.toLowerCase(),'0x0']]);
  const rpc=async(_method,params)=>{
    const data=params[0].data;
    const wallet='0x'+data.slice(-40);
    return balances.get(wallet)||'0x0';
  };
  const actors=[
    {id:'established',kind:'money',identityConfidence:'verified',evmAddress:W1,enabled:true},
    {id:'provisional',kind:'money',attributionStatus:'provisional',sampleSize:0,evmAddress:W2,enabled:true},
    {id:'empty',kind:'money',identityConfidence:'strong',evmAddress:W3,enabled:true}
  ];
  const result=await new MoneyHoldingsProvider({rpc}).snapshot(TOKEN,actors);
  assert.equal(result.status,'MEASURED');
  assert.equal(result.qualifiedHolders,1);
  assert.deepEqual(result.qualifiedActorIds,['established']);
  assert.equal(result.provisionalHolders,1);
  assert.deepEqual(result.provisionalActorIds,['provisional']);
});

test('partial RPC coverage is explicit and never treats failures as empty balances',async()=>{
  let calls=0;
  const rpc=async()=>{calls++;if(calls===1)return'0x1';throw new Error('rpc down');};
  const actors=[
    {id:'a',kind:'money',evmAddress:W1,enabled:true},
    {id:'b',kind:'money',evmAddress:W2,enabled:true},
    {id:'c',kind:'money',evmAddress:W3,enabled:true}
  ];
  const result=await new MoneyHoldingsProvider({rpc,concurrency:1}).snapshot(TOKEN,actors);
  assert.equal(result.status,'UNKNOWN');
  assert.equal(result.checked,1);
  assert.equal(result.qualifiedHolders,1);
  assert.ok(result.coverage<0.6);
});

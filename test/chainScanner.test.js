'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const ChainScanner=require('../lib/chainScanner');

const WALLET='0x1111111111111111111111111111111111111111';
const ROUTER='0x2222222222222222222222222222222222222222';
const MEME='0x3333333333333333333333333333333333333333';
const OTHER='0x4444444444444444444444444444444444444444';
const USDG='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const FAKE_USDG='0x8218d73c00567a01481495ad6c5143e00d5bb5b4';

function transfer({from,to,token,symbol='MEME',value='1000000000000000000',decimals=18}){
  return {from:{hash:from},to:{hash:to},token:{address_hash:token,symbol,decimals:String(decimals)},total:{value}};
}

function scannerFor({tx={},transfers=[],internals=[]}){
  const scanner=new ChainScanner({rpcUrl:'http://unused',blockscoutApiKey:'proapi_test'});
  const calls=[];
  scanner.proGet=async path=>{
    calls.push(path);
    if(path.endsWith('/token-transfers'))return {items:transfers};
    if(path.endsWith('/internal-transactions'))return {items:internals};
    return {timestamp:'2026-09-06T08:00:00Z',block_number:1,block_hash:'0xabc',from:{hash:ROUTER},value:'0',...tx};
  };
  return {scanner,calls};
}

const walletMap=()=>new Map([[WALLET,{id:'pilot'}]]);

test('receive-only token is ACQUIRE, not BUY',async()=>{
  const {scanner}=scannerFor({transfers:[transfer({from:ROUTER,to:WALLET,token:MEME})]});
  const rows=await scanner.analyzeTx('0x1',walletMap());
  assert.equal(rows.length,1);
  assert.equal(rows[0].action,'ACQUIRE');
});

test('spending native ETH and receiving token is BUY',async()=>{
  const {scanner}=scannerFor({
    tx:{from:{hash:WALLET},value:'1000000000000000000'},
    transfers:[transfer({from:ROUTER,to:WALLET,token:MEME})]
  });
  const rows=await scanner.analyzeTx('0x2',walletMap());
  assert.equal(rows[0].action,'BUY');
  assert.equal(rows[0].classificationEvidence.nativeSpent,true);
});

test('canonical USDG out plus token in is BUY and USDG is not emitted',async()=>{
  const {scanner}=scannerFor({transfers:[
    transfer({from:WALLET,to:ROUTER,token:USDG,symbol:'USDG',value:'1000000',decimals:6}),
    transfer({from:ROUTER,to:WALLET,token:MEME})
  ]});
  const rows=await scanner.analyzeTx('0x3',walletMap());
  assert.equal(rows.length,1);
  assert.equal(rows[0].tokenAddress,MEME);
  assert.equal(rows[0].action,'BUY');
});

test('token out plus canonical USDG in is SELL',async()=>{
  const {scanner,calls}=scannerFor({transfers:[
    transfer({from:WALLET,to:ROUTER,token:MEME}),
    transfer({from:ROUTER,to:WALLET,token:USDG,symbol:'USDG',value:'1000000',decimals:6})
  ]});
  const rows=await scanner.analyzeTx('0x4',walletMap());
  assert.equal(rows.length,1);
  assert.equal(rows[0].action,'SELL');
  assert.equal(calls.some(p=>p.endsWith('/internal-transactions')),false);
});

test('token out plus internal native ETH back to wallet is SELL',async()=>{
  const {scanner,calls}=scannerFor({
    tx:{from:{hash:WALLET},value:'0'},
    transfers:[transfer({from:WALLET,to:ROUTER,token:MEME})],
    internals:[{from:{hash:ROUTER},to:{hash:WALLET},value:'500000000000000000',success:true}]
  });
  const rows=await scanner.analyzeTx('0x5',walletMap());
  assert.equal(rows.length,1);
  assert.equal(rows[0].action,'SELL');
  assert.equal(rows[0].classificationEvidence.nativeReceived,true);
  assert.equal(calls.some(p=>p.endsWith('/internal-transactions')),true);
});

test('token out with no economic inflow remains TRANSFER_OUT',async()=>{
  const {scanner}=scannerFor({
    tx:{from:{hash:WALLET},value:'0'},
    transfers:[transfer({from:WALLET,to:OTHER,token:MEME})],
    internals:[]
  });
  const rows=await scanner.analyzeTx('0x6',walletMap());
  assert.equal(rows[0].action,'TRANSFER_OUT');
  assert.equal(rows[0].classificationEvidence.nativeReceived,false);
});

test('symbol spoof cannot masquerade as canonical quote asset',async()=>{
  const {scanner}=scannerFor({transfers:[
    transfer({from:ROUTER,to:WALLET,token:FAKE_USDG,symbol:'USDG'})
  ]});
  const rows=await scanner.analyzeTx('0x7',walletMap());
  assert.equal(rows.length,1);
  assert.equal(rows[0].tokenAddress,FAKE_USDG);
  assert.equal(rows[0].action,'ACQUIRE');
  assert.equal(rows[0].classificationEvidence.quoteAssetRule,'exact-contract');
});

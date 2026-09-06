'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {isValidSignature,parseAddressActivity}=require('../lib/alchemyWebhook');

const WALLET='0x1111111111111111111111111111111111111111';
const ROUTER='0x2222222222222222222222222222222222222222';
const MEME='0x3333333333333333333333333333333333333333';
const USDG='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const OTHER='0x4444444444444444444444444444444444444444';
const NFT='0x7777777777777777777777777777777777777777';
const walletMap=()=>new Map([[WALLET,{id:'pilot'}]]);
const isQuoteToken=a=>a.toLowerCase()===USDG;

function token({from,to,address=MEME,asset='MEME',raw='0xde0b6b3a7640000',decimals=18,hash='0xabc'}){
  return {blockNum:'0x10',hash,fromAddress:from,toAddress:to,value:1,asset,category:'token',rawContract:{rawValue:raw,address,decimals},erc721TokenId:null,erc1155Metadata:null,log:{address,transactionHash:hash,blockNumber:'0x10',blockHash:'0xblock',data:raw}};
}
function eth({from,to,category='external',raw='0xde0b6b3a7640000',hash='0xabc'}){
  return {blockNum:'0x10',hash,fromAddress:from,toAddress:to,value:1,asset:'ETH',category,rawContract:{rawValue:raw,address:null,decimals:18}};
}
function payload(activity){return{webhookId:'wh_test',id:'whevt_test',createdAt:'2026-09-06T08:00:00Z',type:'ADDRESS_ACTIVITY',event:{network:'ROBINHOOD_MAINNET',activity}};}

test('validates Alchemy HMAC signature against raw body',()=>{
  const raw='{"hello":"world"}',key='whsec_test';
  const sig=crypto.createHmac('sha256',key).update(raw,'utf8').digest('hex');
  assert.equal(isValidSignature(raw,sig,key),true);
  assert.equal(isValidSignature(raw,'00'.repeat(32),key),false);
});

test('receive-only ERC20 is ACQUIRE',()=>{
  const rows=parseAddressActivity(payload([token({from:ROUTER,to:WALLET})]),walletMap(),{isQuoteToken});
  assert.equal(rows.length,1);
  assert.equal(rows[0].action,'ACQUIRE');
});

test('native ETH out plus ERC20 in is BUY',()=>{
  const rows=parseAddressActivity(payload([
    eth({from:WALLET,to:ROUTER}),token({from:ROUTER,to:WALLET})
  ]),walletMap(),{isQuoteToken});
  assert.equal(rows.length,1);
  assert.equal(rows[0].action,'BUY');
  assert.equal(rows[0].classificationEvidence.nativeSpent,true);
});

test('ERC20 out plus internal ETH in is SELL',()=>{
  const rows=parseAddressActivity(payload([
    token({from:WALLET,to:ROUTER}),eth({from:ROUTER,to:WALLET,category:'internal'})
  ]),walletMap(),{isQuoteToken});
  assert.equal(rows.length,1);
  assert.equal(rows[0].action,'SELL');
  assert.equal(rows[0].classificationEvidence.nativeReceived,true);
});

test('canonical quote token is not emitted but provides economic evidence',()=>{
  const rows=parseAddressActivity(payload([
    token({from:WALLET,to:ROUTER,address:USDG,asset:'USDG',raw:'0xf4240',decimals:6}),
    token({from:ROUTER,to:WALLET})
  ]),walletMap(),{isQuoteToken});
  assert.equal(rows.length,1);
  assert.equal(rows[0].tokenAddress,MEME);
  assert.equal(rows[0].action,'BUY');
});

test('NFT activity is ignored',()=>{
  const a=token({from:ROUTER,to:WALLET,address:NFT,asset:'NFT'});
  a.category='erc721';a.erc721TokenId='0x1';
  const rows=parseAddressActivity(payload([a]),walletMap(),{isQuoteToken});
  assert.equal(rows.length,0);
});

test('a non-quote token outflow cannot manufacture a BUY',()=>{
  const rows=parseAddressActivity(payload([
    token({from:WALLET,to:ROUTER,address:OTHER,asset:'OTHER'}),
    token({from:ROUTER,to:WALLET})
  ]),walletMap(),{isQuoteToken});
  const meme=rows.find(row=>row.tokenAddress===MEME);
  assert.equal(meme.action,'ACQUIRE');
  assert.deepEqual(meme.classificationEvidence.quoteOutTokens,[]);
});

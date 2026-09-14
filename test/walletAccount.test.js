'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const WalletAccount=require('../lib/walletAccount');

test('watch-only account reader validates Robinhood Chain and requests only chain and native balance',async()=>{
  const calls=[];
  const account=await WalletAccount.readWalletAccount({
    address:' 0xA1B2c3D4e5F60718293a4B5c6D7E8f9012345678 ',
    rpc:async(method,params=[])=>{
      calls.push({method,params});
      if(method==='eth_chainId')return'0x1237';
      if(method==='eth_getBalance')return'0xde0b6b3a7640000';
      throw new Error('unexpected method');
    }
  });

  assert.deepEqual(account,{
    address:'0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    chainId:4663,
    balance:'0xde0b6b3a7640000',
    mode:'WATCH_ONLY'
  });
  assert.deepEqual(calls.map(call=>call.method),['eth_chainId','eth_getBalance']);
  assert.deepEqual(calls[1].params,['0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678','latest']);
});

test('watch-only account reader rejects invalid addresses before touching RPC',async()=>{
  let called=false;
  await assert.rejects(
    WalletAccount.readWalletAccount({address:'not-a-wallet',rpc:async()=>{called=true;}}),
    error=>error.code==='INVALID_ADDRESS'
  );
  assert.equal(called,false);
});

test('watch-only account reader rejects a response from another chain',async()=>{
  await assert.rejects(
    WalletAccount.readWalletAccount({
      address:'0x1111111111111111111111111111111111111111',
      rpc:async method=>method==='eth_chainId'?'0x1':'0x0'
    }),
    error=>error.code==='WRONG_CHAIN'
  );
});

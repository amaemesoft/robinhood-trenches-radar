'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const wallets=require('../lib/provisionalMoneyWallets');

test('wallet expansion contains exactly 20 unique provisional Robinhood money wallets',()=>{
  assert.equal(wallets.length,20);
  assert.equal(new Set(wallets.map(w=>w.id)).size,20);
  assert.equal(new Set(wallets.map(w=>w.evmAddress)).size,20);
  for(const wallet of wallets){
    assert.match(wallet.evmAddress,/^0x[a-f0-9]{40}$/);
    assert.equal(wallet.kind,'money');
    assert.equal(wallet.identityConfidence,'attributed');
    assert.equal(wallet.attributionStatus,'provisional');
    assert.equal(wallet.sampleSize,0);
    assert.equal(wallet.enabled,true);
    assert.equal(wallet.roleScores,undefined);
    assert.equal(wallet.recentEdge,undefined);
    assert.equal(wallet.lifetimeEdge,undefined);
  }
});

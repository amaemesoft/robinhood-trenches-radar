'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Fomo=require('../lib/fomoscan');

test('normalizes verified FomoScan identity without guessing wallets',()=>{
  const row=Fomo.normalizeIdentity({id:'u1',handle:'@alice',evmAddress:'0x1111111111111111111111111111111111111111'});
  assert.deepEqual(row,{id:'u1',handle:'alice',evmAddress:'0x1111111111111111111111111111111111111111'});
  assert.equal(Fomo.normalizeIdentity({id:'u2',handle:'bob',evmAddress:'not-an-address'}).evmAddress,null);
});

test('accepts supported thesis list envelopes',()=>{
  const x=[{id:1}];
  assert.equal(Fomo.thesisItems(x),x);
  assert.deepEqual(Fomo.thesisItems({items:x}),x);
  assert.deepEqual(Fomo.thesisItems({data:x}),x);
});

test('normalizes thesis only with exact EVM token contract',()=>{
  const thesis=Fomo.normalizeThesis({
    id:'t1',authorId:'u1',tokenAddress:'0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',createdAt:'2026-09-06T14:00:00Z',content:'early'
  });
  assert.equal(thesis.id,'t1');
  assert.equal(thesis.authorId,'u1');
  assert.equal(thesis.tokenAddress,'0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
  assert.equal(thesis.text,'early');
  assert.equal(Fomo.normalizeThesis({id:'t2',authorId:'u1',tokenAddress:'SOLANA'}),null);
});

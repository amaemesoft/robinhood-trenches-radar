'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {cleanHandle,extractEvmAddresses,normalizeStatus,FxTwitterClient}=require('../lib/fxTwitter');

test('extracts and deduplicates exact EVM contracts',()=>{
  const a='0x1111111111111111111111111111111111111111';
  const b='0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD';
  assert.deepEqual(extractEvmAddresses(`CA ${a} and ${a} plus ${b}`),[a,b.toLowerCase()]);
  assert.deepEqual(extractEvmAddresses('0x1234 is not a contract'),[]);
});

test('normalizes only posts authored by the tracked scout',()=>{
  const token='0x2222222222222222222222222222222222222222';
  const own=normalizeStatus({
    id:'123',text:`watch ${token}`,created_timestamp:1700000000,
    author:{username:'kenjidgn'},url:'https://x.com/kenjidgn/status/123'
  },'@kenjidgn');
  assert.equal(own.id,'123');
  assert.deepEqual(own.tokenAddresses,[token]);
  assert.equal(normalizeStatus({id:'124',text:`repost ${token}`,author:{username:'someoneelse'}},'kenjidgn'),null);
});

test('client uses public profile statuses endpoint with since and no auth key',async()=>{
  let seen;
  const client=new FxTwitterClient({fetchImpl:async url=>{
    seen=new URL(String(url));
    return{ok:true,status:200,json:async()=>({results:[]})};
  }});
  const rows=await client.latestStatuses('@traderpow',{since:1700000000000,count:7});
  assert.deepEqual(rows,[]);
  assert.equal(seen.pathname,'/2/profile/traderpow/statuses');
  assert.equal(seen.searchParams.get('since'),'1700000000000');
  assert.equal(seen.searchParams.get('count'),'7');
  assert.equal(cleanHandle('@traderpow'),'traderpow');
});

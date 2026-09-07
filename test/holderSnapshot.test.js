'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseTokenInfo,topHolderConcentration,HolderSnapshotProvider}=require('../lib/holderSnapshot');

test('parses exact holder count without unsafe supply conversion',()=>{
  const info=parseTokenInfo({holders_count:'13234',total_supply:'1000000000000000000000000000',decimals:'18',symbol:'MEME'});
  assert.equal(info.holders,13234);
  assert.equal(info.totalSupplyRaw,1000000000000000000000000000n);
  assert.equal(info.decimals,18);
});

test('top10 concentration excludes zero, pool and token contract',()=>{
  const token='0x1111111111111111111111111111111111111111';
  const pool='0x2222222222222222222222222222222222222222';
  const items=[
    {address:{hash:'0x0000000000000000000000000000000000000000'},value:'200'},
    {address:{hash:pool},value:'150'},
    {address:{hash:token},value:'100'},
    ...Array.from({length:12},(_,i)=>({address:{hash:'0x'+String(i+3).padStart(40,'0')},value:String(50-i)}))
  ];
  const result=topHolderConcentration(items,'1000',{tokenAddress:token,excludeAddresses:[pool]});
  const expected=Array.from({length:10},(_,i)=>50-i).reduce((a,b)=>a+b,0)/10;
  assert.equal(result.excluded,3);
  assert.equal(result.included,10);
  assert.equal(result.top10Pct,expected);
});

test('provider returns UNKNOWN rather than fabricating holders when upstream fails',async()=>{
  const provider=new HolderSnapshotProvider({fetchFn:async()=>({ok:false,status:503})});
  const result=await provider.snapshot('0x1111111111111111111111111111111111111111');
  assert.equal(result.status,'UNKNOWN');
  assert.equal(result.holders,null);
  assert.equal(result.top10Pct,null);
});

test('provider uses exact token endpoints and can return count even when holder list fails',async()=>{
  const calls=[];
  const provider=new HolderSnapshotProvider({fetchFn:async url=>{
    calls.push(url);
    if(url.endsWith('/holders'))return{ok:false,status:429};
    return{ok:true,json:async()=>({holders_count:'42',total_supply:'1000',decimals:'18',symbol:'TEST',name:'Test'})};
  }});
  const result=await provider.snapshot('0x1111111111111111111111111111111111111111');
  assert.equal(result.status,'MEASURED');
  assert.equal(result.holders,42);
  assert.equal(result.top10Pct,null);
  assert.ok(calls[0].endsWith('/tokens/0x1111111111111111111111111111111111111111'));
  assert.ok(calls[1].endsWith('/tokens/0x1111111111111111111111111111111111111111/holders'));
});

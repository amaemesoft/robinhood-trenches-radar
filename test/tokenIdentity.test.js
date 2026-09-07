'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Identity=require('../lib/tokenIdentity');

const ADDRESS='0x1111111111111111111111111111111111111111';
const OTHER='0x2222222222222222222222222222222222222222';
const dexUnavailable=async()=>({ok:false});
const dexResponse=rows=>async()=>({ok:true,json:async()=>rows});

function abiString(value){
  const bytes=Buffer.from(value,'utf8').toString('hex');
  const padded=bytes.padEnd(Math.ceil(bytes.length/64)*64,'0');
  const offset='20'.padStart(64,'0');
  const length=(bytes.length/2).toString(16).padStart(64,'0');
  return '0x'+offset+length+padded;
}

test('display label always exposes name and ticker when both are known',()=>{
  assert.equal(Identity.displayLabel('Optimus','OPTIMUS','0x1234'),'Optimus ($OPTIMUS)');
});

test('display label makes a ticker explicit when name is unavailable',()=>{
  assert.equal(Identity.displayLabel(null,'FRONG','0x1234'),'$FRONG');
});

test('resolves name and symbol from the exact Robinhood-chain contract',async()=>{
  const rpc=async(method,params)=>{
    if(method==='eth_getCode')return'0x60016000';
    const selector=params[0].data;
    if(selector==='0x06fdde03')return abiString('Optimus');
    if(selector==='0x95d89b41')return abiString('OPTIMUS');
    throw new Error('unexpected call');
  };
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,dexUnavailable);
  assert.deepEqual(result,{contractExists:true,name:'Optimus',symbol:'OPTIMUS'});
});

test('falls back to exact Robinhood Dex metadata when contract metadata calls fail',async()=>{
  const rpc=async method=>{
    if(method==='eth_getCode')return'0x60016000';
    throw new Error('metadata unavailable');
  };
  const fetchImpl=dexResponse([{
    chainId:'robinhood',liquidity:{usd:12345},
    baseToken:{address:ADDRESS,name:'Optimus',symbol:'OPTIMUS'}
  }]);
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,fetchImpl);
  assert.deepEqual(result,{contractExists:true,name:'Optimus',symbol:'OPTIMUS'});
});

test('bytecode alone is not enough to classify an address as a Robinhood token',async()=>{
  const rpc=async method=>{
    if(method==='eth_getCode')return'0x60016000';
    throw new Error('not ERC20 metadata');
  };
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,dexResponse([]));
  assert.deepEqual(result,{contractExists:false,name:null,symbol:null});
});

test('keeps bytecode-only identity unknown when the exact Dex lookup is temporarily unavailable',async()=>{
  const rpc=async method=>{
    if(method==='eth_getCode')return'0x60016000';
    throw new Error('not ERC20 metadata');
  };
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,dexUnavailable);
  assert.deepEqual(result,{contractExists:null,name:null,symbol:null});
});

test('ignores Dex metadata for a different contract address',async()=>{
  const rpc=async()=>{throw new Error('temporary RPC failure')};
  const fetchImpl=dexResponse([{
    chainId:'robinhood',liquidity:{usd:99999},
    baseToken:{address:OTHER,name:'Wrong token',symbol:'WRONG'}
  }]);
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,fetchImpl);
  assert.deepEqual(result,{contractExists:false,name:null,symbol:null});
});

test('marks an address with no Robinhood-chain bytecode as not a contract',async()=>{
  const rpc=async method=>method==='eth_getCode'?'0x':null;
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,dexUnavailable);
  assert.deepEqual(result,{contractExists:false,name:null,symbol:null});
});

test('RPC uncertainty stays unknown when the Dex lookup is also unavailable',async()=>{
  const rpc=async()=>{throw new Error('temporary RPC failure')};
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,dexUnavailable);
  assert.deepEqual(result,{contractExists:null,name:null,symbol:null});
});

test('an empty exact Robinhood Dex lookup rejects an uncertain cross-chain address',async()=>{
  const rpc=async()=>{throw new Error('temporary RPC failure')};
  const result=await Identity.resolveTokenIdentity(rpc,ADDRESS,dexResponse([]));
  assert.deepEqual(result,{contractExists:false,name:null,symbol:null});
});

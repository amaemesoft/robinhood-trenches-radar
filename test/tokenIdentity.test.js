'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Identity=require('../lib/tokenIdentity');

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
  const result=await Identity.resolveTokenIdentity(rpc,'0x1111111111111111111111111111111111111111');
  assert.deepEqual(result,{contractExists:true,name:'Optimus',symbol:'OPTIMUS'});
});

test('marks an address with no Robinhood-chain bytecode as not a contract',async()=>{
  const rpc=async method=>method==='eth_getCode'?'0x':null;
  const result=await Identity.resolveTokenIdentity(rpc,'0x1111111111111111111111111111111111111111');
  assert.deepEqual(result,{contractExists:false,name:null,symbol:null});
});

test('RPC uncertainty is not misclassified as a missing contract',async()=>{
  const rpc=async()=>{throw new Error('temporary RPC failure')};
  const result=await Identity.resolveTokenIdentity(rpc,'0x1111111111111111111111111111111111111111');
  assert.deepEqual(result,{contractExists:null,name:null,symbol:null});
});

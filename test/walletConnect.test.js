'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function element(extra={}){
  const listeners={};
  const classes=new Set();
  return{
    textContent:'',title:'',disabled:false,hidden:false,
    addEventListener(type,listener){listeners[type]=listener;},
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
    listeners,
    ...extra
  };
}

async function flush(){
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
}

test('Phantom connection validates chain 4663 and reads balance without sending a transaction',async()=>{
  const calls=[];
  let chain='0x1';
  const provider={
    async request(payload){
      calls.push(payload);
      if(payload.method==='eth_requestAccounts'||payload.method==='eth_accounts')return['0x1111111111111111111111111111111111111111'];
      if(payload.method==='eth_chainId')return chain;
      if(payload.method==='wallet_switchEthereumChain'){chain='0x1237';return null;}
      if(payload.method==='eth_getBalance')return'0xde0b6b3a7640000';
      throw new Error(`unexpected ${payload.method}`);
    },
    on(){}
  };
  const nodes={
    '#walletStatus':element(),'#walletConnect':element(),'#walletState':element(),'#walletAddress':element(),
    '#walletNetwork':element(),'#walletBalance':element(),'#walletNotice':element(),
    '[data-view-panel="desk"]':element({hidden:true})
  };
  const documentListeners={};
  const document={
    querySelector(selector){return nodes[selector]||null;},
    addEventListener(type,listener){documentListeners[type]=listener;}
  };
  const sandbox={window:{phantom:{ethereum:provider}},document,Number,String,BigInt,Promise};
  const source=fs.readFileSync(path.join(__dirname,'..','public','wallet.js'),'utf8');
  vm.runInNewContext(source,sandbox);

  nodes['#walletConnect'].listeners.click();
  await flush();

  assert.equal(nodes['#walletState'].textContent,'Conectada');
  assert.equal(nodes['#walletNetwork'].textContent,'Robinhood Chain · 4663');
  assert.equal(nodes['#walletAddress'].textContent,'0x1111…1111');
  assert.equal(nodes['#walletBalance'].textContent,'1 ETH');
  assert.ok(calls.some(call=>call.method==='wallet_switchEthereumChain'&&call.params[0].chainId==='0x1237'));
  assert.deepEqual([...new Set(calls.map(call=>call.method))].sort(),['eth_chainId','eth_getBalance','eth_requestAccounts','wallet_switchEthereumChain'].sort());
});

test('opening Desk performs a silent account check and never prompts Phantom',async()=>{
  const calls=[];
  const provider={async request(payload){calls.push(payload);return payload.method==='eth_accounts'?[]:'0x1237';},on(){}};
  const nodes={
    '#walletStatus':element(),'#walletConnect':element(),'#walletState':element(),'#walletAddress':element(),
    '#walletNetwork':element(),'#walletBalance':element(),'#walletNotice':element(),
    '[data-view-panel="desk"]':element({hidden:true})
  };
  const documentListeners={};
  const document={querySelector:selector=>nodes[selector]||null,addEventListener(type,listener){documentListeners[type]=listener;}};
  const sandbox={window:{phantom:{ethereum:provider}},document,Number,String,BigInt,Promise};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','public','wallet.js'),'utf8'),sandbox);

  documentListeners['trenches:viewchange']({detail:{view:'desk'}});
  await flush();

  assert.deepEqual(calls.map(call=>call.method),['eth_accounts']);
  assert.equal(nodes['#walletState'].textContent,'No conectada');
});

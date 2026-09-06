'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const ChainScanner=require('../lib/chainScanner');

const WALLET='0x1111111111111111111111111111111111111111';
const POOL='0x2222222222222222222222222222222222222222';
const TOKEN='0x3333333333333333333333333333333333333333';
const WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hashes={buy:'0x'+'a'.repeat(64),sell:'0x'+'b'.repeat(64),transfer:'0x'+'c'.repeat(64),acquire:'0x'+'d'.repeat(64)};
const topic=a=>'0x'+a.slice(2).padStart(64,'0');
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const log=(token,from,to,value)=>({address:token,topics:[TRANSFER_TOPIC,topic(from),topic(to)],data:word(value)});
const symbolResult=s=>{
  const bytes=Buffer.from(s,'utf8').toString('hex').padEnd(64,'0');
  return '0x'+word(32).slice(2)+word(s.length).slice(2)+bytes;
};

function mockRpc(){
  const receipts={
    [hashes.buy]:{status:'0x1',blockNumber:'0x64',blockHash:'0x'+'1'.repeat(64),logs:[log(WETH,WALLET,POOL,100n),log(TOKEN,POOL,WALLET,1000n)]},
    [hashes.sell]:{status:'0x1',blockNumber:'0x65',blockHash:'0x'+'2'.repeat(64),logs:[log(TOKEN,WALLET,POOL,500n),log(WETH,POOL,WALLET,50n)]},
    [hashes.transfer]:{status:'0x1',blockNumber:'0x66',blockHash:'0x'+'3'.repeat(64),logs:[log(TOKEN,WALLET,POOL,200n)]},
    [hashes.acquire]:{status:'0x1',blockNumber:'0x67',blockHash:'0x'+'4'.repeat(64),logs:[log(TOKEN,POOL,WALLET,300n)]}
  };
  return async(method,params)=>{
    if(method==='eth_chainId')return '0x1237';
    if(method==='eth_blockNumber')return '0xc8';
    if(method==='alchemy_getAssetTransfers'){
      const q=params[0];
      const selected=q.fromAddress?[hashes.buy,hashes.sell,hashes.transfer]:[hashes.buy,hashes.sell,hashes.acquire];
      return{transfers:selected.map((hash,index)=>({hash,blockNum:'0x'+(100+index).toString(16)}))};
    }
    if(method==='eth_getTransactionReceipt')return receipts[params[0]];
    if(method==='eth_getTransactionByHash')return{from:WALLET,to:POOL,value:'0x0'};
    if(method==='eth_getBlockByNumber')return{timestamp:'0x6553f100'};
    if(method==='eth_call'){
      if(params[0].data==='0x95d89b41')return symbolResult('TEST');
      if(params[0].data==='0x313ce567')return word(18);
    }
    throw new Error(`unexpected RPC method ${method}`);
  };
}

test('Alchemy backfill scans wallet-outbound activity and classifies only economic swaps',async()=>{
  const scanner=new ChainScanner({rpcUrl:'https://example.invalid',alchemyBackfillBlocks:1000});
  scanner.rpc=mockRpc();
  const result=await scanner.scanAlchemyBackfill({actors:[{id:'alpha',kind:'money',enabled:true,evmAddress:WALLET}]});
  assert.equal(result.transactions,3);
  assert.equal(result.events.length,3);
  const actions=Object.fromEntries(result.events.map(event=>[event.txHash,event.action]));
  assert.equal(actions[hashes.buy],'BUY');
  assert.equal(actions[hashes.sell],'SELL');
  assert.equal(actions[hashes.transfer],'TRANSFER_OUT');
  assert.equal(actions[hashes.acquire],undefined);
  assert.equal(result.discoveryScope,'wallet-outbound-activity');
  assert.ok(result.events.every(event=>event.source==='alchemy-backfill'));
});

test('historical token outflow stays TRANSFER_OUT when internal native evidence is unavailable',async()=>{
  const scanner=new ChainScanner({rpcUrl:'https://example.invalid'});
  scanner.rpc=mockRpc();
  const walletMap=new Map([[WALLET,{id:'alpha'}]]);
  const rows=await scanner.analyzeRpcTx(hashes.transfer,walletMap,'0x66');
  assert.equal(rows[0].action,'TRANSFER_OUT');
  assert.equal(rows[0].classificationEvidence.nativeEvidenceAvailable,'top-level-only');
  assert.equal(rows[0].classificationEvidence.historicalCompleteness,'erc20+external-no-internal');
});

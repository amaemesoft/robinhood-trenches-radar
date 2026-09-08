'use strict';

const PROVISIONAL_MONEY_WALLETS=require('../lib/provisionalMoneyWallets');

const APP_BASE_URL=(process.env.APP_BASE_URL||'http://127.0.0.1:8787').replace(/\/$/,'');
const WRITE_API_TOKEN=process.env.WRITE_API_TOKEN||'';
const RH_RPC_URL=process.env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const POLL_SECONDS=Math.max(30,Number(process.env.POLL_SECONDS||60));
const MAX_BLOCK_RANGE=200;
const START_OVERLAP_BLOCKS=30;
const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const QUOTE_TOKENS=new Set([
  '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
]);
const lower=v=>String(v||'').toLowerCase();
const hexNum=v=>Number.parseInt(v||'0x0',16);
const topicForAddress=a=>'0x'+'0'.repeat(24)+lower(a).replace(/^0x/,'');
const wallets=PROVISIONAL_MONEY_WALLETS.filter(w=>w.enabled!==false&&/^0x[a-fA-F0-9]{40}$/.test(w.evmAddress||''));
const walletMap=new Map(wallets.map(w=>[lower(w.evmAddress),w]));
const walletTopics=wallets.map(w=>topicForAddress(w.evmAddress));
let rpcId=1;
let lastBlock=null;
let running=false;

async function rpc(method,params=[]){
  const response=await fetch(RH_RPC_URL,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:rpcId++,method,params}),
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok){
    let detail='';try{detail=(await response.text()).slice(0,240)}catch{}
    throw new Error(`RPC ${method} HTTP ${response.status}${detail?`: ${detail}`:''}`);
  }
  const payload=await response.json();
  if(payload.error)throw new Error(`RPC ${method}: ${payload.error.message||JSON.stringify(payload.error)}`);
  return payload.result;
}

async function blockTime(blockNumber){
  const block=await rpc('eth_getBlockByNumber',[blockNumber,false]);
  const seconds=hexNum(block?.timestamp);
  return seconds>0?new Date(seconds*1000).toISOString():new Date().toISOString();
}

function parseTransfers(receipt){
  const out=[];
  for(const log of receipt?.logs||[]){
    if(lower(log?.topics?.[0])!==TRANSFER_TOPIC||log.topics.length!==3||!/^0x[0-9a-fA-F]{64}$/.test(log.data||''))continue;
    const token=lower(log.address);
    const from='0x'+String(log.topics[1]).slice(-40).toLowerCase();
    const to='0x'+String(log.topics[2]).slice(-40).toLowerCase();
    let value=0n;try{value=BigInt(log.data)}catch{continue;}
    if(value>0n)out.push({token,from,to,value});
  }
  return out;
}

async function recentKeys(){
  try{
    const response=await fetch(`${APP_BASE_URL}/api/dashboard`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return new Set();
    const data=await response.json();
    return new Set((data.recentEvents||[]).map(e=>e.key).filter(Boolean));
  }catch{return new Set();}
}

async function postEvent(event){
  const response=await fetch(`${APP_BASE_URL}/api/events`,{
    method:'POST',
    headers:{authorization:`Bearer ${WRITE_API_TOKEN}`,'content-type':'application/json'},
    body:JSON.stringify(event),
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
    const text=await response.text();
    throw new Error(`event HTTP ${response.status}: ${text.slice(0,240)}`);
  }
}

async function analyzeTx(txHash,blockHint,existing){
  const [receipt,tx]=await Promise.all([
    rpc('eth_getTransactionReceipt',[txHash]),
    rpc('eth_getTransactionByHash',[txHash])
  ]);
  if(!receipt||!tx||receipt.status==='0x0')return 0;
  const transfers=parseTransfers(receipt);
  const involved=new Set();
  for(const t of transfers){
    if(walletMap.has(t.from))involved.add(t.from);
    if(walletMap.has(t.to))involved.add(t.to);
  }
  if(!involved.size)return 0;
  const txFrom=lower(tx.from),txTo=lower(tx.to);
  let nativeValue=0n;try{nativeValue=BigInt(tx.value||'0x0')}catch{}
  const at=await blockTime(receipt.blockNumber||blockHint);
  const blockNumber=hexNum(receipt.blockNumber||blockHint)||null;
  let posted=0;

  for(const wallet of involved){
    const deltas=new Map();
    for(const t of transfers){
      let delta=0n;
      if(t.from===wallet)delta-=t.value;
      if(t.to===wallet)delta+=t.value;
      if(delta)deltas.set(t.token,(deltas.get(t.token)||0n)+delta);
    }
    const nonzero=[...deltas.entries()].filter(([,d])=>d!==0n);
    const nativeSpent=txFrom===wallet&&nativeValue>0n;
    const nativeReceived=txTo===wallet&&nativeValue>0n;
    for(const [token,delta] of nonzero){
      if(QUOTE_TOKENS.has(token))continue;
      const otherOut=nonzero.filter(([other,d])=>other!==token&&d<0n).map(([other])=>other);
      const otherIn=nonzero.filter(([other,d])=>other!==token&&d>0n).map(([other])=>other);
      const quoteOut=otherOut.some(other=>QUOTE_TOKENS.has(other));
      const quoteIn=otherIn.some(other=>QUOTE_TOKENS.has(other));
      const action=delta>0n?(quoteOut||nativeSpent?'BUY':'ACQUIRE'):(quoteIn||nativeReceived?'SELL':'TRANSFER_OUT');
      const actor=walletMap.get(wallet);
      const key=`${txHash}:${actor.id}:${token}`;
      if(existing.has(key))continue;
      await postEvent({
        key,actorId:actor.id,action,tokenAddress:token,
        blockNumber,blockHash:receipt.blockHash||null,at,
        signalRole:action==='BUY'?'execution':null,
        source:'rpc-smart-money-25'
      });
      existing.add(key);posted++;
    }
  }
  return posted;
}

async function queryWalletLogs(fromHex,toHex){
  const logs=[];
  // Robinhood's managed/public RPC can reject a large OR-array in topic filters.
  // Query each wallet independently so coverage is exact and provider-compatible.
  for(const walletTopic of walletTopics){
    const [sent,received]=await Promise.all([
      rpc('eth_getLogs',[{fromBlock:fromHex,toBlock:toHex,topics:[TRANSFER_TOPIC,walletTopic]}]),
      rpc('eth_getLogs',[{fromBlock:fromHex,toBlock:toHex,topics:[TRANSFER_TOPIC,null,walletTopic]}])
    ]);
    logs.push(...(sent||[]),...(received||[]));
  }
  return logs;
}

async function tick(){
  if(running||!WRITE_API_TOKEN||!walletTopics.length)return;
  running=true;
  try{
    const latest=hexNum(await rpc('eth_blockNumber'));
    if(!Number.isFinite(latest)||latest<=0)return;
    const from=lastBlock==null?Math.max(0,latest-START_OVERLAP_BLOCKS):lastBlock+1;
    if(from>latest)return;
    const to=Math.min(latest,from+MAX_BLOCK_RANGE-1);
    const fromHex='0x'+from.toString(16),toHex='0x'+to.toString(16);
    const [logs,existing]=await Promise.all([queryWalletLogs(fromHex,toHex),recentKeys()]);
    const txs=new Map();
    for(const log of logs)if(log?.transactionHash)txs.set(log.transactionHash,log.blockNumber||null);
    let events=0,failed=0;
    for(const [hash,blockHint] of txs){
      try{events+=await analyzeTx(hash,blockHint,existing)}catch(error){failed++;console.warn(`[smart25] ${hash}: ${error.message}`)}
    }
    if(!failed)lastBlock=to;
    console.log(`[smart25] blocks=${from}-${to} wallets=${wallets.length} logQueries=${walletTopics.length*2} tx=${txs.size} events=${events} failed=${failed}`);
  }catch(error){
    console.error(`[smart25] ${new Date().toISOString()} ${error.message}`);
  }finally{running=false;}
}

if(!WRITE_API_TOKEN){
  console.error('[smart25] WRITE_API_TOKEN unavailable; monitor disabled');
}else if(!walletTopics.length){
  console.error('[smart25] no provisional wallets; monitor disabled');
}else{
  console.log(`[smart25] live RPC fallback enabled for ${wallets.length} provisional wallets; combined target coverage=25`);
  setTimeout(tick,2500);
  setInterval(tick,POLL_SECONDS*1000);
}

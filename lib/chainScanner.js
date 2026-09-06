'use strict';

const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CHAIN_ID_HEX='0x1237';

const lower=a=>String(a||'').toLowerCase();
const blockHex=n=>'0x'+Number(n).toString(16);
const hexNum=h=>Number.parseInt(h||'0x0',16);
const topicAddress=t=>t&&t.length>=42?'0x'+t.slice(-40).toLowerCase():null;
const addressTopic=a=>'0x'+'0'.repeat(24)+lower(a).replace(/^0x/,'');

function formatUnits(raw,decimals=18){
  let v=BigInt(raw),neg=v<0n;if(neg)v=-v;
  const s=v.toString().padStart(decimals+1,'0');
  const whole=s.slice(0,-decimals)||'0';
  const frac=decimals?s.slice(-decimals).replace(/0+$/,''):'';
  return (neg?'-':'')+whole+(frac?'.'+frac.slice(0,8):'');
}

function decodeString(hex){
  try{
    const h=(hex||'').replace(/^0x/,'');
    if(!h)return null;
    if(h.length>=128){
      const off=Number.parseInt(h.slice(0,64),16)*2;
      const len=Number.parseInt(h.slice(off,off+64),16)*2;
      const data=h.slice(off+64,off+64+len);
      return Buffer.from(data,'hex').toString('utf8').replace(/\0/g,'').trim()||null;
    }
    return Buffer.from(h.slice(0,64),'hex').toString('utf8').replace(/\0/g,'').trim()||null;
  }catch{return null;}
}

class ChainScanner{
  constructor({rpcUrl,backfillBlocks=1200,maxBlockRange=500}){
    this.rpcUrl=rpcUrl;
    this.backfillBlocks=Math.max(100,Number(backfillBlocks)||1200);
    this.maxBlockRange=Math.max(50,Number(maxBlockRange)||500);
    this.rpcId=1;
    this.metaCache=new Map();
    this.blockCache=new Map();
    this.marketCache=new Map();
  }

  async rpc(method,params=[]){
    if(!this.rpcUrl)throw new Error('RH_RPC_URL is not configured');
    const r=await fetch(this.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:this.rpcId++,method,params}),signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error(`RPC ${method} HTTP ${r.status}`);
    const j=await r.json();
    if(j.error)throw new Error(`RPC ${method}: ${j.error.message||JSON.stringify(j.error)}`);
    return j.result;
  }

  async tokenMeta(address){
    address=lower(address);
    if(this.metaCache.has(address))return this.metaCache.get(address);
    let symbol=null,decimals=18;
    try{symbol=decodeString(await this.rpc('eth_call',[{to:address,data:'0x95d89b41'},'latest']));}catch{}
    try{const x=hexNum(await this.rpc('eth_call',[{to:address,data:'0x313ce567'},'latest']));if(Number.isFinite(x)&&x>=0&&x<=255)decimals=x;}catch{}
    const meta={symbol:symbol||address.slice(0,8),decimals};
    this.metaCache.set(address,meta);
    return meta;
  }

  async market(address){
    address=lower(address);
    if(this.marketCache.has(address))return this.marketCache.get(address);
    let out=null;
    try{
      const r=await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${address}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(r.ok){
        const rows=await r.json();
        const pairs=(Array.isArray(rows)?rows:[]).filter(p=>p&&p.chainId==='robinhood');
        const base=pairs.filter(p=>lower(p.baseToken?.address)===address);
        const candidates=base.length?base:pairs;
        candidates.sort((a,b)=>Number(b.liquidity?.usd||0)-Number(a.liquidity?.usd||0));
        const p=candidates[0];
        if(p)out={marketCap:Number(p.marketCap||p.fdv)||null,fdv:Number(p.fdv)||null,priceUsd:Number(p.priceUsd)||null,liquidityUsd:Number(p.liquidity?.usd)||null,pairAddress:p.pairAddress||null,dexId:p.dexId||null,marketSource:'dexscreener'};
      }
    }catch{}
    this.marketCache.set(address,out);
    return out;
  }

  async blockInfo(blockNumber){
    const key=lower(blockNumber);
    if(this.blockCache.has(key))return this.blockCache.get(key);
    const b=await this.rpc('eth_getBlockByNumber',[blockNumber,false]);
    const out={number:hexNum(b?.number),hash:b?.hash||null,time:b?.timestamp?new Date(hexNum(b.timestamp)*1000).toISOString():new Date().toISOString()};
    this.blockCache.set(key,out);
    return out;
  }

  async logsForRange(from,to,walletTopics){
    const base={fromBlock:blockHex(from),toBlock:blockHex(to)};
    const [outgoing,incoming]=await Promise.all([
      this.rpc('eth_getLogs',[{...base,topics:[TRANSFER_TOPIC,walletTopics]}]),
      this.rpc('eth_getLogs',[{...base,topics:[TRANSFER_TOPIC,null,walletTopics]}])
    ]);
    const m=new Map();
    for(const l of [...outgoing,...incoming])m.set(`${l.transactionHash}:${l.logIndex}`,l);
    return [...m.values()];
  }

  async analyzeTx(txHash,walletMap){
    const [receipt,tx]=await Promise.all([this.rpc('eth_getTransactionReceipt',[txHash]),this.rpc('eth_getTransactionByHash',[txHash])]);
    if(!receipt)return [];
    const involved=new Set();
    for(const l of receipt.logs||[]){
      if(lower(l.topics?.[0])!==TRANSFER_TOPIC||l.topics.length!==3)continue;
      const f=topicAddress(l.topics[1]),t=topicAddress(l.topics[2]);
      if(walletMap.has(f))involved.add(f);
      if(walletMap.has(t))involved.add(t);
    }
    if(!involved.size)return [];
    const block=await this.blockInfo(receipt.blockNumber);
    const rows=[];
    for(const wallet of involved){
      const deltas=new Map();
      for(const l of receipt.logs||[]){
        if(lower(l.topics?.[0])!==TRANSFER_TOPIC||l.topics.length!==3||!/^0x[0-9a-fA-F]{64}$/.test(l.data||''))continue;
        const from=topicAddress(l.topics[1]),to=topicAddress(l.topics[2]),token=lower(l.address);
        let d=0n;const value=BigInt(l.data);
        if(from===wallet)d-=value;if(to===wallet)d+=value;
        if(d)deltas.set(token,(deltas.get(token)||0n)+d);
      }
      const nonzero=[...deltas.entries()].filter(([,d])=>d!==0n);
      const hasOut=nonzero.some(([,d])=>d<0n);
      const hasIn=nonzero.some(([,d])=>d>0n);
      const nativeSpent=lower(tx?.from)===wallet&&BigInt(tx?.value||'0x0')>0n;
      for(const [token,delta] of nonzero){
        const otherOut=nonzero.some(([t,d])=>t!==token&&d<0n);
        const otherIn=nonzero.some(([t,d])=>t!==token&&d>0n);
        let action;
        if(delta>0n)action=(otherOut||nativeSpent)?'BUY':'ACQUIRE';
        else action=otherIn?'SELL':'TRANSFER_OUT';
        const meta=await this.tokenMeta(token);
        rows.push({actorId:walletMap.get(wallet).id,wallet,action,tokenAddress:token,symbol:meta.symbol,amountRaw:delta.toString(),amount:formatUnits(delta,meta.decimals),txHash,blockNumber:block.number,blockHash:block.hash,at:block.time,source:'robinhood-rpc',signalRole:action==='BUY'?'execution':null,classificationEvidence:{otherTokenOut:otherOut,otherTokenIn:otherIn,nativeSpent,hasOut,hasIn}});
      }
    }
    return rows;
  }

  async scan({actors=[],sync={},existingKeys=new Set()}){
    const money=actors.filter(a=>a.kind==='money'&&a.enabled!==false&&/^0x[a-fA-F0-9]{40}$/.test(a.evmAddress||''));
    if(!money.length)return{events:[],tokenStates:{},latestBlock:null,fromBlock:null,toBlock:null};
    const chainId=lower(await this.rpc('eth_chainId'));
    if(chainId!==CHAIN_ID_HEX)throw new Error(`wrong chain id ${chainId}; expected ${CHAIN_ID_HEX}`);
    const latest=hexNum(await this.rpc('eth_blockNumber'));
    let from=Number(sync.lastScannedBlock||0)+1;
    if(!sync.lastScannedBlock)from=Math.max(0,latest-this.backfillBlocks+1);
    if(from>latest)return{events:[],tokenStates:{},latestBlock:latest,fromBlock:from,toBlock:latest};
    const walletMap=new Map(money.map(a=>[lower(a.evmAddress),a]));
    const walletTopics=[...walletMap.keys()].map(addressTopic);
    const txHashes=new Set();
    for(let start=from;start<=latest;start+=this.maxBlockRange){
      const end=Math.min(latest,start+this.maxBlockRange-1);
      const logs=await this.logsForRange(start,end,walletTopics);
      for(const l of logs)txHashes.add(l.transactionHash);
    }
    const events=[];
    for(const hash of txHashes){
      const rows=await this.analyzeTx(hash,walletMap);
      for(const e of rows){
        e.key=`${e.txHash}:${e.actorId}:${e.tokenAddress}`;
        if(!existingKeys.has(e.key)){events.push(e);existingKeys.add(e.key);}
      }
    }
    events.sort((a,b)=>new Date(b.at)-new Date(a.at));
    const tokenStates={};
    const tokens=[...new Set(events.map(e=>e.tokenAddress))];
    for(const token of tokens){
      const m=await this.market(token);
      if(m)tokenStates[token]={marketCap:m.marketCap,priceUsd:m.priceUsd,fdv:m.fdv,execution:{liquidityUsd:m.liquidityUsd,pairAddress:m.pairAddress,dexId:m.dexId,marketSource:m.marketSource}};
    }
    return{events,tokenStates,latestBlock:latest,fromBlock:from,toBlock:latest,transactions:txHashes.size,trackedWallets:money.length,chainId:4663};
  }
}

module.exports=ChainScanner;

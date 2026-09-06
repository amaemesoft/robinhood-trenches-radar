'use strict';

const CHAIN_ID_HEX='0x1237';
const BLOCKSCOUT_BASE='https://api.blockscout.com/4663/api/v2';
const CANONICAL_QUOTE_TOKENS=new Set([
  '0x0bd7d308f8e1639fab988df18a8011f41eacad73', // WETH
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168'  // USDG
]);
const lower=a=>String(a||'').toLowerCase();
const hexNum=h=>Number.parseInt(h||'0x0',16);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function formatUnits(raw,decimals=18){
  try{
    let v=BigInt(String(raw||'0')),neg=v<0n;if(neg)v=-v;
    const s=v.toString().padStart(decimals+1,'0');
    const whole=s.slice(0,-decimals)||'0';
    const frac=decimals?s.slice(-decimals).replace(/0+$/,''):'';
    return (neg?'-':'')+whole+(frac?'.'+frac.slice(0,8):'');
  }catch{return null;}
}

class ChainScanner{
  constructor({rpcUrl,blockscoutApiKey='',backfillBlocks=1200,maxBlockRange=500}){
    this.rpcUrl=rpcUrl;
    this.blockscoutApiKey=blockscoutApiKey||'';
    this.backfillBlocks=Math.max(100,Number(backfillBlocks)||1200);
    this.maxBlockRange=Math.max(50,Number(maxBlockRange)||500);
    this.rpcId=1;
    this.marketCache=new Map();
    this.lastCreditsRemaining=null;
    this.lastRateRemaining=null;
  }

  hasPro(){return /^proapi_/i.test(this.blockscoutApiKey);}
  isQuoteToken(address){return CANONICAL_QUOTE_TOKENS.has(lower(address));}

  async rpc(method,params=[]){
    if(!this.rpcUrl)throw new Error('RH_RPC_URL is not configured');
    const waits=[0,400,1200];let last;
    for(const wait of waits){
      if(wait)await sleep(wait);
      try{
        const r=await fetch(this.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:this.rpcId++,method,params}),signal:AbortSignal.timeout(12000)});
        if(r.status===429){last=new Error(`RPC ${method} HTTP 429`);continue;}
        if(!r.ok)throw new Error(`RPC ${method} HTTP ${r.status}`);
        const j=await r.json();
        if(j.error)throw new Error(`RPC ${method}: ${j.error.message||JSON.stringify(j.error)}`);
        return j.result;
      }catch(e){last=e;if(!String(e.message).includes('429'))throw e;}
    }
    throw last||new Error(`RPC ${method} failed`);
  }

  async proGet(path,params={}){
    if(!this.hasPro())throw new Error('BLOCKSCOUT_API_KEY is not configured');
    const u=new URL(BLOCKSCOUT_BASE+path);
    for(const [k,v] of Object.entries(params))if(v!=null)u.searchParams.set(k,String(v));
    const r=await fetch(u,{headers:{accept:'application/json',authorization:`Bearer ${this.blockscoutApiKey}`,'user-agent':'Robinhood-Trenches-Radar/0.5'},signal:AbortSignal.timeout(15000)});
    this.lastCreditsRemaining=r.headers.get('x-credits-remaining');
    this.lastRateRemaining=r.headers.get('x-ratelimit-remaining');
    if(!r.ok){
      let detail='';try{detail=(await r.text()).slice(0,240)}catch{}
      throw new Error(`Blockscout PRO HTTP ${r.status}${detail?`: ${detail}`:''}`);
    }
    return r.json();
  }

  async market(address,force=false){
    address=lower(address);
    if(!force&&this.marketCache.has(address))return this.marketCache.get(address);
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

  transferParts(t){
    const from=lower(t?.from?.hash||t?.from?.address_hash||t?.from);
    const to=lower(t?.to?.hash||t?.to?.address_hash||t?.to);
    const token=lower(t?.token?.address_hash||t?.token?.address||t?.token_address);
    const symbol=t?.token?.symbol||token.slice(0,8);
    const decimals=Number(t?.token?.decimals??18);
    const raw=t?.total?.value??t?.value??'0';
    return{from,to,token,symbol,decimals,raw:String(raw)};
  }

  async discoverTransactions(money,sinceMs){
    const txHashes=new Set();let transferRecords=0,pages=0;
    for(const actor of money){
      let next={};
      for(let page=0;page<3;page++){
        const j=await this.proGet(`/addresses/${lower(actor.evmAddress)}/token-transfers`,next);
        pages++;
        const items=Array.isArray(j.items)?j.items:[];
        if(!items.length)break;
        let reachedOld=false;
        for(const item of items){
          const ts=Date.parse(item.timestamp||'');
          if(Number.isFinite(ts)&&ts<sinceMs){reachedOld=true;continue;}
          if(item.transaction_hash){txHashes.add(item.transaction_hash);transferRecords++;}
        }
        if(reachedOld||!j.next_page_params)break;
        next=j.next_page_params;
        await sleep(120);
      }
      await sleep(120);
    }
    return{txHashes,transferRecords,pages};
  }

  async analyzeTx(txHash,walletMap){
    if(!this.hasPro())return[];
    const [tx,tt]=await Promise.all([
      this.proGet(`/transactions/${txHash}`),
      this.proGet(`/transactions/${txHash}/token-transfers`)
    ]);
    const transfers=Array.isArray(tt?.items)?tt.items:(Array.isArray(tx?.token_transfers)?tx.token_transfers:[]);
    const involved=new Set();
    for(const t of transfers){
      const p=this.transferParts(t);
      if(walletMap.has(p.from))involved.add(p.from);
      if(walletMap.has(p.to))involved.add(p.to);
    }
    if(!involved.size)return[];
    const timestamp=tx?.timestamp||new Date().toISOString();
    const blockNumber=Number(tx?.block_number??0)||null;
    const blockHash=tx?.block_hash||null;
    const txFrom=lower(tx?.from?.hash||tx?.from);
    let nativeValue=0n;try{nativeValue=BigInt(String(tx?.value||'0'));}catch{}
    const states=new Map();

    for(const wallet of involved){
      const deltas=new Map(),meta=new Map();
      for(const t of transfers){
        const p=this.transferParts(t);
        if(!/^0x[a-f0-9]{40}$/.test(p.token))continue;
        let v=0n;try{v=BigInt(p.raw)}catch{continue;}
        let d=0n;if(p.from===wallet)d-=v;if(p.to===wallet)d+=v;
        if(d){deltas.set(p.token,(deltas.get(p.token)||0n)+d);meta.set(p.token,p);}
      }
      const nonzero=[...deltas.entries()].filter(([,d])=>d!==0n);
      const nativeSpent=txFrom===wallet&&nativeValue>0n;
      const needsNativeInflowCheck=nonzero.some(([token,delta])=>{
        if(delta>=0n||this.isQuoteToken(token))return false;
        return !nonzero.some(([t,d])=>t!==token&&d>0n);
      });
      states.set(wallet,{nonzero,meta,nativeSpent,needsNativeInflowCheck});
    }

    let internalTransfers=[],nativeEvidenceAvailable=true;
    if([...states.values()].some(s=>s.needsNativeInflowCheck)){
      try{
        const internals=await this.proGet(`/transactions/${txHash}/internal-transactions`);
        internalTransfers=Array.isArray(internals?.items)?internals.items:[];
      }catch{
        nativeEvidenceAvailable=false;
      }
    }

    const nativeDeltaFor=wallet=>{
      let delta=0n;
      for(const t of internalTransfers){
        if(t?.success===false)continue;
        const from=lower(t?.from?.hash||t?.from?.address_hash||t?.from);
        const to=lower(t?.to?.hash||t?.to?.address_hash||t?.to);
        let v=0n;try{v=BigInt(String(t?.value||'0'));}catch{continue;}
        if(from===wallet)delta-=v;
        if(to===wallet)delta+=v;
      }
      return delta;
    };

    const rows=[];
    for(const wallet of involved){
      const {nonzero,meta,nativeSpent,needsNativeInflowCheck}=states.get(wallet);
      const nativeDelta=needsNativeInflowCheck?nativeDeltaFor(wallet):0n;
      const nativeReceived=nativeDelta>0n;
      for(const [token,delta] of nonzero){
        const p=meta.get(token)||{symbol:token.slice(0,8),decimals:18};
        if(this.isQuoteToken(token))continue;
        const otherOutTokens=nonzero.filter(([t,d])=>t!==token&&d<0n).map(([t])=>t);
        const otherInTokens=nonzero.filter(([t,d])=>t!==token&&d>0n).map(([t])=>t);
        const otherOut=otherOutTokens.length>0;
        const otherIn=otherInTokens.length>0;
        let action;
        if(delta>0n)action=(otherOut||nativeSpent)?'BUY':'ACQUIRE';
        else action=(otherIn||nativeReceived)?'SELL':'TRANSFER_OUT';
        rows.push({actorId:walletMap.get(wallet).id,wallet,action,tokenAddress:token,symbol:p.symbol,amountRaw:delta.toString(),amount:formatUnits(delta,p.decimals),txHash,blockNumber,blockHash,at:timestamp,source:'blockscout-pro',signalRole:action==='BUY'?'execution':null,classificationEvidence:{otherTokenOut:otherOut,otherTokenIn:otherIn,otherOutTokens,otherInTokens,nativeSpent,nativeReceived,nativeDeltaRaw:nativeDelta.toString(),nativeEvidenceAvailable:needsNativeInflowCheck?nativeEvidenceAvailable:null,quoteAssetRule:'exact-contract'}});
      }
    }
    return rows;
  }

  async scan({actors=[],sync={},existingKeys=new Set()}){
    const money=actors.filter(a=>a.kind==='money'&&a.enabled!==false&&/^0x[a-fA-F0-9]{40}$/.test(a.evmAddress||''));
    let latest=null;
    try{
      const chainId=lower(await this.rpc('eth_chainId'));
      if(chainId!==CHAIN_ID_HEX)throw new Error(`wrong chain id ${chainId}; expected ${CHAIN_ID_HEX}`);
      latest=hexNum(await this.rpc('eth_blockNumber'));
    }catch(e){
      if(this.hasPro()){
        const blocks=await this.proGet('/blocks');latest=Number(blocks?.items?.[0]?.height??blocks?.items?.[0]?.number??0)||null;
      }else throw e;
    }

    if(!this.hasPro()){
      return{events:[],tokenStates:{},latestBlock:latest,fromBlock:latest,toBlock:latest,transactions:0,trackedWallets:money.length,chainId:4663,discovery:'awaiting-blockscout-key',providerReady:false};
    }

    const marginMs=3*60*1000;
    const sinceMs=sync.lastChainSync?Math.max(0,Date.parse(sync.lastChainSync)-marginMs):Date.now()-15*60*1000;
    const walletMap=new Map(money.map(a=>[lower(a.evmAddress),a]));
    const discovery=await this.discoverTransactions(money,sinceMs);
    const events=[];
    for(const hash of discovery.txHashes){
      const rows=await this.analyzeTx(hash,walletMap);
      for(const e of rows){
        e.key=`${e.txHash}:${e.actorId}:${e.tokenAddress}`;
        if(!existingKeys.has(e.key)){events.push(e);existingKeys.add(e.key);}
      }
      await sleep(80);
    }
    events.sort((a,b)=>new Date(b.at)-new Date(a.at));
    const tokenStates={};
    for(const token of [...new Set(events.map(e=>e.tokenAddress))]){
      const m=await this.market(token,true);
      if(m)tokenStates[token]={marketCap:m.marketCap,priceUsd:m.priceUsd,fdv:m.fdv,execution:{liquidityUsd:m.liquidityUsd,pairAddress:m.pairAddress,dexId:m.dexId,marketSource:m.marketSource}};
    }
    return{events,tokenStates,latestBlock:latest,fromBlock:Number(sync.lastScannedBlock||latest),toBlock:latest,transactions:discovery.txHashes.size,transferRecords:discovery.transferRecords,pages:discovery.pages,trackedWallets:money.length,chainId:4663,discovery:'blockscout-pro',providerReady:true,creditsRemaining:this.lastCreditsRemaining,rateRemaining:this.lastRateRemaining};
  }
}

module.exports=ChainScanner;

'use strict';

const DEFAULT_BASE='https://robinhoodchain.blockscout.com/api/v2';
const ZERO='0x0000000000000000000000000000000000000000';
const lower=v=>String(v||'').toLowerCase();
const validAddress=v=>/^0x[a-f0-9]{40}$/.test(lower(v));

function toBigInt(value){
  try{
    if(value==null||value==='')return null;
    return BigInt(String(value));
  }catch{return null;}
}

function parseTokenInfo(payload={}){
  const holders=Number(payload.holders_count??payload.token_holders_count);
  const supply=toBigInt(payload.total_supply);
  const decimals=Number(payload.decimals);
  return{
    holders:Number.isFinite(holders)&&holders>=0?holders:null,
    totalSupplyRaw:supply,
    decimals:Number.isInteger(decimals)&&decimals>=0&&decimals<=36?decimals:null,
    symbol:payload.symbol||null,
    name:payload.name||null,
    type:payload.type||null
  };
}

function holderAddress(item={}){
  return lower(item.address_hash?.hash||item.address?.hash||item.address_hash||item.address||'');
}

function topHolderConcentration(items=[],totalSupplyRaw,options={}){
  const supply=toBigInt(totalSupplyRaw);
  if(!supply||supply<=0n)return{top10Pct:null,top10Raw:null,included:0,excluded:0};
  const excluded=new Set([ZERO,...(options.excludeAddresses||[])].map(lower).filter(validAddress));
  const token=lower(options.tokenAddress);
  if(validAddress(token))excluded.add(token);
  const rows=[];
  let excludedCount=0;
  for(const item of items||[]){
    const address=holderAddress(item);
    const value=toBigInt(item?.value);
    if(!value||value<=0n)continue;
    if(excluded.has(address)){excludedCount++;continue;}
    rows.push({address,value});
  }
  rows.sort((a,b)=>a.value===b.value?0:a.value>b.value?-1:1);
  const top=rows.slice(0,10);
  const sum=top.reduce((acc,row)=>acc+row.value,0n);
  // ratio * 1e6 then /1e4 yields percentage with four-decimal precision while keeping BigInt safe.
  const pct=Number((sum*1000000n)/supply)/10000;
  return{
    top10Pct:Number(Math.max(0,Math.min(100,Number(pct.toFixed(4))))),
    top10Raw:sum.toString(),included:top.length,excluded:excludedCount,
    addresses:top.map(row=>row.address)
  };
}

class HolderSnapshotProvider{
  constructor({baseUrl=DEFAULT_BASE,fetchFn=globalThis.fetch,timeoutMs=10000}={}){
    this.baseUrl=String(baseUrl||DEFAULT_BASE).replace(/\/$/,'');
    this.fetchFn=fetchFn;
    this.timeoutMs=Math.max(1000,Number(timeoutMs)||10000);
  }

  async getJson(path){
    if(typeof this.fetchFn!=='function')throw new Error('fetch unavailable');
    const response=await this.fetchFn(this.baseUrl+path,{
      headers:{accept:'application/json','user-agent':'Robinhood-Trenches-Radar/0.6'},
      signal:AbortSignal.timeout(this.timeoutMs)
    });
    if(!response.ok)throw new Error(`holder provider HTTP ${response.status}`);
    return response.json();
  }

  async snapshot(tokenAddress,{pairAddress=null}={}){
    const token=lower(tokenAddress);
    if(!validAddress(token))return{status:'UNKNOWN',reason:'invalid_token_address',holders:null,top10Pct:null};
    const observedAt=new Date().toISOString();
    try{
      const infoPayload=await this.getJson(`/tokens/${token}`);
      const info=parseTokenInfo(infoPayload);
      if(info.holders==null)return{status:'UNKNOWN',reason:'holder_count_unavailable',holders:null,top10Pct:null,observedAt,source:'blockscout-instance-v2'};

      let concentration={top10Pct:null,included:0,excluded:0};
      try{
        const holdersPayload=await this.getJson(`/tokens/${token}/holders`);
        concentration=topHolderConcentration(holdersPayload?.items||[],info.totalSupplyRaw,{
          tokenAddress:token,excludeAddresses:[pairAddress].filter(Boolean)
        });
      }catch{}

      return{
        status:'MEASURED',reason:'blockscout_token_snapshot',observedAt,source:'blockscout-instance-v2',
        holders:info.holders,top10Pct:concentration.top10Pct,top10Included:concentration.included,top10Excluded:concentration.excluded,
        totalSupplyRaw:info.totalSupplyRaw?.toString()||null,decimals:info.decimals,symbol:info.symbol,name:info.name
      };
    }catch(error){
      return{status:'UNKNOWN',reason:'provider_unavailable',error:error.message,holders:null,top10Pct:null,observedAt,source:'blockscout-instance-v2'};
    }
  }
}

module.exports={HolderSnapshotProvider,DEFAULT_BASE,ZERO,validAddress,toBigInt,parseTokenInfo,holderAddress,topHolderConcentration};

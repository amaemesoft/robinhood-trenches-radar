'use strict';

const DEFAULT_WINDOW_DAYS=30;
const CYCLE_SEEDS=[
  {tokenAddress:'0xd5f1afea47b1a9eab414d2ee740cf1d6d039e725',symbol:'microduck',name:'microduck',reason:'known-cycle-candidate'},
  {tokenAddress:'0x6245e67affa44a23077f0ea7f981a8dc743a0c47',symbol:'FRONG',name:'frong',reason:'known-cycle-candidate'}
];

const lower=v=>String(v||'').toLowerCase();
const validAddress=v=>/^0x[a-f0-9]{40}$/.test(lower(v));

function recentCycleEvents(events=[],now=Date.now(),windowDays=DEFAULT_WINDOW_DAYS){
  const cut=now-Math.max(1,Number(windowDays)||DEFAULT_WINDOW_DAYS)*24*3600e3;
  return (events||[]).filter(e=>validAddress(e?.tokenAddress)&&Date.parse(e?.at||'')>=cut);
}

function buildCycleUniverse({events=[],tokenState={},holderHistory={},marketHistory={},seeds=CYCLE_SEEDS,now=Date.now(),windowDays=DEFAULT_WINDOW_DAYS}={}){
  const recent=recentCycleEvents(events,now,windowDays);
  const out=new Map();
  const add=(address,meta={})=>{
    const tokenAddress=lower(address);
    if(!validAddress(tokenAddress))return;
    const current=out.get(tokenAddress)||{tokenAddress,reasons:[]};
    for(const reason of [meta.reason].flat().filter(Boolean))if(!current.reasons.includes(reason))current.reasons.push(reason);
    for(const key of ['symbol','name'])if(meta[key]&&!current[key])current[key]=meta[key];
    out.set(tokenAddress,current);
  };
  for(const seed of seeds||[])add(seed.tokenAddress,seed);
  for(const e of recent)add(e.tokenAddress,{symbol:e.symbol,reason:'recent-cycle-event'});
  for(const address of Object.keys(tokenState||{}))add(address,{reason:'known-token-state'});
  for(const address of Object.keys(holderHistory||{}))add(address,{reason:'holder-history'});
  for(const address of Object.keys(marketHistory||{}))add(address,{reason:'market-history'});
  return [...out.values()];
}

function groupCycleEvents(events=[],now=Date.now(),windowDays=DEFAULT_WINDOW_DAYS){
  const groups=new Map();
  for(const e of recentCycleEvents(events,now,windowDays)){
    const address=lower(e.tokenAddress);
    if(!groups.has(address))groups.set(address,[]);
    groups.get(address).push(e);
  }
  return groups;
}

module.exports={CYCLE_SEEDS,DEFAULT_WINDOW_DAYS,validAddress,recentCycleEvents,buildCycleUniverse,groupCycleEvents};

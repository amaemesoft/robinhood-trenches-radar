'use strict';

// Cycle candidates must decay gradually rather than disappear on the tactical 24h boundary.
const DEFAULT_WINDOW_DAYS=90;
const CYCLE_SEEDS=[
  {tokenAddress:'0x020bfc650a365f8bb26819deaabf3e21291018b4',symbol:'CASHCAT',name:'Cash Cat',reason:'cycle-thesis-cohort'},
  {tokenAddress:'0x2e8c31162b855a2ffa90f6f8634643ad6f111e18',symbol:'AI',name:'Artificial Inu',reason:'cycle-thesis-cohort'},
  {tokenAddress:'0x98096d17e191b3da1d5f99a6d7b3584351b11e18',symbol:'BONER',name:'Boner Coin',reason:'cycle-thesis-cohort'},
  {tokenAddress:'0x5cb6f181081301b44905f3ae15419112ecabd8a6',symbol:'PIPEDOG',name:'pipedog',reason:'cycle-thesis-cohort'},
  {tokenAddress:'0x45242320dbb855eea8fd36804c6487e10e97fcf9',symbol:'TENDIES',name:'TENDIES',reason:'cycle-thesis-cohort'},
  {tokenAddress:'0x7fe995a80075df3dc8ae11a9b82c7fe4202cd87f',symbol:'HMM',name:'Thinking Cat',reason:'cycle-thesis-cohort'},
  {tokenAddress:'0x6245e67affa44a23077f0ea7f981a8dc743a0c47',symbol:'FRONG',name:'FRONG',reason:'cycle-thesis-cohort'},
  {tokenAddress:'0xd5f1afea47b1a9eab414d2ee740cf1d6d039e725',symbol:'MICRODUCK',name:'MicroDuck',reason:'cycle-thesis-cohort'}
];

const lower=v=>String(v||'').toLowerCase();
const validAddress=v=>/^0x[a-f0-9]{40}$/.test(lower(v));
const recentAt=(value,cut)=>{const at=Date.parse(value||'');return Number.isFinite(at)&&at>=cut;};

function recentCycleEvents(events=[],now=Date.now(),windowDays=DEFAULT_WINDOW_DAYS){
  const cut=now-Math.max(1,Number(windowDays)||DEFAULT_WINDOW_DAYS)*24*3600e3;
  return (events||[]).filter(e=>validAddress(e?.tokenAddress)&&Date.parse(e?.at||'')>=cut);
}

function buildCycleUniverse({events=[],tokenState={},holderHistory={},marketHistory={},seeds=CYCLE_SEEDS,now=Date.now(),windowDays=DEFAULT_WINDOW_DAYS}={}){
  const days=Math.max(1,Number(windowDays)||DEFAULT_WINDOW_DAYS),cut=now-days*24*3600e3;
  const recent=recentCycleEvents(events,now,days);
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
  for(const e of recent)add(e.tokenAddress,{symbol:e.symbol,reason:'cycle-event-window'});

  // A tokenState row by itself is not durable Cycle evidence. Keeping every token ever
  // enriched made the universe monotonic and caused hundreds of zombie candidates to be
  // rescored forever. Histories remain eligible only while they contain evidence inside
  // the configured Cycle window; seeds and recent events remain the canonical discovery paths.
  for(const [address,rows] of Object.entries(holderHistory||{})){
    const latest=Array.isArray(rows)?rows.at(-1):null;
    if(recentAt(latest?.at,cut))add(address,{reason:'holder-history'});
  }
  for(const [address,rows] of Object.entries(marketHistory||{})){
    const latest=Array.isArray(rows)?rows.at(-1):null;
    if(recentAt(latest?.at,cut))add(address,{reason:'market-history'});
  }

  // tokenState is intentionally used only to enrich labels for candidates discovered above.
  for(const candidate of out.values()){
    const state=tokenState?.[candidate.tokenAddress]||{};
    if(!candidate.symbol&&state.tokenSymbol)candidate.symbol=state.tokenSymbol;
    if(!candidate.name&&state.tokenName)candidate.name=state.tokenName;
  }
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

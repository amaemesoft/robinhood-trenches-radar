'use strict';
// Post-decision observer. It receives copies and has no access to policy or execution.
const HORIZONS={ '5m':300000,'15m':900000,'1h':3600000,'6h':21600000,'24h':86400000 };
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const round=x=>Number(x.toFixed(4));
function register(decision){
  return {id:decision.id,setupId:decision.setupId,tokenAddress:decision.tokenAddress,chainId:4663,symbol:decision.symbol,at:decision.at,
    decision:decision.decision,referencePriceUsd:decision.marketPriceUsd,agents:structuredClone(decision.agents),
    predictedOutcome:decision.decision==='ENTRY'?'positive_return_with_defined_invalidation':'no_entry_until_gates_pass',
    observations:0,mfePct:null,maePct:null,returns:{},status:'PENDING',lastObservedAt:null,
    entryQuality:null,exitQuality:null,classification:'INSUFFICIENT_OBSERVATIONS'};
}
function observe(record,market,now){
  const r=structuredClone(record),at=Date.parse(market?.marketObservedAt||market?.observedAt||''),start=Date.parse(r.at);
  if(!positive(r.referencePriceUsd)||!positive(market?.priceUsd)||!Number.isFinite(at)||at<=start||at>now||now-at>900000||at<=Date.parse(r.lastObservedAt||r.at))return r;
  const elapsed=at-start;
  if(elapsed>86400000+900000){r.status='COMPLETE_WITH_GAPS';return r;}
  const ret=(market.priceUsd/r.referencePriceUsd-1)*100;
  r.observations++;r.lastObservedAt=new Date(at).toISOString();r.lastPriceUsd=market.priceUsd;
  r.mfePct=round(Math.max(r.mfePct??0,ret));r.maePct=round(Math.min(r.maePct??0,ret));
  for(const [label,ms] of Object.entries(HORIZONS))if(!r.returns[label]&&elapsed>=ms&&elapsed<=ms+900000)r.returns[label]={returnPct:round(ret),observedAt:r.lastObservedAt,delaySeconds:Math.round((elapsed-ms)/1000)};
  const outcome=r.returns['24h'];
  if(outcome){
    r.status='COMPLETE';
    r.classification=r.decision==='ENTRY'?(outcome.returnPct>0?'POSITIVE_ENTRY':'FALSE_POSITIVE'):
      r.decision==='BLOCK'?(outcome.returnPct>0?'BLOCKED_THEN_ROSE':'AVOIDED_LOSS'):'WAIT_OBSERVED';
    r.entryQuality=r.decision==='ENTRY'?{return24hPct:outcome.returnPct,adverseExcursionPct:r.maePct}:null;
  }
  return r;
}
function summarize(records){
  const agents={};let complete=0;
  for(const r of records){const out=r.returns?.['24h'];if(!out)continue;complete++;
    for(const [name,prediction] of Object.entries(r.agents||{})){
      if(['LEDGER','COMMANDER','AUDITOR'].includes(name))continue;
      const key=`${name}:${prediction.status}`,a=agents[key]||(agents[key]={agent:name,status:prediction.status,n:0,sumReturnPct:0,positive:0});
      a.n++;a.sumReturnPct+=out.returnPct;if(out.returnPct>0)a.positive++;
    }
  }
  return {mode:'OBSERVER_ONLY',canChangeGates:false,samples:records.length,completed24h:complete,
    evidence:complete<30?'INSUFFICIENT_SAMPLE':'OBSERVATIONAL_ASSOCIATION_ONLY',
    caveat:'Cohorts by setup/day; correlated observations are not independent trades. Association is not causal agent edge. MFE/MAE are sampled marks, not intrabar extremes.',
    agents:Object.values(agents).map(a=>({...a,meanReturn24hPct:round(a.sumReturnPct/a.n),positiveRatePct:round(a.positive/a.n*100)}))};
}
module.exports={register,observe,summarize,HORIZONS};

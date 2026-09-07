'use strict';
const Engine=require('./engine');
const {buildAnalogues}=require('./cycleAnalogues');

const DAY=86400e3;
const clamp=Engine.clamp;
const actorId=e=>e?.actorId||e?.wallet||e?.handle||null;
const actorFor=(actors,e)=>actors?.[actorId(e)]||{};
const isProvisionalMoney=actor=>actor?.kind==='money'&&actor?.attributionStatus==='provisional'&&Number(actor?.sampleSize||0)<3;
const recencyWeight=(at,now=Date.now())=>{
  const age=(now-Date.parse(at||''))/DAY;
  if(!Number.isFinite(age)||age<0)return 0.2;
  if(age<=3)return 1;
  if(age<=7)return 0.9;
  if(age<=14)return 0.76;
  if(age<=30)return 0.58;
  if(age<=60)return 0.38;
  return 0.22;
};

function weightedUnique(events=[],actors={},predicate=()=>true,now=Date.now()){
  const rows=new Map();
  for(const e of events){
    const id=actorId(e),actor=actorFor(actors,e);
    if(!id||!predicate(actor,e))continue;
    const weight=recencyWeight(e.at,now);
    const current=rows.get(id);
    if(!current||weight>current.weight)rows.set(id,{id,event:e,actor,weight});
  }
  return[...rows.values()];
}

function sourceFamily(source=''){
  const s=String(source||'').toLowerCase();
  if(s.includes('telegram'))return'telegram';
  if(s.includes('twitter')||s.includes('x-')||s.includes('fxtwitter')||s.includes('fxembed'))return'x';
  if(s.includes('alchemy')||s.includes('chain')||s.includes('blockscout'))return'onchain';
  return s?s.split(':')[0]:'unknown';
}

function cultureScore(events=[],actors={},now=Date.now()){
  const scouts=weightedUnique(events.filter(e=>e.action==='SCOUT'),actors,a=>a.kind==='social',now);
  const weightedBreadth=scouts.reduce((sum,row)=>sum+row.weight,0);
  const sources=new Set(scouts.map(row=>sourceFamily(row.event.source)).filter(s=>s!=='unknown'));
  const score=scouts.length?Math.round(clamp(25+Math.min(48,weightedBreadth*14)+Math.min(12,Math.max(0,sources.size-1)*6))):0;
  return{score,scouts:scouts.length,weightedBreadth:Number(weightedBreadth.toFixed(2)),sourceDiversity:sources.size,actorIds:scouts.map(r=>r.id)};
}

function moneyScore(events=[],actors={},holdings={},now=Date.now()){
  const positive=events.filter(e=>['BUY','ADD','REENTRY','CALL'].includes(e.action));
  const rows=weightedUnique(positive,actors,(a)=>a.kind==='money'&&!isProvisionalMoney(a),now);
  const eventIds=new Set(rows.map(r=>r.id));
  const holdingsUsable=['MEASURED','PARTIAL'].includes(holdings?.status)&&Number(holdings?.coverage||0)>=0.6;
  const currentIds=holdingsUsable?holdings.qualifiedActorIds||[]:[];
  const allIds=new Set([...eventIds,...currentIds]);
  const quality=[...allIds].map(id=>Number(actors?.[id]?.adaptiveScore??Engine.adaptiveActorScore(actors?.[id]||{}))).filter(Number.isFinite);
  const qualityAvg=quality.length?quality.reduce((a,b)=>a+b,0)/quality.length:0;
  const breadth=allIds.size;
  let score=0;
  if(breadth===1)score=38+0.22*qualityAvg;
  else if(breadth===2)score=58+0.22*qualityAvg;
  else if(breadth===3)score=72+0.18*qualityAvg;
  else if(breadth>=4)score=82+Math.min(15,(breadth-4)*3)+0.08*qualityAvg;
  score=Math.round(clamp(score));
  const provisionalObserved=new Set(weightedUnique(positive,actors,a=>isProvisionalMoney(a),now).map(r=>r.id));
  for(const id of holdings?.provisionalActorIds||[])provisionalObserved.add(id);
  return{
    score,breadth,eventActors:eventIds.size,currentQualifiedHolders:currentIds.length,
    actorIds:[...allIds],provisionalObserved:provisionalObserved.size,
    provisionalActorIds:[...provisionalObserved],holdingsCoverage:Number(holdings?.coverage||0)
  };
}

function marketFallback(execution={},currentMc=null){
  const exit=Engine.exitabilityScore(execution);
  const liq=Number(execution?.liquidityUsd||0),mc=Number(currentMc||0);
  let ratioScore=45;
  if(liq>0&&mc>0){
    const ratio=liq/mc;
    ratioScore=ratio>=0.08?95:ratio>=0.04?84:ratio>=0.02?72:ratio>=0.01?58:ratio>=0.005?44:28;
  }
  return Math.round(clamp(0.65*exit+0.35*ratioScore));
}

function evaluateCycleToken({events=[],actors={},safety={},execution={},token={},cycleMetrics={},candidateMeta={},now=Date.now()}={}){
  const safetyResult=Engine.safetyGate(safety);
  const exitabilityResult=Engine.exitabilityGate(execution);
  const currentMc=Number(token.marketCap||execution.currentMarketCap||0)||null;
  const positives=events.filter(e=>['BUY','ADD','REENTRY','CALL'].includes(e.action));
  const firstMc=positives.map(e=>Number(e.marketCap||0)).filter(Boolean).sort((a,b)=>a-b)[0]||null;
  const culture=cultureScore(events,actors,now);
  const money=moneyScore(events,actors,cycleMetrics.holdings||{},now);
  const attention=Engine.eventVelocity(events,now);

  const holderMetric=cycleMetrics.holders||{};
  const organicMetric=cycleMetrics.organic||{};
  const resilienceMetric=cycleMetrics.resilience||{};
  const marketMetric=cycleMetrics.marketStructure||{};
  const holdersMeasured=holderMetric.status==='MEASURED'&&Number.isFinite(Number(holderMetric.score));
  const organicMeasured=organicMetric.status==='MEASURED'&&Number.isFinite(Number(organicMetric.score));
  const resilienceMeasured=resilienceMetric.status==='MEASURED'&&Number.isFinite(Number(resilienceMetric.score));
  const marketMeasured=marketMetric.status==='MEASURED'&&Number.isFinite(Number(marketMetric.score));

  let holders=holdersMeasured?Number(holderMetric.score):42;
  if(organicMeasured)holders=0.68*holders+0.32*Number(organicMetric.score);
  holders=Math.round(clamp(holders));
  const resilience=Math.round(clamp(resilienceMeasured?Number(resilienceMetric.score):resilienceMetric.status==='NOT_TESTED'?50:resilienceMetric.status==='TESTING'?44:38));
  const market=Math.round(clamp(marketMeasured?Number(marketMetric.score):marketFallback(execution,currentMc)));
  const safetyMap={PASS:92,CAUTION:65,UNKNOWN:35,FAIL:0};
  const safetyScore=safetyMap[safetyResult.status]??35;

  let momentum=52;
  if(currentMc&&firstMc){
    const multiple=currentMc/firstMc;
    if(multiple<=1.3)momentum=58;
    else if(multiple<=2.5)momentum=76;
    else if(multiple<=5)momentum=88;
    else if(multiple<=10)momentum=78;
    else momentum=62;
    if(multiple>=5&&organicMeasured&&Number(organicMetric.score)<45)momentum=Math.min(momentum,48);
  }

  const raw=0.20*culture.score+0.20*holders+0.15*money.score+0.15*resilience+0.10*market+0.08*attention.score+0.07*safetyScore+0.05*momentum;
  let score=Math.round(clamp(raw));
  const holderReady=holdersMeasured&&Number(holderMetric.confidence||0)>=0.55;
  const resilienceReady=resilienceMeasured&&Number(resilienceMetric.confidence||0)>=0.50;
  const fullDataReady=holderReady&&resilienceReady;
  if(!fullDataReady)score=Math.min(84,score);

  let stage=Engine.cycleStage(score);
  const chainIconGate=fullDataReady&&safetyResult.status!=='FAIL'&&culture.score>=65&&holders>=55&&resilience>=55&&market>=50;
  if(['CHAIN_ICON','CYCLE_MEME'].includes(stage)&&!chainIconGate)stage='CULTURAL_CONTENDER';
  const cycleMemeGate=chainIconGate&&Number(holderMetric.confidence||0)>=0.75&&Number(resilienceMetric.confidence||0)>=0.70&&culture.score>=78&&holders>=70&&resilience>=68;
  if(stage==='CYCLE_MEME'&&!cycleMemeGate)stage='CHAIN_ICON';

  const firstEvidence=[...events.map(e=>Date.parse(e.at||'')),...(candidateMeta.firstSeenAt?[Date.parse(candidateMeta.firstSeenAt)]:[])].filter(Number.isFinite).sort((a,b)=>a-b)[0];
  const ageDays=firstEvidence?Math.max(0,(now-firstEvidence)/DAY):null;
  const analogues=buildAnalogues({culture:culture.score,holders,resilience,attention:attention.score,market,organic:organicMeasured?Number(organicMetric.score):null,ageDays,resilienceStatus:resilienceMetric.status||'UNKNOWN'});

  const reasons=[];
  const risks=[];
  if(money.currentQualifiedHolders>=2)reasons.push(`${money.currentQualifiedHolders} established money wallets currently hold`);
  else if(money.currentQualifiedHolders===1)reasons.push('1 established money wallet currently holds');
  if(money.eventActors>=2)reasons.push(`${money.eventActors} independent established money actors in cycle window`);
  if(culture.scouts>=2)reasons.push(`${culture.scouts} independent social scouts across cycle window`);
  if(culture.sourceDiversity>=2)reasons.push(`social propagation spans ${culture.sourceDiversity} source families`);
  if(holdersMeasured&&holders>=70)reasons.push('holder adoption/retention is strengthening');
  if(organicMeasured&&Number(organicMetric.score)>=80)reasons.push('holders are expanding faster than price');
  if(resilienceMeasured&&resilience>=70)reasons.push('material drawdown was survived with recovery');
  if(money.provisionalObserved)risks.push(`${money.provisionalObserved} provisional money wallets observed but not scored`);
  if(safetyResult.status==='UNKNOWN')risks.push('critical safety still unknown');
  if(safetyResult.status==='FAIL')risks.push('critical safety failed');
  if(exitabilityResult.status==='UNKNOWN')risks.push('exitability still unknown');
  if(exitabilityResult.status==='FAIL')risks.push('exitability failed');
  if(organicMeasured&&Number(organicMetric.score)<40)risks.push('price is outrunning holder absorption');
  if(holdersMeasured&&holders<45)risks.push('holder growth/distribution is weakening');
  if(resilienceMetric.status==='TESTING')risks.push('post-drawdown resilience is still being tested');
  if(resilienceMeasured&&resilience<45)risks.push('post-drawdown structure remains weak');

  const missingData=[];
  if(!holderReady)missingData.push('holder_growth');
  if(!resilienceReady)missingData.push('long_horizon_resilience');
  if(!organicMeasured)missingData.push('holder_vs_price_absorption');
  if(!marketMeasured)missingData.push('full_market_structure');
  if(!['MEASURED','PARTIAL'].includes(cycleMetrics.holdings?.status))missingData.push('current_money_holdings');

  return{
    score,stage,version:3,
    components:{culture:culture.score,holders,money:money.score,resilience,market,velocity:attention.score,safety:safetyScore,momentum,organic:organicMeasured?Number(organicMetric.score):null},
    reasons:reasons.slice(0,6),risks:risks.slice(0,6),missingData,
    evidence:{
      socialScouts:culture.scouts,socialSourceDiversity:culture.sourceDiversity,moneyActors:money.breadth,moneyEventActors:money.eventActors,
      currentQualifiedMoneyHolders:money.currentQualifiedHolders,provisionalMoneyObserved:money.provisionalObserved,currentHolders:holderMetric.currentHolders??null,top10Pct:holderMetric.top10Pct??null,
      holderConfidence:Number(holderMetric.confidence||0),holderGrowth24h:holderMetric.changes?.['24h']??null,holderGrowth3d:holderMetric.changes?.['72h']??null,holderGrowth7d:holderMetric.changes?.['168h']??null,
      organicStatus:organicMetric.status||'UNKNOWN',holderVsPriceScore:organicMeasured?Number(organicMetric.score):null,
      resilienceStatus:resilienceMetric.status||'UNKNOWN',resilienceConfidence:Number(resilienceMetric.confidence||0),maxDrawdownPct:resilienceMetric.maxDrawdownPct??null,peakRecoveryPct:resilienceMetric.peakRecoveryPct??null,
      marketStructureStatus:marketMetric.status||'UNKNOWN',liquidityToMcap:marketMetric.liquidityToMcap??null,volumeToMcap:marketMetric.volumeToMcap??null,
      recentEvents6h:attention.recentEvents,priorEvents18h:attention.priorEvents,candidateAgeDays:ageDays==null?null:Number(ageDays.toFixed(1))
    },
    analogues,
    gates:{holderReady,resilienceReady,chainIconGate,cycleMemeGate},
    attentionDirection:attention.direction,
    safety:safetyResult,exitability:exitabilityResult
  };
}

module.exports={evaluateCycleToken,cultureScore,moneyScore,weightedUnique,recencyWeight,isProvisionalMoney,sourceFamily,marketFallback};

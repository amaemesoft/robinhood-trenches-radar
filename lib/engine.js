'use strict';

const clamp = (n, min=0, max=100) => Math.max(min, Math.min(max, n));
const hours = ms => ms / 3600000;

function sampleConfidence(n=0){
  n = Math.max(0, Number(n)||0);
  return n / (n + 8);
}

function activityFactor(lastEventAt, now=Date.now()){
  if(!lastEventAt) return 0.55;
  const ageDays = (now - new Date(lastEventAt).getTime()) / 86400000;
  if(ageDays <= 14) return 1;
  if(ageDays <= 30) return 0.8;
  if(ageDays <= 60) return 0.55;
  return 0.35;
}

function division(sampleSize=0, kind='social'){
  const n = Number(sampleSize)||0;
  if(kind==='money'){
    if(n >= 10) return 'CORE';
    if(n >= 3) return 'TESTED';
    return 'PROVISIONAL';
  }
  if(n >= 10) return 'CORE';
  if(n >= 5) return 'TESTED';
  return 'PROVISIONAL';
}

function adaptiveActorScore(actor, now=Date.now()){
  const n = Number(actor.sampleSize || actor.closedTrades || actor.calls || 0);
  const conf = sampleConfidence(n);
  const lifetime = Number(actor.lifetimeEdge ?? actor.edge ?? 50);
  const recent = Number(actor.recentEdge ?? lifetime);
  const blended = 0.6*recent + 0.4*lifetime;
  const activity = activityFactor(actor.lastEventAt, now);
  const copy = Number(actor.copyability ?? 70);
  const identity = ({verified:1,strong:0.9,attributed:0.72,uncertain:0.5,unresolved:0.35}[actor.identityConfidence] ?? 0.6);
  const raw = (0.72*blended + 0.28*copy) * (0.55 + 0.45*conf) * activity * identity;
  return Math.round(clamp(raw));
}

function actorRoleWeight(actor, event){
  const scores = actor.roleScores || {};
  const type = event?.signalRole || event?.role || actor.role || 'confirmation';
  const map = {
    discovery: scores.discovery,
    confirmation: scores.confirmation,
    execution: scores.execution,
    reentry: scores.reentry,
    narrative: scores.narrative
  };
  const measuredDiscovery=actor.kind==='social'&&type==='discovery'?actor.measuredDiscoveryScore:null;
  return Number(measuredDiscovery ?? map[type] ?? actor.adaptiveScore ?? actor.score ?? 50);
}

function independentActors(events){
  const rows = events.map(e=>({e,actorId:e.actorId||e.wallet||e.handle})).filter(x=>x.actorId);
  const parent = new Map(rows.map(({actorId})=>[actorId,actorId]));
  const find = id=>{
    let root=id;
    while(parent.get(root)!==root)root=parent.get(root);
    while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,root);id=next;}
    return root;
  };
  const union = (a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(b,a);};
  const clusters = new Map();
  for(const {e,actorId} of rows){
    for(const cluster of [e.independenceCluster,e.txHash&&`tx:${e.txHash}`].filter(Boolean)){
      if(clusters.has(cluster))union(actorId,clusters.get(cluster));
      else clusters.set(cluster,actorId);
    }
  }
  const strongest = new Map();
  for(const {e,actorId} of rows){
    const root=find(actorId),old=strongest.get(root);
    if(!old || (e.eventStrength||0)>(old.eventStrength||0))strongest.set(root,e);
  }
  return [...strongest.values()];
}

function safetyGate(safety={}){
  const critical = ['tokenControl','upgradeAuthority','canonicalLp','sellRestriction'];
  for(const k of critical){
    if(safety[k] === 'FAIL') return {status:'FAIL', reason:k};
  }
  const unknown = critical.filter(k=>!safety[k] || safety[k] === 'UNKNOWN');
  if(unknown.length) return {status:'UNKNOWN', reason:unknown.join(',')};
  const caution = Object.entries(safety).filter(([,v])=>v==='CAUTION').map(([k])=>k);
  if(caution.length) return {status:'CAUTION', reason:caution.join(',')};
  return {status:'PASS', reason:null};
}

function exitabilityScore(execution={}){
  if(execution.exitabilityScore!=null) return clamp(Number(execution.exitabilityScore));
  let s = 45;
  const liqKnown = execution.liquidityUsd != null;
  const liq = Number(execution.liquidityUsd||0);
  if(liqKnown){
    if(liq >= 500000) s += 25;
    else if(liq >= 150000) s += 18;
    else if(liq >= 50000) s += 8;
    else if(liq > 0 && liq < 25000) s -= 20;
  } else s -= 5;

  if(execution.sellImpactPct != null){
    const impact = Number(execution.sellImpactPct);
    if(impact <= 2) s += 20;
    else if(impact <= 5) s += 12;
    else if(impact <= 10) s += 2;
    else if(impact <= 20) s -= 15;
    else if(impact > 20) s -= 30;
  } else {
    s -= 5;
  }
  return Math.round(clamp(s));
}

function exitabilityGate(execution={}){
  if(execution.exitQuoteStatus==='FAIL') return {status:'FAIL',reason:'quote_failed'};
  if(execution.sellImpactPct==null) return {status:'UNKNOWN',reason:'sell_quote_unavailable'};
  const impact=Number(execution.sellImpactPct);
  if(!Number.isFinite(impact)) return {status:'UNKNOWN',reason:'invalid_sell_quote'};
  if(impact>20) return {status:'FAIL',reason:'sell_impact_gt_20pct'};
  if(impact>10) return {status:'CAUTION',reason:'sell_impact_gt_10pct'};
  return {status:'PASS',reason:null};
}

function timingScore(signal={}){
  const current = Number(signal.currentMarketCap||0);
  const first = Number(signal.firstRelevantMarketCap||0);
  if(!current || !first) return 50;
  const multiple = current/first;
  if(multiple <= 1.15) return 95;
  if(multiple <= 1.4) return 88;
  if(multiple <= 1.7) return 78;
  if(multiple <= 2.0) return 67;
  if(multiple <= 3.0) return 42;
  return 18;
}

function cycleStage(score=0){
  const n=Number(score)||0;
  if(n>=94)return'CYCLE_MEME';
  if(n>=85)return'CHAIN_ICON';
  if(n>=70)return'CULTURAL_CONTENDER';
  if(n>=55)return'BREAKOUT';
  if(n>=40)return'EMERGING';
  return'DISCOVERED';
}

function eventVelocity(events=[],now=Date.now()){
  const recentCut=now-6*3600e3,dayCut=now-24*3600e3;
  const timed=events.map(e=>({...e,_ms:Date.parse(e.at||'')})).filter(e=>Number.isFinite(e._ms)&&e._ms>=dayCut);
  const recent=timed.filter(e=>e._ms>=recentCut);
  const older=timed.filter(e=>e._ms<recentCut);
  const recentActors=new Set(recent.map(e=>e.actorId||e.wallet||e.handle).filter(Boolean)).size;
  const olderActors=new Set(older.map(e=>e.actorId||e.wallet||e.handle).filter(Boolean)).size;
  const recentRate=recent.length/6;
  const olderRate=older.length/18;
  let score=50;
  if(!timed.length)score=20;
  else if(recent.length&&!older.length)score=Math.min(92,68+recentActors*6);
  else{
    const ratio=olderRate>0?recentRate/olderRate:recentRate>0?2:0;
    if(ratio>=3)score=95;
    else if(ratio>=2)score=86;
    else if(ratio>=1.3)score=76;
    else if(ratio>=0.8)score=62;
    else if(ratio>=0.5)score=47;
    else score=32;
    if(recentActors>olderActors)score+=Math.min(8,(recentActors-olderActors)*3);
  }
  score=Math.round(clamp(score));
  return{score,recentEvents:recent.length,priorEvents:older.length,recentActors,priorActors:olderActors,direction:score>=82?'RISING_FAST':score>=68?'RISING':score>=48?'STABLE':'COOLING'};
}

function cyclePotentialScore({events=[],actorRows=[],scoutRows=[],independent=[],scouts=[],exits=[],distribution=false,safetyResult={},exitabilityResult={},exitability=0,currentMc=null,firstMc=null}={}){
  const moneyScores=actorRows.map(row=>Number(row.score||0)).filter(Number.isFinite);
  const moneyAvg=moneyScores.length?moneyScores.reduce((a,b)=>a+b,0)/moneyScores.length:0;
  const money=Math.round(clamp(independent.length?30+Math.min(42,(independent.length-1)*18)+0.28*moneyAvg:0));

  const discoveryScores=scoutRows.map(row=>Number(row.score||0)).filter(Number.isFinite);
  const discoveryAvg=discoveryScores.length?discoveryScores.reduce((a,b)=>a+b,0)/discoveryScores.length:0;
  const culture=Math.round(clamp(scouts.length?24+Math.min(34,(scouts.length-1)*12)+0.42*discoveryAvg:0));

  const velocity=eventVelocity(events);
  const liq=Number(events.find(e=>Number(e.liquidityUsd)>0)?.liquidityUsd||0);
  const mc=Number(currentMc||0);
  let liqScore=45;
  if(liq>0&&mc>0){
    const ratio=liq/mc;
    if(ratio>=0.08)liqScore=95;
    else if(ratio>=0.04)liqScore=82;
    else if(ratio>=0.02)liqScore=70;
    else if(ratio>=0.01)liqScore=58;
    else if(ratio>=0.005)liqScore=45;
    else liqScore=28;
  }else if(liq>0)liqScore=65;
  const market=Math.round(clamp(0.65*Number(exitability||0)+0.35*liqScore));

  const safetyMap={PASS:95,CAUTION:68,UNKNOWN:35,FAIL:0};
  const exitMap={PASS:90,CAUTION:65,UNKNOWN:35,FAIL:0};
  const safety=Math.round(clamp(0.65*(safetyMap[safetyResult.status]??35)+0.35*(exitMap[exitabilityResult.status]??35)));

  let survival=50;
  if(distribution)survival=25;
  else if(exits.length){
    const lastExit=Math.max(...exits.map(e=>Date.parse(e.at||'')).filter(Number.isFinite),0);
    const postExit=independent.some(e=>Date.parse(e.at||'')>lastExit);
    survival=postExit?78:42;
  }else if(independent.length>=2&&scouts.length>=2)survival=65;

  let momentum=55;
  if(currentMc&&firstMc){
    const multiple=currentMc/firstMc;
    if(multiple<=1.2)momentum=58;
    else if(multiple<=2)momentum=72;
    else if(multiple<=4)momentum=86;
    else if(multiple<=8)momentum=90;
    else momentum=76;
  }

  const raw=0.25*money+0.22*culture+0.15*velocity.score+0.14*market+0.10*safety+0.08*survival+0.06*momentum;
  // V1 intentionally cannot promote a token to CHAIN_ICON/CYCLE_MEME until holder-growth
  // and long-horizon post-crash resilience are wired into the data layer.
  const score=Math.min(84,Math.round(clamp(raw)));
  const reasons=[];
  const risks=[];
  if(independent.length>=2)reasons.push(`${independent.length} independent money actors`);
  else if(independent.length===1)reasons.push('first money actor confirmed');
  if(scouts.length>=2)reasons.push(`${scouts.length} independent social scouts`);
  if(velocity.score>=68)reasons.push(`attention ${velocity.direction.toLowerCase().replace('_',' ')}`);
  if(exitabilityResult.status==='PASS')reasons.push('exitability verified');
  if(safetyResult.status==='PASS')reasons.push('critical safety gates pass');
  if(distribution)risks.push('independent distribution detected');
  if(safetyResult.status==='UNKNOWN')risks.push('critical safety still unknown');
  if(safetyResult.status==='FAIL')risks.push('critical safety failed');
  if(exitabilityResult.status==='UNKNOWN')risks.push('exitability still unknown');
  if(exitabilityResult.status==='FAIL')risks.push('exitability failed');
  if(independent.length<2)risks.push('money breadth not proven');
  if(scouts.length<2)risks.push('cultural spread not proven');
  const missingData=['holder_growth','long_horizon_resilience'];
  return{
    score,stage:cycleStage(score),velocity:velocity.score,direction:velocity.direction,
    components:{money,culture,velocity:velocity.score,market,safety,survival,momentum},
    reasons:reasons.slice(0,4),risks:risks.slice(0,4),missingData,
    evidence:{moneyActors:independent.length,socialScouts:scouts.length,recentEvents6h:velocity.recentEvents,priorEvents18h:velocity.priorEvents},
    version:1
  };
}

function evaluateToken({events=[], actors={}, safety={}, execution={}, token={}}){
  // Receive-only transfers and social SCOUTs are observations, not economic entry evidence.
  const positives = events.filter(e=>['CALL','BUY','ADD','REENTRY'].includes(e.action));
  const scouts = independentActors(events.filter(e=>e.action==='SCOUT'));
  const exits = events.filter(e=>['TRIM','SELL','EXIT'].includes(e.action));
  const independent = independentActors(positives);
  const actorRows = independent.map(e=>{
    const a = actors[e.actorId] || actors[e.wallet] || actors[e.handle] || {};
    return {event:e, actor:a, score:actorRoleWeight(a,e), adaptiveScore:a.adaptiveScore ?? adaptiveActorScore(a)};
  });
  const scoutRows = scouts.map(e=>{
    const a = actors[e.actorId] || actors[e.wallet] || actors[e.handle] || {};
    return {event:e, actor:a, score:actorRoleWeight(a,{...e,signalRole:'discovery'})};
  });

  let alpha = 0;
  if(actorRows.length){
    const top = actorRows.sort((a,b)=>b.score-a.score).slice(0,4);
    alpha = top.reduce((s,x,i)=>s + x.score*[0.34,0.27,0.22,0.17][i],0);
    alpha += Math.min(12, Math.max(0, independent.length-1)*4);
  }
  alpha = Math.round(clamp(alpha));

  // Social discovery is tracked separately from Alpha. It can raise attention priority,
  // but never substitutes verified economic entry evidence or the second-money-actor gate.
  let discovery = 0;
  if(scoutRows.length){
    const top = scoutRows.sort((a,b)=>b.score-a.score).slice(0,3);
    discovery = top.reduce((s,x,i)=>s + x.score*[0.52,0.30,0.18][i],0);
    discovery += Math.min(10, Math.max(0, scouts.length-1)*3);
  }
  discovery = Math.round(clamp(discovery));

  const firstMc = positives.map(e=>Number(e.marketCap||0)).filter(Boolean).sort((a,b)=>a-b)[0] || null;
  const currentMc = Number(token.marketCap || execution.currentMarketCap || 0) || null;
  const timing = timingScore({currentMarketCap:currentMc, firstRelevantMarketCap:firstMc});
  const exitability = exitabilityScore(execution);
  const exitabilityResult = exitabilityGate(execution);
  const safetyResult = safetyGate(safety);

  const exitActors = independentActors(exits);
  const distribution = exitActors.length >= 2 || exits.some(e=>e.action==='EXIT' && Number(e.actorWeight||0)>=80);
  const chaseMultiple = currentMc && firstMc ? currentMc/firstMc : null;
  const doNotChase = chaseMultiple != null && chaseMultiple > Number(execution.maxChaseMultiple||2);

  const score = Math.round(clamp(0.50*alpha + 0.25*timing + 0.25*exitability));
  const attentionBase = positives.length
    ? 0.68*score + 0.22*discovery + 0.10*timing
    : 0.72*discovery + 0.18*timing + 0.10*exitability;
  const priorityScore = Math.round(clamp(attentionBase));
  let state = 'IGNORE';
  let reason = 'insufficient_signal';

  if(distribution) { state='DISTRIBUTION'; reason='independent_sellers'; }
  else if(!positives.length && scouts.length) { state='WATCH'; reason='social_scout_only'; }
  else if(!positives.length) { state='IGNORE'; reason='no_entry_evidence'; }
  else if(safetyResult.status==='FAIL') { state='BLOCKED'; reason=`safety:${safetyResult.reason}`; }
  else if(safetyResult.status==='UNKNOWN') { state='WATCH'; reason='critical_unknown'; }
  else if(independent.length<2) { state='WATCH'; reason='needs_second_independent_actor'; }
  else if(exitabilityResult.status==='FAIL') { state='BLOCKED'; reason=`exitability:${exitabilityResult.reason}`; }
  else if(exitabilityResult.status==='UNKNOWN') { state='WATCH'; reason='exitability_unknown'; }
  else if(doNotChase && independent.length>=2 && alpha>=55) { state='DO_NOT_CHASE'; reason='entry_window_missed'; }
  else if(score>=88 && safetyResult.status==='PASS' && exitabilityResult.status==='PASS') { state='HIGH_CONFLUENCE'; reason='high_confluence'; }
  else if(score>=78 && ['PASS','CAUTION'].includes(safetyResult.status) && ['PASS','CAUTION'].includes(exitabilityResult.status)) { state='ENTRY_CANDIDATE'; reason='alpha_safety_execution_align'; }
  else if(score>=65) { state='WATCH'; reason='developing'; }

  const cycle=cyclePotentialScore({events,actorRows,scoutRows,independent,scouts,exits,distribution,safetyResult,exitabilityResult,exitability,currentMc,firstMc});

  return {
    state, reason, score, priorityScore, alpha, discovery, timing, exitability,
    safety:safetyResult, exitabilityGate:exitabilityResult,
    independentActors:independent.length,
    actorIds:independent.map(e=>e.actorId||e.wallet||e.handle),
    scoutActors:scouts.length,
    scoutActorIds:scouts.map(e=>e.actorId||e.wallet||e.handle),
    distributionActors:exitActors.length,
    firstRelevantMarketCap:firstMc,
    currentMarketCap:currentMc,
    chaseMultiple:chaseMultiple ? Number(chaseMultiple.toFixed(2)) : null,
    cyclePotential:cycle.score,cycleStage:cycle.stage,cycleVelocity:cycle.velocity,cycleDirection:cycle.direction,
    cycleComponents:cycle.components,cycleReasons:cycle.reasons,cycleRisks:cycle.risks,cycleMissingData:cycle.missingData,cycleEvidence:cycle.evidence,cycleVersion:cycle.version
  };
}

module.exports = {sampleConfidence,activityFactor,division,adaptiveActorScore,independentActors,safetyGate,exitabilityScore,exitabilityGate,timingScore,cycleStage,eventVelocity,cyclePotentialScore,evaluateToken,clamp,hours};

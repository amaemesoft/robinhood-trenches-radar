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
  return Number(map[type] ?? actor.adaptiveScore ?? actor.score ?? 50);
}

function independentActors(events){
  const map = new Map();
  for(const e of events){
    const actorId = e.actorId || e.wallet || e.handle;
    if(!actorId) continue;
    const cluster = e.independenceCluster || actorId;
    const key = `${cluster}:${actorId}`;
    if(!map.has(key)) map.set(key, e);
    else {
      const old = map.get(key);
      if((e.eventStrength||0) > (old.eventStrength||0)) map.set(key,e);
    }
  }
  const clusters = new Map();
  for(const e of map.values()){
    const cluster = e.independenceCluster || e.actorId || e.wallet || e.handle;
    const old = clusters.get(cluster);
    if(!old || (e.eventStrength||0) > (old.eventStrength||0)) clusters.set(cluster,e);
  }
  return [...clusters.values()];
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
  let s = 50;
  const liq = Number(execution.liquidityUsd||0);
  if(liq >= 500000) s += 25;
  else if(liq >= 150000) s += 18;
  else if(liq >= 50000) s += 8;
  else if(liq > 0 && liq < 25000) s -= 20;
  const impact = Number(execution.sellImpactPct ?? 0);
  if(impact <= 2) s += 20;
  else if(impact <= 5) s += 12;
  else if(impact <= 10) s += 2;
  else if(impact <= 20) s -= 15;
  else if(impact > 20) s -= 30;
  return Math.round(clamp(s));
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

function evaluateToken({events=[], actors={}, safety={}, execution={}, token={}}){
  const positives = events.filter(e=>['CALL','BUY','ADD','REENTRY','ACQUIRE'].includes(e.action));
  const exits = events.filter(e=>['TRIM','SELL','EXIT'].includes(e.action));
  const independent = independentActors(positives);
  const actorRows = independent.map(e=>{
    const a = actors[e.actorId] || actors[e.wallet] || actors[e.handle] || {};
    return {event:e, actor:a, score:actorRoleWeight(a,e), adaptiveScore:a.adaptiveScore ?? adaptiveActorScore(a)};
  });

  let alpha = 0;
  if(actorRows.length){
    const top = actorRows.sort((a,b)=>b.score-a.score).slice(0,4);
    alpha = top.reduce((s,x,i)=>s + x.score*[0.34,0.27,0.22,0.17][i],0);
    alpha += Math.min(12, Math.max(0, independent.length-1)*4);
  }
  alpha = Math.round(clamp(alpha));

  const firstMc = positives.map(e=>Number(e.marketCap||0)).filter(Boolean).sort((a,b)=>a-b)[0] || null;
  const currentMc = Number(token.marketCap || execution.currentMarketCap || 0) || null;
  const timing = timingScore({currentMarketCap:currentMc, firstRelevantMarketCap:firstMc});
  const exitability = exitabilityScore(execution);
  const safetyResult = safetyGate(safety);

  const exitActors = independentActors(exits);
  const distribution = exitActors.length >= 2 || exits.some(e=>e.action==='EXIT' && Number(e.actorWeight||0)>=80);
  const chaseMultiple = currentMc && firstMc ? currentMc/firstMc : null;
  const doNotChase = chaseMultiple != null && chaseMultiple > Number(execution.maxChaseMultiple||2);

  let score = Math.round(clamp(0.50*alpha + 0.25*timing + 0.25*exitability));
  let state = 'IGNORE';
  let reason = 'insufficient_signal';

  if(safetyResult.status==='FAIL') { state='BLOCKED'; reason=`safety:${safetyResult.reason}`; }
  else if(distribution) { state='DISTRIBUTION'; reason='independent_sellers'; }
  else if(doNotChase && independent.length>=2 && alpha>=55) { state='DO_NOT_CHASE'; reason='entry_window_missed'; }
  else if(safetyResult.status==='UNKNOWN') { state='WATCH'; reason='critical_unknown'; }
  else if(independent.length<2) { state='WATCH'; reason='needs_second_independent_actor'; }
  else if(score>=88 && safetyResult.status==='PASS') { state='HIGH_CONFLUENCE'; reason='high_confluence'; }
  else if(score>=78 && ['PASS','CAUTION'].includes(safetyResult.status)) { state='ENTRY_CANDIDATE'; reason='alpha_safety_execution_align'; }
  else if(score>=65) { state='WATCH'; reason='developing'; }

  return {
    state, reason, score, alpha, timing, exitability,
    safety:safetyResult,
    independentActors:independent.length,
    actorIds:independent.map(e=>e.actorId||e.wallet||e.handle),
    distributionActors:exitActors.length,
    firstRelevantMarketCap:firstMc,
    currentMarketCap:currentMc,
    chaseMultiple:chaseMultiple ? Number(chaseMultiple.toFixed(2)) : null
  };
}

module.exports = {sampleConfidence,activityFactor,division,adaptiveActorScore,independentActors,safetyGate,exitabilityScore,timingScore,evaluateToken,clamp,hours};

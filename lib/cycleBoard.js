'use strict';
const TokenIdentity=require('./tokenIdentity');
const CycleEngine=require('./cycleEngine');
const Universe=require('./cycleUniverse');

const lower=v=>String(v||'').toLowerCase();
const ms=v=>Date.parse(v||'');

function earliest(values=[]){const rows=values.map(ms).filter(Number.isFinite);return rows.length?new Date(Math.min(...rows)).toISOString():null;}
function latest(values=[]){const rows=values.map(ms).filter(Number.isFinite);return rows.length?new Date(Math.max(...rows)).toISOString():null;}

function buildCycleBoard({db,actors,cycleRuntime,tacticalSignals=[],now=Date.now(),recordScores=false,windowDays=Universe.DEFAULT_WINDOW_DAYS}={}){
  const universe=Universe.buildCycleUniverse({events:db?.events||[],tokenState:db?.tokenState||{},holderHistory:db?.holderHistory||{},marketHistory:db?.marketHistory||{},now,windowDays});
  const groups=Universe.groupCycleEvents(db?.events||[],now,windowDays);
  const tactical=new Map((tacticalSignals||[]).map(row=>[lower(row.tokenAddress),row]));
  const out=[];

  for(const candidate of universe){
    const address=lower(candidate.tokenAddress),events=groups.get(address)||[];
    const st=db?.tokenState?.[address]||{};
    const marketHistory=db?.marketHistory?.[address]||[];
    const holderHistory=db?.holderHistory?.[address]||[];
    const holdings=db?.moneyHoldingsStatus?.[address]||{};
    const firstSeenAt=earliest([...events.map(e=>e.at),marketHistory[0]?.at,holderHistory[0]?.at,st.observedAt]);
    const cycleMetrics=cycleRuntime.metrics(db,address);
    const result=CycleEngine.evaluateCycleToken({
      events,actors,safety:st.safety||{},execution:{...(st.execution||{}),currentMarketCap:st.marketCap||null},
      token:{marketCap:st.marketCap||null},cycleMetrics,candidateMeta:{firstSeenAt},now
    });
    if(recordScores)cycleRuntime.recordScore(db,address,result.score,result.stage,new Date(now).toISOString());
    const scoreVelocity=cycleRuntime.scoreVelocity(db,address,now);
    const tacticalRow=tactical.get(address)||{state:'NO_RECENT_SIGNAL',reason:'no_recent_tactical_signal',score:0,priorityScore:0,lastSeen:null};
    const ticker=st.tokenSymbol||candidate.symbol||events.at(-1)?.symbol||null;
    const name=st.tokenName||candidate.name||null;
    const lastEvidenceAt=latest([...events.map(e=>e.at),marketHistory.at(-1)?.at,holderHistory.at(-1)?.at,holdings.observedAt,st.observedAt]);
    const evidenceAgeDays=lastEvidenceAt?Math.max(0,(now-ms(lastEvidenceAt))/86400e3):null;
    const lifecycle=evidenceAgeDays==null?'RESEARCH':evidenceAgeDays<=3?'ACTIVE':evidenceAgeDays<=14?'WARM':evidenceAgeDays<=30?'COOLING':evidenceAgeDays<=90?'DORMANT':'RESEARCH';
    const pinned=candidate.reasons.includes('known-cycle-candidate');
    out.push({
      tokenAddress:address,name,ticker,symbol:TokenIdentity.displayLabel(name,ticker,address),contractExists:st.contractExists??null,
      cyclePinned:pinned,cycleUniverseReasons:candidate.reasons,cycleLifecycle:lifecycle,cycleFirstSeenAt:firstSeenAt,cycleLastEvidenceAt:lastEvidenceAt,
      cyclePotential:result.score,cycleRawPotential:result.rawPotential,cycleCoverage:result.coverage,cycleConfidence:result.confidence,
      cycleStage:result.stage,cycleVersion:result.version,cycleComponents:result.components,
      cycleReasons:result.reasons,cycleRisks:result.risks,cycleMissingData:result.missingData,cycleEvidence:result.evidence,cycleAnalogues:result.analogues,cycleGates:result.gates,
      cycleTrajectory:cycleMetrics.trajectory||null,
      cycleDirection:scoreVelocity.direction,cycleVelocity:Number.isFinite(scoreVelocity.delta24h)?scoreVelocity.delta24h:Number.isFinite(scoreVelocity.delta6h)?scoreVelocity.delta6h:0,
      cycleDelta6h:scoreVelocity.delta6h,cycleDelta24h:scoreVelocity.delta24h,cycleDelta3d:scoreVelocity.delta3d,cycleVelocityStatus:scoreVelocity.status,
      attentionDirection:result.attentionDirection,
      state:tacticalRow.state,reason:tacticalRow.reason,score:tacticalRow.score||0,priorityScore:tacticalRow.priorityScore||0,lastSeen:tacticalRow.lastSeen||null,
      liquidityUsd:st.execution?.liquidityUsd??null,priceUsd:st.priceUsd??null,marketCap:st.marketCap??null,
      sellImpactPct:st.execution?.sellImpactPct??null,exitabilityTargetUsd:st.execution?.exitabilityTargetUsd??null,
      safety:result.safety,exitabilityGate:result.exitability
    });
  }
  return out.sort((a,b)=>Number(b.cyclePotential||0)-Number(a.cyclePotential||0)||Number(b.cycleConfidence||0)-Number(a.cycleConfidence||0)||Number(b.cycleDelta24h||0)-Number(a.cycleDelta24h||0)||Number(b.cyclePinned)-Number(a.cyclePinned));
}

module.exports={buildCycleBoard,earliest,latest};

'use strict';

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const HOUR=3600e3;

function normalizeHistory(history=[]){
  return (history||[])
    .map(row=>({
      at:row?.at,
      ms:Date.parse(row?.at||''),
      priceUsd:Number(row?.priceUsd),
      marketCap:row?.marketCap==null?null:Number(row.marketCap),
      liquidityUsd:row?.liquidityUsd==null?null:Number(row.liquidityUsd)
    }))
    .filter(row=>Number.isFinite(row.ms)&&Number.isFinite(row.priceUsd)&&row.priceUsd>0)
    .sort((a,b)=>a.ms-b.ms);
}

function maxDrawdown(rows=[]){
  if(!rows.length)return null;
  let peak=rows[0],worst=null;
  for(const row of rows){
    if(row.priceUsd>peak.priceUsd)peak=row;
    const drawdown=(row.priceUsd/peak.priceUsd)-1;
    if(!worst||drawdown<worst.drawdown){
      worst={drawdown,peak,trough:row};
    }
  }
  return worst;
}

function liquiditySurvival(rows=[],stressAt){
  if(!Number.isFinite(stressAt))return null;
  const before=rows.filter(r=>r.ms<=stressAt&&Number(r.liquidityUsd)>0).slice(-6);
  const after=rows.filter(r=>r.ms>=stressAt&&Number(r.liquidityUsd)>0).slice(-6);
  if(!before.length||!after.length)return null;
  const median=values=>{
    const v=[...values].sort((a,b)=>a-b);
    const m=Math.floor(v.length/2);
    return v.length%2?v[m]:(v[m-1]+v[m])/2;
  };
  const pre=median(before.map(r=>r.liquidityUsd));
  const post=median(after.map(r=>r.liquidityUsd));
  if(!(pre>0)||!(post>=0))return null;
  return Number((post/pre).toFixed(3));
}

function longHorizonResilience(history=[],options={}){
  const rows=normalizeHistory(history);
  const minSnapshots=Math.max(6,Number(options.minSnapshots||12));
  const minHistoryHours=Math.max(12,Number(options.minHistoryHours||36));
  const stressThreshold=Math.max(0.2,Math.min(0.8,Number(options.stressThreshold||0.30)));
  const minPostStressHours=Math.max(3,Number(options.minPostStressHours||12));

  if(rows.length<minSnapshots){
    return{status:'UNKNOWN',score:null,confidence:0,reason:'insufficient_snapshots',snapshots:rows.length};
  }
  const historyHours=(rows.at(-1).ms-rows[0].ms)/HOUR;
  if(historyHours<minHistoryHours){
    return{status:'UNKNOWN',score:null,confidence:Number(clamp(historyHours/minHistoryHours,0,1).toFixed(2)),reason:'insufficient_history_window',snapshots:rows.length,historyHours:Number(historyHours.toFixed(1))};
  }

  const dd=maxDrawdown(rows);
  if(!dd){
    return{status:'UNKNOWN',score:null,confidence:0,reason:'no_drawdown_data',snapshots:rows.length};
  }
  const drawdownPct=Math.abs(dd.drawdown)*100;
  if(Math.abs(dd.drawdown)<stressThreshold){
    return{
      status:'NOT_TESTED',score:null,
      confidence:Number(clamp(Math.min(0.65,historyHours/(7*24)),0,0.65).toFixed(2)),
      reason:'no_material_stress_event',snapshots:rows.length,historyHours:Number(historyHours.toFixed(1)),
      maxDrawdownPct:Number(drawdownPct.toFixed(1))
    };
  }

  const latest=rows.at(-1);
  const postStressHours=(latest.ms-dd.trough.ms)/HOUR;
  if(postStressHours<minPostStressHours){
    return{
      status:'TESTING',score:null,
      confidence:Number(clamp(postStressHours/minPostStressHours,0,0.7).toFixed(2)),
      reason:'stress_event_too_recent',snapshots:rows.length,historyHours:Number(historyHours.toFixed(1)),
      maxDrawdownPct:Number(drawdownPct.toFixed(1)),postStressHours:Number(postStressHours.toFixed(1))
    };
  }

  const peakPrice=dd.peak.priceUsd,troughPrice=dd.trough.priceUsd,currentPrice=latest.priceUsd;
  const peakRecovery=clamp((currentPrice/peakPrice)*100,0,140);
  const bounceFromTrough=clamp(((currentPrice/troughPrice)-1)*100,0,400);
  const liqSurvival=liquiditySurvival(rows,dd.trough.ms);

  let recoveryScore;
  if(peakRecovery>=95)recoveryScore=98;
  else if(peakRecovery>=80)recoveryScore=90;
  else if(peakRecovery>=65)recoveryScore=81;
  else if(peakRecovery>=50)recoveryScore=70;
  else if(peakRecovery>=35)recoveryScore=57;
  else if(peakRecovery>=22)recoveryScore=42;
  else recoveryScore=25;

  let bounceScore;
  if(bounceFromTrough>=100)bounceScore=95;
  else if(bounceFromTrough>=60)bounceScore=86;
  else if(bounceFromTrough>=35)bounceScore=75;
  else if(bounceFromTrough>=20)bounceScore=62;
  else if(bounceFromTrough>=8)bounceScore=48;
  else bounceScore=30;

  let timeScore=50;
  if(postStressHours>=7*24)timeScore=95;
  else if(postStressHours>=3*24)timeScore=85;
  else if(postStressHours>=48)timeScore=77;
  else if(postStressHours>=24)timeScore=67;
  else if(postStressHours>=12)timeScore=58;

  let liquidityScore=55;
  if(liqSurvival!=null){
    if(liqSurvival>=1.2)liquidityScore=95;
    else if(liqSurvival>=0.9)liquidityScore=86;
    else if(liqSurvival>=0.7)liquidityScore=72;
    else if(liqSurvival>=0.5)liquidityScore=58;
    else if(liqSurvival>=0.3)liquidityScore=40;
    else liquidityScore=22;
  }

  const score=Math.round(clamp(0.44*recoveryScore+0.24*bounceScore+0.18*timeScore+0.14*liquidityScore));
  const density=Math.min(1,rows.length/48);
  const windowConfidence=Math.min(1,historyHours/(7*24));
  const postStressConfidence=Math.min(1,postStressHours/(3*24));
  const confidence=Number(clamp(0.35*density+0.35*windowConfidence+0.30*postStressConfidence,0,1).toFixed(2));

  return{
    status:'MEASURED',score,confidence,reason:'material_stress_observed',
    snapshots:rows.length,historyHours:Number(historyHours.toFixed(1)),postStressHours:Number(postStressHours.toFixed(1)),
    maxDrawdownPct:Number(drawdownPct.toFixed(1)),peakRecoveryPct:Number(peakRecovery.toFixed(1)),
    bounceFromTroughPct:Number(bounceFromTrough.toFixed(1)),liquiditySurvivalRatio:liqSurvival,
    peakAt:dd.peak.at,troughAt:dd.trough.at,latestAt:latest.at
  };
}

function holderGrowthMetrics(history=[],options={}){
  const rows=(history||[])
    .map(row=>({at:row?.at,ms:Date.parse(row?.at||''),holders:Number(row?.holders),top10Pct:row?.top10Pct==null?null:Number(row.top10Pct),priceUsd:row?.priceUsd==null?null:Number(row.priceUsd)}))
    .filter(row=>Number.isFinite(row.ms)&&Number.isFinite(row.holders)&&row.holders>=0)
    .sort((a,b)=>a.ms-b.ms);
  if(rows.length<2)return{status:'UNKNOWN',score:null,confidence:0,reason:'insufficient_holder_snapshots',snapshots:rows.length};

  const latest=rows.at(-1);
  const targetHours=[24,72,168];
  const nearestBefore=hours=>{
    const target=latest.ms-hours*HOUR;
    const candidates=rows.filter(r=>r.ms<=target);
    return candidates.length?candidates.at(-1):null;
  };
  const changes={};
  for(const hours of targetHours){
    const base=nearestBefore(hours);
    changes[`${hours}h`]=base&&base.holders>0?Number((((latest.holders/base.holders)-1)*100).toFixed(2)):null;
  }
  const longest=rows[0];
  const netGrowth=longest.holders>0?((latest.holders/longest.holders)-1)*100:null;
  const day=changes['24h'];
  const week=changes['168h'];

  let growthScore=50;
  if(day!=null){
    if(day>=15)growthScore=96;
    else if(day>=8)growthScore=88;
    else if(day>=4)growthScore=79;
    else if(day>=1)growthScore=68;
    else if(day>=-1)growthScore=55;
    else if(day>=-5)growthScore=38;
    else growthScore=20;
  }else if(netGrowth!=null){
    growthScore=netGrowth>=20?85:netGrowth>=8?72:netGrowth>=0?58:35;
  }

  let persistenceScore=50;
  if(week!=null){
    if(week>=30)persistenceScore=95;
    else if(week>=15)persistenceScore=86;
    else if(week>=5)persistenceScore=74;
    else if(week>=0)persistenceScore=60;
    else persistenceScore=32;
  }else if(changes['72h']!=null){
    const d3=changes['72h'];
    persistenceScore=d3>=10?82:d3>=3?70:d3>=0?58:35;
  }

  let distributionScore=null;
  const topRows=rows.filter(r=>Number.isFinite(r.top10Pct));
  if(topRows.length>=2){
    const first=topRows[0].top10Pct,last=topRows.at(-1).top10Pct;
    const delta=last-first;
    distributionScore=delta<=-5?92:delta<=-2?82:delta<=0?70:delta<=2?52:delta<=5?35:20;
  }

  const score=Math.round(clamp(distributionScore==null?0.62*growthScore+0.38*persistenceScore:0.48*growthScore+0.30*persistenceScore+0.22*distributionScore));
  const durationHours=(latest.ms-rows[0].ms)/HOUR;
  const confidence=Number(clamp(0.45*Math.min(1,rows.length/14)+0.55*Math.min(1,durationHours/(7*24)),0,1).toFixed(2));
  return{
    status:'MEASURED',score,confidence,reason:'holder_history_available',snapshots:rows.length,currentHolders:latest.holders,
    changes,netGrowthPct:netGrowth==null?null:Number(netGrowth.toFixed(2)),distributionScore,
    top10Pct:Number.isFinite(latest.top10Pct)?latest.top10Pct:null,durationHours:Number(durationHours.toFixed(1))
  };
}

module.exports={normalizeHistory,maxDrawdown,liquiditySurvival,longHorizonResilience,holderGrowthMetrics,clamp};

'use strict';

const ENTRY_ACTIONS=new Set(['BUY','ADD','REENTRY']);
const EXIT_ACTIONS=new Set(['SELL','TRIM','EXIT']);
const SCOUT_CONFIRMATION_WINDOW_MINUTES=24*60;
const HORIZONS=[
  {key:'m5',minutes:5},{key:'m15',minutes:15},{key:'h1',minutes:60},{key:'h3',minutes:180},
  {key:'h6',minutes:360},{key:'h24',minutes:1440},{key:'d3',minutes:4320},{key:'d7',minutes:10080}
];
const round=(value,digits=2)=>Number(Number(value).toFixed(digits));
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const validPrice=value=>Number.isFinite(Number(value))&&Number(value)>0;

function median(values){
  const rows=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!rows.length)return null;
  const middle=Math.floor(rows.length/2);
  return rows.length%2?round(rows[middle]):round((rows[middle-1]+rows[middle])/2);
}

function returnPct(base,current){
  return validPrice(base)&&validPrice(current)?round((Number(current)/Number(base)-1)*100):null;
}

function sortedSnapshots(rows=[]){
  return rows.filter(row=>row&&validPrice(row.priceUsd)&&Number.isFinite(Date.parse(row.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}

function eventPerformance(event,history=[]){
  const eventAt=Date.parse(event?.at||'');
  if(!Number.isFinite(eventAt))return null;
  const snapshots=sortedSnapshots(history);
  const anchor=snapshots.find(row=>{
    const at=Date.parse(row.at);
    return at>=eventAt&&at<=eventAt+10*60*1000;
  });
  const basePrice=validPrice(event?.referencePriceUsd)?Number(event.referencePriceUsd):Number(anchor?.priceUsd);
  const baseAt=event?.priceObservedAt||anchor?.at||null;
  if(!validPrice(basePrice))return{basePriceUsd:null,baseAt:null,returns:{},maePct:null,mfePct:null,status:'WAITING_BASE_PRICE'};

  const returns={};
  for(const horizon of HORIZONS){
    const target=eventAt+horizon.minutes*60*1000;
    const tolerance=Math.max(10,Math.min(360,horizon.minutes*0.25))*60*1000;
    const snapshot=snapshots.find(row=>{
      const at=Date.parse(row.at);
      return at>=target&&at<=target+tolerance;
    });
    if(snapshot)returns[horizon.key]={pct:returnPct(basePrice,snapshot.priceUsd),priceUsd:Number(snapshot.priceUsd),at:snapshot.at};
  }
  const path=snapshots.filter(row=>{
    const at=Date.parse(row.at);
    return at>=eventAt&&at<=eventAt+7*24*3600*1000;
  });
  const pathReturns=path.map(row=>returnPct(basePrice,row.priceUsd)).filter(Number.isFinite);
  return{
    basePriceUsd:basePrice,baseAt,returns,
    maePct:pathReturns.length?round(Math.min(...pathReturns)):null,
    mfePct:pathReturns.length?round(Math.max(...pathReturns)):null,
    status:Object.keys(returns).length?'TRACKING':'BUILDING_PATH'
  };
}

function actorCalibration(actor,events=[],marketHistory={}){
  const rows=events.filter(event=>event.actorId===actor.id);
  const entries=rows.filter(event=>ENTRY_ACTIONS.has(event.action));
  const exits=rows.filter(event=>EXIT_ACTIONS.has(event.action));
  const performances=entries.map(event=>({event,...eventPerformance(event,marketHistory[event.tokenAddress]||[])}));
  const completedH1=performances.filter(row=>row.returns?.h1?.pct!=null);
  const completedH24=performances.filter(row=>row.returns?.h24?.pct!=null);
  let status='NO_VERIFIED_ENTRIES';
  if(entries.length>0&&completedH1.length<3)status='BUILDING_RETURNS';
  else if(entries.length>=10&&completedH24.length>=10)status='CORE_READY';
  else if(entries.length>=3&&completedH1.length>=3)status='TESTED_READY';
  const horizonMedians={};
  for(const horizon of HORIZONS){
    horizonMedians[horizon.key]=median(performances.map(row=>row.returns?.[horizon.key]?.pct));
  }
  const winRate=sample=>sample.length?round(sample.filter(row=>row.returns.h1.pct>0).length/sample.length*100):null;
  const winRate24=sample=>sample.length?round(sample.filter(row=>row.returns.h24.pct>0).length/sample.length*100):null;
  return{
    actorId:actor.id,handle:actor.xHandle||actor.handle,division:actor.division||'PROVISIONAL',status,
    observedEvents:rows.length,uniqueTokens:new Set(rows.map(row=>row.tokenAddress)).size,
    verifiedEntries:entries.length,verifiedExits:exits.length,
    acquires:rows.filter(row=>row.action==='ACQUIRE').length,transfers:rows.filter(row=>row.action==='TRANSFER_OUT').length,
    completedH1:completedH1.length,completedH24:completedH24.length,
    winRateH1:winRate(completedH1),winRateH24:winRate24(completedH24),
    medianReturns:horizonMedians,medianMaePct:median(performances.map(row=>row.maePct)),medianMfePct:median(performances.map(row=>row.mfePct)),
    lastEventAt:rows.map(row=>row.at).filter(Boolean).sort().at(-1)||null,
    entries:performances.slice(0,50)
  };
}

function discoveryLeadScore(minutes){
  if(minutes==null||!Number.isFinite(Number(minutes)))return 50;
  const value=Math.max(0,Number(minutes));
  if(value<15)return 50;
  if(value<60)return 60;
  if(value<180)return 70;
  if(value<360)return 80;
  if(value<720)return 90;
  return 95;
}

function socialDiscoveryWeight(actor,metrics={}){
  const resolved=Math.max(0,Number(metrics.resolved)||0);
  const prior=clamp(actor?.roleScores?.discovery??actor?.discoveryPrior??50);
  const confirmation=metrics.confirmationRate==null?50:clamp(metrics.confirmationRate);
  const lead=discoveryLeadScore(metrics.medianLeadMinutes);
  const measured=clamp(0.75*confirmation+0.25*lead);
  const confidence=resolved/(resolved+8);
  const score=clamp(prior*(1-confidence)+measured*confidence);
  return{
    score:Math.round(score),
    priorScore:Math.round(prior),
    measuredScore:Math.round(measured),
    confirmationScore:Math.round(confirmation),
    leadScore:Math.round(lead),
    confidencePct:round(confidence*100,1)
  };
}

function socialScoutCalibration(actor,actors=[],events=[],now=Date.now(),windowMinutes=SCOUT_CONFIRMATION_WINDOW_MINUTES){
  const moneyIds=new Set(actors.filter(row=>row.kind==='money'&&row.enabled!==false).map(row=>row.id));
  const scoutRows=events
    .filter(event=>event.actorId===actor.id&&event.action==='SCOUT'&&event.tokenAddress&&Number.isFinite(Date.parse(event.at||'')))
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));

  // Repeated posts about the same token are one discovery opportunity; keep the earliest one.
  const firstByToken=new Map();
  for(const event of scoutRows)if(!firstByToken.has(event.tokenAddress))firstByToken.set(event.tokenAddress,event);
  const windowMs=windowMinutes*60000;
  const records=[...firstByToken.values()].map(scout=>{
    const scoutMs=Date.parse(scout.at);
    const confirmation=events
      .filter(event=>event.tokenAddress===scout.tokenAddress&&moneyIds.has(event.actorId)&&ENTRY_ACTIONS.has(event.action))
      .filter(event=>{const at=Date.parse(event.at||'');return Number.isFinite(at)&&at>=scoutMs&&at<=scoutMs+windowMs;})
      .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))[0]||null;
    const confirmationMs=confirmation?Date.parse(confirmation.at):null;
    const leadMinutes=confirmation?round((confirmationMs-scoutMs)/60000,1):null;
    const ageMs=Math.max(0,Number(now)-scoutMs);
    const status=confirmation?'CONFIRMED':ageMs>=windowMs?'UNCONFIRMED':'PENDING';
    return{
      tokenAddress:scout.tokenAddress,scoutAt:scout.at,source:scout.source||'social',status,
      confirmedAt:confirmation?.at||null,confirmationActorId:confirmation?.actorId||null,
      confirmationAction:confirmation?.action||null,leadMinutes
    };
  });
  const confirmed=records.filter(row=>row.status==='CONFIRMED');
  const unconfirmed=records.filter(row=>row.status==='UNCONFIRMED');
  const pending=records.filter(row=>row.status==='PENDING');
  const resolved=confirmed.length+unconfirmed.length;
  const confirmationRate=resolved?round(confirmed.length/resolved*100):null;
  const medianLeadMinutes=median(confirmed.map(row=>row.leadMinutes));
  const weight=socialDiscoveryWeight(actor,{resolved,confirmationRate,medianLeadMinutes});
  let status='NO_SCOUTS';
  if(records.length&&resolved<5)status='BUILDING_SAMPLE';
  else if(resolved>=15)status='CORE_READY';
  else if(resolved>=5)status='TESTED_READY';

  // Keep the measured weight on the live actor object. Engine reads it on subsequent evaluations;
  // the dashboard also receives it immediately because actors are serialized after calibration.
  actor.measuredDiscoveryScore=weight.score;
  actor.socialDiscoveryConfidence=weight.confidencePct;
  actor.socialResolvedSample=resolved;

  return{
    actorId:actor.id,handle:actor.xHandle||actor.handle,status,
    scouts:records.length,confirmed:confirmed.length,unconfirmed:unconfirmed.length,pending:pending.length,resolved,
    confirmationRate,medianLeadMinutes,
    discoveryScore:weight.score,discoveryPrior:weight.priorScore,measuredScore:weight.measuredScore,
    discoveryConfidencePct:weight.confidencePct,leadScore:weight.leadScore,
    lastScoutAt:scoutRows.map(row=>row.at).sort().at(-1)||null,
    records:records.slice(-50).reverse()
  };
}

function calibrationReport(actors=[],events=[],marketHistory={}){
  const money=actors.filter(actor=>actor.kind==='money'&&actor.enabled!==false);
  const social=actors.filter(actor=>actor.kind==='social'&&actor.enabled!==false);
  const actorRows=money.map(actor=>actorCalibration(actor,events,marketHistory));
  const socialRows=social.map(actor=>socialScoutCalibration(actor,actors,events));
  const verifiedEntries=actorRows.reduce((sum,row)=>sum+row.verifiedEntries,0);
  const completedH1=actorRows.reduce((sum,row)=>sum+row.completedH1,0);
  return{
    generatedAt:new Date().toISOString(),
    status:verifiedEntries===0?'INSUFFICIENT_VERIFIED_ENTRIES':completedH1<3?'BUILDING_FORWARD_RETURNS':'CALIBRATION_ACTIVE',
    dataset:{
      events:events.length,moneyWallets:money.length,verifiedEntries,
      verifiedExits:actorRows.reduce((sum,row)=>sum+row.verifiedExits,0),completedH1,
      socialScouts:socialRows.reduce((sum,row)=>sum+row.scouts,0),
      socialConfirmed:socialRows.reduce((sum,row)=>sum+row.confirmed,0),
      socialResolved:socialRows.reduce((sum,row)=>sum+row.resolved,0)
    },
    policy:{
      promotion:'no automatic money promotion without verified economic entries and completed returns',
      socialPromotion:'social Discovery starts from a technical prior and converges toward measured confirmation + lead time as resolved sample grows; SCOUT never counts as economic entry',
      scoutConfirmationWindowMinutes:SCOUT_CONFIRMATION_WINDOW_MINUTES,
      horizons:HORIZONS.map(row=>row.key)
    },
    actors:actorRows,
    socialActors:socialRows
  };
}

module.exports={ENTRY_ACTIONS,EXIT_ACTIONS,SCOUT_CONFIRMATION_WINDOW_MINUTES,HORIZONS,median,returnPct,eventPerformance,actorCalibration,discoveryLeadScore,socialDiscoveryWeight,socialScoutCalibration,calibrationReport};

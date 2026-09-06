'use strict';

const ENTRY_ACTIONS=new Set(['BUY','ADD','REENTRY']);
const EXIT_ACTIONS=new Set(['SELL','TRIM','EXIT']);
const HORIZONS=[
  {key:'m5',minutes:5},{key:'m15',minutes:15},{key:'h1',minutes:60},{key:'h3',minutes:180},
  {key:'h6',minutes:360},{key:'h24',minutes:1440},{key:'d3',minutes:4320},{key:'d7',minutes:10080}
];
const round=(value,digits=2)=>Number(Number(value).toFixed(digits));
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

function calibrationReport(actors=[],events=[],marketHistory={}){
  const money=actors.filter(actor=>actor.kind==='money'&&actor.enabled!==false);
  const actorRows=money.map(actor=>actorCalibration(actor,events,marketHistory));
  const verifiedEntries=actorRows.reduce((sum,row)=>sum+row.verifiedEntries,0);
  const completedH1=actorRows.reduce((sum,row)=>sum+row.completedH1,0);
  return{
    generatedAt:new Date().toISOString(),
    status:verifiedEntries===0?'INSUFFICIENT_VERIFIED_ENTRIES':completedH1<3?'BUILDING_FORWARD_RETURNS':'CALIBRATION_ACTIVE',
    dataset:{events:events.length,moneyWallets:money.length,verifiedEntries,verifiedExits:actorRows.reduce((sum,row)=>sum+row.verifiedExits,0),completedH1},
    policy:{promotion:'no automatic promotion without verified economic entries and completed returns',horizons:HORIZONS.map(row=>row.key)},
    actors:actorRows
  };
}

module.exports={ENTRY_ACTIONS,EXIT_ACTIONS,HORIZONS,median,returnPct,eventPerformance,actorCalibration,calibrationReport};

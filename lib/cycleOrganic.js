'use strict';
const HOUR=3600e3;
const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));

function normalizedHolderRows(history=[]){
  return(history||[]).map(r=>({at:r?.at,ms:Date.parse(r?.at||''),holders:Number(r?.holders),priceUsd:Number(r?.priceUsd)}))
    .filter(r=>Number.isFinite(r.ms)&&Number.isFinite(r.holders)&&r.holders>0)
    .sort((a,b)=>a.ms-b.ms);
}

function holderPriceDivergence(history=[],hours=24){
  const rows=normalizedHolderRows(history);
  if(rows.length<2)return{status:'UNKNOWN',score:null,reason:'insufficient_holder_price_history'};
  const latest=rows.at(-1),target=latest.ms-Math.max(1,Number(hours)||24)*HOUR;
  const before=rows.filter(r=>r.ms<=target&&Number.isFinite(r.priceUsd)&&r.priceUsd>0).at(-1);
  if(!before||!Number.isFinite(latest.priceUsd)||latest.priceUsd<=0)return{status:'UNKNOWN',score:null,reason:'price_aligned_snapshot_unavailable'};
  const holderGrowth=((latest.holders/before.holders)-1)*100;
  const priceChange=((latest.priceUsd/before.priceUsd)-1)*100;
  let score=50;
  if(holderGrowth>=10&&priceChange<=15)score=96;
  else if(holderGrowth>=5&&priceChange<=10)score=90;
  else if(holderGrowth>=3&&priceChange<=0)score=88;
  else if(holderGrowth>=3&&holderGrowth>=priceChange*0.35)score=80;
  else if(holderGrowth>=1&&priceChange<=20)score=68;
  else if(holderGrowth>=0&&priceChange<=10)score=58;
  else if(holderGrowth<0)score=28;
  if(priceChange>=60&&holderGrowth<2)score=Math.min(score,30);
  else if(priceChange>=35&&holderGrowth<1)score=Math.min(score,38);
  const duration=(latest.ms-before.ms)/HOUR;
  return{status:'MEASURED',score:Math.round(clamp(score)),reason:'holders_vs_price_measured',hours:Number(duration.toFixed(1)),holderGrowthPct:Number(holderGrowth.toFixed(2)),priceChangePct:Number(priceChange.toFixed(2)),divergencePct:Number((holderGrowth-priceChange).toFixed(2))};
}

function normalizedMarketRows(history=[]){
  return(history||[]).map(r=>({at:r?.at,ms:Date.parse(r?.at||''),marketCap:Number(r?.marketCap),priceUsd:Number(r?.priceUsd),liquidityUsd:Number(r?.liquidityUsd),volume24h:Number(r?.volume24h),buys24h:Number(r?.buys24h),sells24h:Number(r?.sells24h)}))
    .filter(r=>Number.isFinite(r.ms)).sort((a,b)=>a.ms-b.ms);
}

function marketStructure(history=[]){
  const rows=normalizedMarketRows(history);
  if(!rows.length)return{status:'UNKNOWN',score:null,reason:'no_market_history'};
  const latest=rows.at(-1),mc=latest.marketCap,liq=latest.liquidityUsd,vol=latest.volume24h;
  let points=0,weight=0;
  let liquidityRatio=null,volumeRatio=null,buySellRatio=null;
  if(mc>0&&liq>0){
    liquidityRatio=liq/mc;
    let s=liquidityRatio>=0.08?95:liquidityRatio>=0.05?88:liquidityRatio>=0.03?78:liquidityRatio>=0.015?65:liquidityRatio>=0.007?48:28;
    points+=s*0.5;weight+=0.5;
  }
  if(mc>0&&vol>=0){
    volumeRatio=vol/mc;
    let s=volumeRatio>=1?95:volumeRatio>=0.5?88:volumeRatio>=0.2?78:volumeRatio>=0.08?66:volumeRatio>=0.03?50:30;
    points+=s*0.35;weight+=0.35;
  }
  if(latest.buys24h>=0&&latest.sells24h>=0&&(latest.buys24h+latest.sells24h)>0){
    buySellRatio=(latest.buys24h+1)/(latest.sells24h+1);
    let s=buySellRatio>=0.8&&buySellRatio<=2.5?78:buySellRatio>2.5&&buySellRatio<=5?65:buySellRatio>=0.5?58:38;
    points+=s*0.15;weight+=0.15;
  }
  if(!weight)return{status:'UNKNOWN',score:null,reason:'market_structure_fields_unavailable'};
  return{status:'MEASURED',score:Math.round(clamp(points/weight)),confidence:Number(Math.min(1,weight).toFixed(2)),reason:'market_structure_measured',liquidityToMcap:liquidityRatio==null?null:Number(liquidityRatio.toFixed(4)),volumeToMcap:volumeRatio==null?null:Number(volumeRatio.toFixed(4)),buySellRatio:buySellRatio==null?null:Number(buySellRatio.toFixed(2)),latestAt:latest.at};
}

function marketTrajectory(history=[]){
  const rows=normalizedMarketRows(history).filter(r=>Number.isFinite(r.marketCap)&&r.marketCap>0);
  if(rows.length<2)return{status:'UNKNOWN',reason:'insufficient_market_cap_history',multipleFromFirst:null,timeTo2xHours:null,timeTo5xHours:null,timeTo10xHours:null};
  const first=rows[0],latest=rows.at(-1);
  const observedHours=(latest.ms-first.ms)/HOUR;
  if(observedHours<=0)return{status:'UNKNOWN',reason:'zero_market_history_window'};
  const firstMc=first.marketCap,latestMc=latest.marketCap;
  let peak=first;
  for(const row of rows)if(row.marketCap>peak.marketCap)peak=row;
  const multipleFromFirst=latestMc/firstMc;
  const peakMultiple=peak.marketCap/firstMc;
  const currentDrawdownPct=peak.marketCap>0?Math.max(0,(1-latestMc/peak.marketCap)*100):null;
  const timeTo=multiple=>{
    const hit=rows.find(row=>row.marketCap>=firstMc*multiple);
    return hit?Number(((hit.ms-first.ms)/HOUR).toFixed(1)):null;
  };
  const timeTo2xHours=timeTo(2),timeTo5xHours=timeTo(5),timeTo10xHours=timeTo(10);
  let trajectory='BUILDING';
  if((timeTo5xHours!=null&&timeTo5xHours<=72)||(peakMultiple>=5&&observedHours<=7*24))trajectory='HYPERVELOCITY';
  else if(observedHours>=30*24&&peakMultiple>=3&&currentDrawdownPct<=55)trajectory='LONG_COMPOUNDER';
  else if(observedHours>=14*24&&peakMultiple>=2)trajectory='COMPOUNDING';
  else if(currentDrawdownPct>=70)trajectory='DEEP_DRAWDOWN';
  else if(peakMultiple>=2)trajectory='EXPANDING';
  else trajectory='BUILDING';
  const confidence=Math.min(1,0.35+Math.min(0.35,rows.length/80)+Math.min(0.30,observedHours/(30*24)*0.30));
  return{
    status:'MEASURED',reason:'observed_market_cap_trajectory',trajectory,confidence:Number(confidence.toFixed(2)),snapshots:rows.length,
    observedHours:Number(observedHours.toFixed(1)),firstMarketCap:firstMc,latestMarketCap:latestMc,peakMarketCap:peak.marketCap,
    multipleFromFirst:Number(multipleFromFirst.toFixed(2)),peakMultiple:Number(peakMultiple.toFixed(2)),currentDrawdownPct:Number(currentDrawdownPct.toFixed(1)),
    timeTo2xHours,timeTo5xHours,timeTo10xHours,firstAt:first.at,peakAt:peak.at,latestAt:latest.at
  };
}

module.exports={holderPriceDivergence,marketStructure,marketTrajectory,normalizedHolderRows,normalizedMarketRows,clamp};

'use strict';
const CycleHistory=require('./cycleHistory');
const CycleOrganic=require('./cycleOrganic');

const HOUR=3600e3;
const lower=v=>String(v||'').toLowerCase();

class CycleRuntime{
  constructor({holderProvider,holdingsProvider,snapshotIntervalMs=60*60*1000,holdingsIntervalMs=2*60*60*1000,maxHolderSnapshots=400,maxScoreSnapshots=1200}={}){
    this.holderProvider=holderProvider;
    this.holdingsProvider=holdingsProvider;
    this.snapshotIntervalMs=Math.max(5*60*1000,Number(snapshotIntervalMs)||60*60*1000);
    this.holdingsIntervalMs=Math.max(15*60*1000,Number(holdingsIntervalMs)||2*60*60*1000);
    this.maxHolderSnapshots=Math.max(24,Number(maxHolderSnapshots)||400);
    this.maxScoreSnapshots=Math.max(100,Number(maxScoreSnapshots)||1200);
  }

  ensure(db){
    db.holderHistory=db.holderHistory||{};
    db.holderSnapshotStatus=db.holderSnapshotStatus||{};
    db.moneyHoldingsStatus=db.moneyHoldingsStatus||{};
    db.cycleScoreHistory=db.cycleScoreHistory||{};
  }

  scoreVelocity(db,address,now=Date.now()){
    this.ensure(db);
    const rows=(db.cycleScoreHistory?.[lower(address)]||[])
      .map(row=>({...row,ms:Date.parse(row.at||'')}))
      .filter(row=>Number.isFinite(row.ms)&&Number.isFinite(Number(row.score)))
      .sort((a,b)=>a.ms-b.ms);
    if(!rows.length)return{status:'BUILDING_HISTORY',delta6h:null,delta24h:null,delta3d:null,direction:'BUILDING_HISTORY'};
    const latest=rows.at(-1);
    const prior=hours=>{
      const target=now-hours*HOUR;
      const candidates=rows.filter(r=>r.ms<=target);
      return candidates.length?candidates.at(-1):null;
    };
    const delta=hours=>{const base=prior(hours);return base?Number((Number(latest.score)-Number(base.score)).toFixed(1)):null;};
    const delta6h=delta(6),delta24h=delta(24),delta3d=delta(72);
    const observed=[delta6h,delta24h,delta3d].filter(Number.isFinite);
    const lead=Number.isFinite(delta24h)?delta24h:Number.isFinite(delta6h)?delta6h:Number.isFinite(delta3d)?delta3d:null;
    let direction='BUILDING_HISTORY';
    if(lead!=null){
      if(lead>=8)direction='RISING_FAST';
      else if(lead>=3)direction='RISING';
      else if(lead<=-8)direction='FALLING_FAST';
      else if(lead<=-3)direction='COOLING';
      else direction='STABLE';
    }
    return{status:observed.length?'MEASURED':'BUILDING_HISTORY',delta6h,delta24h,delta3d,direction,latestScore:Number(latest.score),latestAt:latest.at};
  }

  recordScore(db,address,score,stage,at=new Date().toISOString()){
    this.ensure(db);
    address=lower(address);
    if(!/^0x[a-f0-9]{40}$/.test(address)||!Number.isFinite(Number(score)))return false;
    const history=db.cycleScoreHistory[address]||[];
    const last=history.at(-1);
    const ms=Date.parse(at);
    if(last&&Number.isFinite(ms)&&Math.abs(ms-Date.parse(last.at||''))<15*60*1000){
      history[history.length-1]={at,score:Number(score),stage:stage||null};
    }else history.push({at,score:Number(score),stage:stage||null});
    db.cycleScoreHistory[address]=history.slice(-this.maxScoreSnapshots);
    return true;
  }

  metrics(db,address){
    this.ensure(db);
    address=lower(address);
    const marketHistory=db.marketHistory?.[address]||[];
    const holderHistory=db.holderHistory?.[address]||[];
    const resilience=CycleHistory.longHorizonResilience(marketHistory);
    const holders=CycleHistory.holderGrowthMetrics(holderHistory);
    const organic=CycleOrganic.holderPriceDivergence(holderHistory,24);
    const marketStructure=CycleOrganic.marketStructure(marketHistory);
    const trajectory=CycleOrganic.marketTrajectory(marketHistory);
    const latest=holderHistory.at(-1)||null;
    if(latest){
      holders.currentHolders=latest.holders??holders.currentHolders??null;
      holders.top10Pct=latest.top10Pct??holders.top10Pct??null;
      holders.latestSnapshotAt=latest.at||null;
    }
    return{
      resilience,holders,organic,marketStructure,trajectory,
      holdings:db.moneyHoldingsStatus?.[address]||{status:'UNKNOWN',reason:'not_measured'},
      scoreVelocity:this.scoreVelocity(db,address),
      holderProviderStatus:db.holderSnapshotStatus?.[address]||null
    };
  }

  async maybeSnapshotHolders(db,address,state={},options={}){
    this.ensure(db);address=lower(address);
    const now=Date.now();
    const previous=db.holderSnapshotStatus[address]||{};
    const lastAttempt=Date.parse(previous.attemptAt||'');
    const force=options.force===true;
    if(!force&&Number.isFinite(lastAttempt)&&now-lastAttempt<this.snapshotIntervalMs){
      return{...previous,skipped:true,reason:'snapshot_interval'};
    }
    const attemptAt=new Date(now).toISOString();
    db.holderSnapshotStatus[address]={...previous,attemptAt,status:'PENDING'};
    if(!this.holderProvider||typeof this.holderProvider.snapshot!=='function'){
      const result={status:'UNKNOWN',reason:'holder_provider_unconfigured',attemptAt};
      db.holderSnapshotStatus[address]=result;
      return result;
    }
    const result=await this.holderProvider.snapshot(address,{pairAddress:state?.execution?.pairAddress||null});
    db.holderSnapshotStatus[address]={...result,attemptAt};
    if(result.status!=='MEASURED'||!Number.isFinite(Number(result.holders)))return result;

    const snapshot={
      at:result.observedAt||attemptAt,
      holders:Number(result.holders),
      top10Pct:Number.isFinite(Number(result.top10Pct))?Number(result.top10Pct):null,
      priceUsd:Number.isFinite(Number(state?.priceUsd))?Number(state.priceUsd):null,
      source:result.source||null
    };
    const history=db.holderHistory[address]||[];
    const last=history.at(-1);
    if(last&&Math.abs(Date.parse(snapshot.at)-Date.parse(last.at))<30*60*1000)history[history.length-1]=snapshot;
    else history.push(snapshot);
    db.holderHistory[address]=history.slice(-this.maxHolderSnapshots);
    return result;
  }

  async maybeSnapshotMoneyHoldings(db,address,actors=[],options={}){
    this.ensure(db);address=lower(address);
    const now=Date.now(),previous=db.moneyHoldingsStatus[address]||{};
    const lastAttempt=Date.parse(previous.attemptAt||'');
    const force=options.force===true;
    if(!force&&Number.isFinite(lastAttempt)&&now-lastAttempt<this.holdingsIntervalMs)return{...previous,skipped:true,reason:'holdings_interval'};
    const attemptAt=new Date(now).toISOString();
    if(!this.holdingsProvider||typeof this.holdingsProvider.snapshot!=='function'){
      const result={status:'UNKNOWN',reason:'holdings_provider_unconfigured',attemptAt};
      db.moneyHoldingsStatus[address]=result;return result;
    }
    const result=await this.holdingsProvider.snapshot(address,actors);
    db.moneyHoldingsStatus[address]={...result,attemptAt};
    return result;
  }
}

module.exports=CycleRuntime;

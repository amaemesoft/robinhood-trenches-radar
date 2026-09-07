'use strict';
const CycleHistory=require('./cycleHistory');

class CycleRuntime{
  constructor({holderProvider,snapshotIntervalMs=60*60*1000,maxHolderSnapshots=400}={}){
    this.holderProvider=holderProvider;
    this.snapshotIntervalMs=Math.max(5*60*1000,Number(snapshotIntervalMs)||60*60*1000);
    this.maxHolderSnapshots=Math.max(24,Number(maxHolderSnapshots)||400);
  }

  ensure(db){
    db.holderHistory=db.holderHistory||{};
    db.holderSnapshotStatus=db.holderSnapshotStatus||{};
  }

  metrics(db,address){
    this.ensure(db);
    const marketHistory=db.marketHistory?.[address]||[];
    const holderHistory=db.holderHistory?.[address]||[];
    const resilience=CycleHistory.longHorizonResilience(marketHistory);
    const holders=CycleHistory.holderGrowthMetrics(holderHistory);
    const latest=holderHistory.at(-1)||null;
    if(latest){
      holders.currentHolders=latest.holders??holders.currentHolders??null;
      holders.top10Pct=latest.top10Pct??holders.top10Pct??null;
      holders.latestSnapshotAt=latest.at||null;
    }
    return{resilience,holders,holderProviderStatus:db.holderSnapshotStatus?.[address]||null};
  }

  async maybeSnapshotHolders(db,address,state={},options={}){
    this.ensure(db);
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
}

module.exports=CycleRuntime;

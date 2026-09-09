'use strict';
const ShadowDesk=require('./shadowDesk');
const ShadowStore=require('./shadowStore');
module.exports=class ShadowRuntime{
  constructor({storage,getDb,getSignals,getActors,refreshToken}){
    this.storage=storage;this.getDb=getDb;this.getSignals=getSignals;this.getActors=getActors;this.refreshToken=refreshToken;
    this.desk=new ShadowDesk();this.running=false;this.lastError=null;this.startedAt=new Date().toISOString();this.auditCursor=0;
  }
  async init(){
    this.store=new ShadowStore({pool:this.storage.pool,filePath:require('node:path').join(__dirname,'../data/shadow.json')});await this.store.init();
    await this.tick();this.timer=setInterval(()=>this.tick(),120000);this.timer.unref?.();
  }
  async tick(){
    if(this.running)return;this.running=true;
    try{
      const previous=await this.store.read(),db=this.getDb();
      // Refresh open risk and outstanding audit marks before making the decision.
      const priority=[...new Set([...Object.keys(previous?.state?.positions||{}),...Object.values(previous?.state?.setups||{}).filter(x=>x.status==='WAIT_PULLBACK').map(x=>x.tokenAddress)])];
      const auditTokens=[...new Set(Object.values(previous?.state?.audits||{}).filter(a=>!a.status.startsWith('COMPLETE')).map(a=>a.tokenAddress))].filter(a=>!priority.includes(a));
      const batch=auditTokens.length?Array.from({length:Math.min(10,auditTokens.length)},(_,i)=>auditTokens[(this.auditCursor+i)%auditTokens.length]):[];
      this.auditCursor+=batch.length;const watched=[...priority,...batch];
      for(const address of watched.slice(0,30)){
        const at=Date.parse(db.tokenState[address]?.marketObservedAt||db.tokenState[address]?.observedAt||'');
        if(!Number.isFinite(at)||Date.now()-at>120000)try{await this.refreshToken(address);}catch{console.warn(`[shadow-desk] market refresh unavailable ${address}`);}
      }
      const signals=this.getSignals(),now=Date.now();
      const result=await this.store.transact(state=>this.desk.run({state,tacticalSignals:signals,tokenState:db.tokenState,actors:this.getActors(),now}),db.shadowDesk);
      this.lastError=null;
      console.log(`[shadow-desk] mode=SHADOW execution=PAPER_ONLY persisted=${this.storage.pool?'postgres':'file'} decisions=${result.journal.filter(x=>x.kind==='decision').length} equity=${result.snapshot.bankroll.equityUsd} open=${result.snapshot.positions.length} trades=${result.trades.length} auditor=${result.auditUpdates.length}`);
    }catch(e){this.lastError=e.message;console.error('[shadow-desk] cycle failed; no successful cycle claimed:',e.message);}finally{this.running=false;}
  }
  async snapshot(){
    const row=await this.store.read();const snapshot=this.desk.snapshot(row?.state,this.getDb().tokenState);
    return{...snapshot,runtime:{status:this.lastError?'DEGRADED':Date.now()-Date.parse(snapshot.lastRunAt||'')<300000?'RUNNING':'STARTING_OR_STALE',startedAt:this.startedAt,lastError:this.lastError},persistence:await this.store.evidence()};
  }
  stop(){if(this.timer)clearInterval(this.timer);}
};

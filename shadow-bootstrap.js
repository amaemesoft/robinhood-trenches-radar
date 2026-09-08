'use strict';

const http=require('http');
const Storage=require('./lib/storage');
const ShadowDesk=require('./lib/shadowDesk');

const PORT=Number(process.env.PORT||8787);
const INTERVAL_MS=Math.max(30000,Number(process.env.SHADOW_DESK_INTERVAL_MS)||120000);
const desk=new ShadowDesk({
  initialBalanceUsd:Number(process.env.SHADOW_START_BALANCE_USD)||1000,
  maxPositionPct:Number(process.env.SHADOW_MAX_POSITION_PCT)||8,
  riskPerTradePct:Number(process.env.SHADOW_RISK_PER_TRADE_PCT)||0.75,
  maxOpenPositions:Number(process.env.SHADOW_MAX_OPEN_POSITIONS)||5,
  maxDailyLossPct:Number(process.env.SHADOW_MAX_DAILY_LOSS_PCT)||4,
  minPullbackPct:Number(process.env.SHADOW_MIN_PULLBACK_PCT)||3,
  maxPullbackPct:Number(process.env.SHADOW_MAX_PULLBACK_PCT)||18,
  stopLossPct:Number(process.env.SHADOW_STOP_LOSS_PCT)||12,
  maxSellImpactPct:Number(process.env.SHADOW_MAX_SELL_IMPACT_PCT)||10
});

let storageRef=null;
let dbRef=null;
let deskRunning=false;

const originalInit=Storage.prototype.init;
Storage.prototype.init=async function(...args){
  const value=await originalInit.apply(this,args);
  storageRef=this;
  dbRef=value;
  return value;
};

const originalCreateServer=http.createServer;
http.createServer=function(handler){
  return originalCreateServer.call(http,async(req,res)=>{
    const pathname=String(req.url||'').split('?')[0];
    if(pathname==='/api/autopilot'&&req.method==='GET'){
      try{
        const payload=desk.snapshot(dbRef?.shadowDesk,dbRef?.tokenState||{},Date.now());
        res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
        res.end(JSON.stringify(payload));
      }catch(error){
        res.writeHead(500,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
        res.end(JSON.stringify({error:error.message}));
      }
      return;
    }
    return handler(req,res);
  });
};

async function runShadowDesk(){
  if(deskRunning||!dbRef||!storageRef)return;
  deskRunning=true;
  try{
    const response=await fetch(`http://127.0.0.1:${PORT}/api/dashboard`,{headers:{accept:'application/json'}});
    if(!response.ok)throw new Error(`dashboard HTTP ${response.status}`);
    const dashboard=await response.json();
    const result=desk.run({
      state:dbRef.shadowDesk,
      tacticalSignals:dashboard.signals||[],
      cycleMemes:dashboard.cycleMemes||[],
      tokenState:dbRef.tokenState||{},
      now:Date.now()
    });
    dbRef.shadowDesk=result.state;
    dbRef.sync={...(dbRef.sync||{}),shadowDesk:{
      mode:'SHADOW',version:1,lastRunAt:result.snapshot.lastRunAt,
      equityUsd:result.snapshot.bankroll.equityUsd,openPositions:result.snapshot.positions.length,
      waitingSetups:result.snapshot.setups.length,tradesThisRun:result.trades.length
    }};
    storageRef.save(dbRef);
    await storageRef.flush();
    console.log(`[shadow-desk] equity=$${result.snapshot.bankroll.equityUsd} open=${result.snapshot.positions.length} setups=${result.snapshot.setups.length} trades=${result.trades.length}`);
  }catch(error){
    if(dbRef){dbRef.sync={...(dbRef.sync||{}),shadowDesk:{...(dbRef.sync?.shadowDesk||{}),mode:'SHADOW',version:1,lastError:error.message,lastAttemptAt:new Date().toISOString()}};storageRef?.save(dbRef);}
    console.error(`[shadow-desk] ${error.message}`);
  }finally{deskRunning=false;}
}

require('./server');
setTimeout(()=>runShadowDesk().catch(()=>{}),7000);
const timer=setInterval(()=>runShadowDesk().catch(()=>{}),INTERVAL_MS);
timer.unref?.();

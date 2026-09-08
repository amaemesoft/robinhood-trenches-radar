'use strict';

const ENTRY_STATES=new Set(['ENTRY_CANDIDATE','HIGH_CONFLUENCE']);
const HARD_EXIT_STATES=new Set(['DISTRIBUTION','BLOCKED']);
const REQUIRED_SAFETY=['tokenControl','upgradeAuthority','canonicalLp','sellRestriction'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const iso=ms=>new Date(ms).toISOString();
const lower=v=>String(v||'').toLowerCase();

class ShadowDesk{
  constructor(options={}){
    this.config={
      initialBalanceUsd:Number(options.initialBalanceUsd)||1000,
      maxPositionPct:Number(options.maxPositionPct)||8,
      riskPerTradePct:Number(options.riskPerTradePct)||0.75,
      maxOpenPositions:Number(options.maxOpenPositions)||5,
      maxDailyLossPct:Number(options.maxDailyLossPct)||4,
      minPullbackPct:Number(options.minPullbackPct)||3,
      maxPullbackPct:Number(options.maxPullbackPct)||18,
      stopLossPct:Number(options.stopLossPct)||12,
      trailArmPct:Number(options.trailArmPct)||35,
      trailGivebackPct:Number(options.trailGivebackPct)||18,
      maxSellImpactPct:Number(options.maxSellImpactPct)||10,
      maxDataAgeMs:Number(options.maxDataAgeMs)||15*60*1000,
      setupExpiryMs:Number(options.setupExpiryMs)||12*60*60*1000,
      minSetupAgeMs:Number(options.minSetupAgeMs)||60*1000,
      minPositionUsd:Number(options.minPositionUsd)||10,
      maxDecisionHistory:Number(options.maxDecisionHistory)||240,
      maxTradeHistory:Number(options.maxTradeHistory)||500,
      maxEquityHistory:Number(options.maxEquityHistory)||1000
    };
  }

  defaultState(now=Date.now()){
    const start=this.config.initialBalanceUsd;
    return{
      version:1,mode:'SHADOW',createdAt:iso(now),lastRunAt:null,
      initialBalanceUsd:start,cashUsd:start,realizedPnlUsd:0,
      positions:{},setups:{},trades:[],decisions:[],equityHistory:[],
      daily:{date:iso(now).slice(0,10),startEquityUsd:start}
    };
  }

  normalize(state,now=Date.now()){
    const base=this.defaultState(now);
    if(!state||typeof state!=='object')return base;
    return{
      ...base,...state,version:1,mode:'SHADOW',
      positions:{...(state.positions||{})},setups:{...(state.setups||{})},
      trades:[...(state.trades||[])],decisions:[...(state.decisions||[])],
      equityHistory:[...(state.equityHistory||[])],daily:{...base.daily,...(state.daily||{})}
    };
  }

  statePrice(tokenState,address){
    const p=Number(tokenState?.[address]?.priceUsd);
    return Number.isFinite(p)&&p>0?p:null;
  }

  slippagePct(tokenState,address){
    const impact=Number(tokenState?.[address]?.execution?.sellImpactPct);
    return round(clamp(Number.isFinite(impact)?impact:2,0.5,10),2);
  }

  atlas(tokenState,address,now){
    const st=tokenState?.[address]||{};
    const observed=Date.parse(st.observedAt||'');
    const age=Number.isFinite(observed)?Math.max(0,now-observed):Infinity;
    const price=Number(st.priceUsd);
    const pass=Number.isFinite(price)&&price>0&&age<=this.config.maxDataAgeMs;
    return{status:pass?'PASS':'REVIEW',ageSeconds:Number.isFinite(age)?Math.round(age/1000):null,reason:pass?'fresh_market_state':'stale_or_missing_market_state'};
  }

  sentinel(tokenState,address){
    const st=tokenState?.[address]||{};
    const safety=st.safety||{},execution=st.execution||{};
    const critical=REQUIRED_SAFETY.map(k=>[k,safety[k]||'UNKNOWN']);
    const safetyPass=critical.every(([,v])=>v==='PASS');
    const exitPass=execution.exitQuoteStatus==='PASS';
    const impact=Number(execution.sellImpactPct);
    const impactPass=Number.isFinite(impact)&&impact<=this.config.maxSellImpactPct;
    const pass=safetyPass&&exitPass&&impactPass;
    return{
      status:pass?'PASS':'BLOCK',reason:!safetyPass?'critical_safety_not_pass':!exitPass?'exit_quote_not_pass':'sell_impact_too_high',
      safety:Object.fromEntries(critical),exitQuoteStatus:execution.exitQuoteStatus||'UNKNOWN',sellImpactPct:Number.isFinite(impact)?round(impact):null
    };
  }

  equity(state,tokenState){
    let positionsValue=0,unrealized=0;
    for(const [address,p] of Object.entries(state.positions||{})){
      const price=this.statePrice(tokenState,address)||Number(p.lastPriceUsd)||Number(p.entryPriceUsd)||0;
      const value=Number(p.quantity||0)*price;
      positionsValue+=value;
      unrealized+=value-Number(p.costUsd||0);
    }
    const equity=Number(state.cashUsd||0)+positionsValue;
    return{equityUsd:round(equity),positionsValueUsd:round(positionsValue),unrealizedPnlUsd:round(unrealized)};
  }

  anchor(state,tokenState,address){
    const eq=this.equity(state,tokenState);
    const dailyStart=Number(state.daily?.startEquityUsd)||eq.equityUsd||this.config.initialBalanceUsd;
    const dailyLossPct=dailyStart>0?Math.max(0,(dailyStart-eq.equityUsd)/dailyStart*100):0;
    if(dailyLossPct>=this.config.maxDailyLossPct)return{status:'BLOCK',reason:'daily_loss_limit',sizeUsd:0,dailyLossPct:round(dailyLossPct)};
    if(Object.keys(state.positions||{}).length>=this.config.maxOpenPositions)return{status:'BLOCK',reason:'max_open_positions',sizeUsd:0,dailyLossPct:round(dailyLossPct)};
    const execution=tokenState?.[address]?.execution||{};
    const exitTarget=Number(execution.exitabilityTargetUsd)||250;
    const pctCap=eq.equityUsd*(this.config.maxPositionPct/100);
    const riskCap=eq.equityUsd*(this.config.riskPerTradePct/100)/(this.config.stopLossPct/100);
    const size=Math.max(0,Math.min(Number(state.cashUsd||0),pctCap,riskCap,exitTarget));
    if(size<this.config.minPositionUsd)return{status:'BLOCK',reason:'position_below_minimum',sizeUsd:round(size),dailyLossPct:round(dailyLossPct)};
    return{status:'PASS',reason:'risk_budget_available',sizeUsd:round(size),dailyLossPct:round(dailyLossPct),exitabilityTargetUsd:round(exitTarget)};
  }

  createSetup(signal,price,now){
    const address=lower(signal.tokenAddress);
    return{
      tokenAddress:address,symbol:signal.symbol||signal.ticker||address.slice(0,8),createdAt:iso(now),updatedAt:iso(now),status:'WAIT_PULLBACK',
      referencePriceUsd:price,highWaterPriceUsd:price,invalidationPriceUsd:round(price*(1-this.config.maxPullbackPct/100),12),
      minPullbackPct:this.config.minPullbackPct,maxPullbackPct:this.config.maxPullbackPct,expiresAt:iso(now+this.config.setupExpiryMs)
    };
  }

  pulse(setup,price,signalState,now){
    if(!setup)return{status:'WAIT',reason:'no_vector_setup'};
    const age=now-Date.parse(setup.createdAt||'');
    const high=Math.max(Number(setup.highWaterPriceUsd)||price,price);
    const drawdown=high>0?(high-price)/high*100:0;
    if(price<=Number(setup.invalidationPriceUsd||0))return{status:'INVALID',reason:'vector_invalidation_hit',drawdownPct:round(drawdown)};
    if(age<this.config.minSetupAgeMs)return{status:'WAIT',reason:'setup_too_new',drawdownPct:round(drawdown)};
    if(!ENTRY_STATES.has(signalState))return{status:'WAIT',reason:'tactical_gate_not_active',drawdownPct:round(drawdown)};
    if(drawdown<this.config.minPullbackPct)return{status:'WAIT',reason:'no_pullback_yet',drawdownPct:round(drawdown)};
    if(drawdown>this.config.maxPullbackPct)return{status:'INVALID',reason:'pullback_beyond_invalidation_band',drawdownPct:round(drawdown)};
    return{status:'PASS',reason:'first_valid_pullback_band',drawdownPct:round(drawdown)};
  }

  closePosition(state,address,price,tokenState,reason,now,signalState){
    const p=state.positions[address];
    if(!p)return null;
    const slip=this.slippagePct(tokenState,address);
    const fill=price*(1-slip/100);
    const proceeds=Number(p.quantity||0)*fill;
    const pnl=proceeds-Number(p.costUsd||0);
    state.cashUsd=round(Number(state.cashUsd||0)+proceeds,8);
    state.realizedPnlUsd=round(Number(state.realizedPnlUsd||0)+pnl,8);
    delete state.positions[address];
    const trade={id:`shadow-exit-${now}-${address}`,side:'SELL_SHADOW',tokenAddress:address,symbol:p.symbol,at:iso(now),reason,signalState:signalState||null,priceUsd:round(price,12),fillPriceUsd:round(fill,12),slippagePct:slip,quantity:p.quantity,proceedsUsd:round(proceeds),pnlUsd:round(pnl),returnPct:p.costUsd>0?round(pnl/p.costUsd*100):0};
    state.trades.unshift(trade);
    return trade;
  }

  openPosition(state,setup,price,sizeUsd,tokenState,now,signalState){
    const address=setup.tokenAddress,slip=this.slippagePct(tokenState,address);
    const fill=price*(1+slip/100),qty=sizeUsd/fill;
    state.cashUsd=round(Number(state.cashUsd||0)-sizeUsd,8);
    state.positions[address]={
      tokenAddress:address,symbol:setup.symbol,openedAt:iso(now),signalState,entryPriceUsd:round(fill,12),marketPriceAtEntryUsd:round(price,12),
      quantity:qty,costUsd:round(sizeUsd),lastPriceUsd:round(price,12),highWaterPriceUsd:round(price,12),
      stopPriceUsd:round(fill*(1-this.config.stopLossPct/100),12),slippagePct:slip,status:'OPEN'
    };
    setup.status='ENTERED';setup.enteredAt=iso(now);setup.updatedAt=iso(now);
    const trade={id:`shadow-entry-${now}-${address}`,side:'BUY_SHADOW',tokenAddress:address,symbol:setup.symbol,at:iso(now),reason:'fuse_approved_after_pullback',signalState,priceUsd:round(price,12),fillPriceUsd:round(fill,12),slippagePct:slip,quantity:qty,costUsd:round(sizeUsd)};
    state.trades.unshift(trade);
    return trade;
  }

  run({state,tacticalSignals=[],cycleMemes=[],tokenState={},now=Date.now()}={}){
    const s=this.normalize(state,now);
    const today=iso(now).slice(0,10);
    if(s.daily?.date!==today){const eq=this.equity(s,tokenState).equityUsd;s.daily={date:today,startEquityUsd:eq};}
    const signalMap=new Map((tacticalSignals||[]).filter(x=>x?.tokenAddress).map(x=>[lower(x.tokenAddress),x]));
    const cycleMap=new Map((cycleMemes||[]).filter(x=>x?.tokenAddress).map(x=>[lower(x.tokenAddress),x]));
    const runTrades=[];

    for(const [address,p] of Object.entries({...s.positions})){
      const price=this.statePrice(tokenState,address);
      if(!price)continue;
      p.lastPriceUsd=round(price,12);p.highWaterPriceUsd=Math.max(Number(p.highWaterPriceUsd)||price,price);
      if(p.highWaterPriceUsd>=Number(p.entryPriceUsd)*(1+this.config.trailArmPct/100)){
        p.stopPriceUsd=Math.max(Number(p.stopPriceUsd)||0,p.highWaterPriceUsd*(1-this.config.trailGivebackPct/100));
      }
      const sig=signalMap.get(address),hardSafety=REQUIRED_SAFETY.some(k=>tokenState?.[address]?.safety?.[k]==='FAIL');
      let reason=null;
      if(sig&&HARD_EXIT_STATES.has(sig.state))reason=`signal_${String(sig.state).toLowerCase()}`;
      else if(hardSafety)reason='critical_safety_fail';
      else if(price<=Number(p.stopPriceUsd||0))reason='risk_stop';
      if(reason){const trade=this.closePosition(s,address,price,tokenState,reason,now,sig?.state);if(trade)runTrades.push(trade);}
    }

    const candidates=[...(tacticalSignals||[])].filter(x=>x?.tokenAddress).sort((a,b)=>Number(b.score||0)-Number(a.score||0));
    for(const signal of candidates){
      const address=lower(signal.tokenAddress),price=this.statePrice(tokenState,address);
      if(!price||s.positions[address])continue;
      let setup=s.setups[address];
      if(setup&&now>Date.parse(setup.expiresAt||0)){setup.status='EXPIRED';setup.updatedAt=iso(now);}
      if(signal.state==='BLOCKED'||signal.state==='DISTRIBUTION'){
        if(setup&&setup.status!=='ENTERED'){setup.status='CANCELLED';setup.cancelReason=`signal_${String(signal.state).toLowerCase()}`;setup.updatedAt=iso(now);}continue;
      }
      if(ENTRY_STATES.has(signal.state)&&(!setup||['EXPIRED','CANCELLED','INVALID'].includes(setup.status))){setup=this.createSetup(signal,price,now);s.setups[address]=setup;}
      if(!setup||setup.status==='ENTERED'||setup.status==='EXPIRED'||setup.status==='CANCELLED')continue;
      setup.highWaterPriceUsd=Math.max(Number(setup.highWaterPriceUsd)||price,price);setup.updatedAt=iso(now);

      const orbit={status:'PASS',reason:cycleMap.has(address)?'cycle_and_tactical_candidate':'tactical_candidate'};
      const signalAgent={status:ENTRY_STATES.has(signal.state)?'PASS':'WAIT',reason:`radar_${String(signal.state||'unknown').toLowerCase()}`};
      const atlas=this.atlas(tokenState,address,now);
      const sentinel=this.sentinel(tokenState,address);
      const vector={status:'PASS',reason:'setup_defined',referencePriceUsd:round(setup.referencePriceUsd,12),invalidationPriceUsd:round(setup.invalidationPriceUsd,12),expiresAt:setup.expiresAt};
      const pulse=this.pulse(setup,price,signal.state,now);
      if(pulse.status==='INVALID'){setup.status='INVALID';setup.cancelReason=pulse.reason;setup.updatedAt=iso(now);}
      const anchor=this.anchor(s,tokenState,address);
      const approved=signalAgent.status==='PASS'&&atlas.status==='PASS'&&sentinel.status==='PASS'&&vector.status==='PASS'&&pulse.status==='PASS'&&anchor.status==='PASS';
      const fuse={status:approved?'APPROVE':'WAIT',reason:approved?'all_required_gates_pass':'one_or_more_gates_not_pass'};
      const decision={
        id:`shadow-decision-${now}-${address}`,at:iso(now),tokenAddress:address,symbol:signal.symbol||signal.ticker||setup.symbol,
        marketPriceUsd:round(price,12),signalState:signal.state,score:Number.isFinite(Number(signal.score))?round(signal.score):null,
        cyclePotential:Number.isFinite(Number(cycleMap.get(address)?.cyclePotential))?round(cycleMap.get(address).cyclePotential):null,
        agents:{ORBIT:orbit,SIGNAL:signalAgent,ATLAS:atlas,SENTINEL:sentinel,VECTOR:vector,PULSE:pulse,ANCHOR:anchor,FUSE:fuse}
      };
      s.decisions.unshift(decision);
      if(approved&&!s.positions[address]){const trade=this.openPosition(s,setup,price,anchor.sizeUsd,tokenState,now,signal.state);runTrades.push(trade);decision.tradeId=trade.id;decision.agents.LEDGER={status:'OPENED',reason:'paper_position_recorded'};}
      else decision.agents.LEDGER={status:'WATCH',reason:s.positions[address]?'position_already_open':'no_approved_execution'};
      decision.agents.COMMANDER={status:'RECORDED',reason:'shadow_policy_cycle_complete'};
    }

    const eq=this.equity(s,tokenState);
    s.lastRunAt=iso(now);
    s.equityHistory.push({at:iso(now),equityUsd:eq.equityUsd,cashUsd:round(s.cashUsd),positionsValueUsd:eq.positionsValueUsd});
    s.trades=s.trades.slice(0,this.config.maxTradeHistory);
    s.decisions=s.decisions.slice(0,this.config.maxDecisionHistory);
    s.equityHistory=s.equityHistory.slice(-this.config.maxEquityHistory);
    return{state:s,snapshot:this.snapshot(s,tokenState,now),trades:runTrades};
  }

  snapshot(state,tokenState={},now=Date.now()){
    const s=this.normalize(state,now),eq=this.equity(s,tokenState);
    const initial=Number(s.initialBalanceUsd)||this.config.initialBalanceUsd;
    const totalPnl=eq.equityUsd-initial;
    const dailyStart=Number(s.daily?.startEquityUsd)||eq.equityUsd;
    const dailyLossPct=dailyStart>0?Math.max(0,(dailyStart-eq.equityUsd)/dailyStart*100):0;
    const positions=Object.entries(s.positions||{}).map(([address,p])=>{
      const price=this.statePrice(tokenState,address)||Number(p.lastPriceUsd)||Number(p.entryPriceUsd)||0;
      const value=Number(p.quantity||0)*price,pnl=value-Number(p.costUsd||0);
      return{...p,currentPriceUsd:round(price,12),valueUsd:round(value),unrealizedPnlUsd:round(pnl),returnPct:p.costUsd>0?round(pnl/p.costUsd*100):0};
    }).sort((a,b)=>b.valueUsd-a.valueUsd);
    const setups=Object.values(s.setups||{}).filter(x=>!['ENTERED','EXPIRED','CANCELLED','INVALID'].includes(x.status)).sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0));
    return{
      generatedAt:iso(now),version:1,mode:'SHADOW',execution:'PAPER_ONLY',lastRunAt:s.lastRunAt,
      bankroll:{initialBalanceUsd:round(initial),cashUsd:round(s.cashUsd),equityUsd:eq.equityUsd,positionsValueUsd:eq.positionsValueUsd,realizedPnlUsd:round(s.realizedPnlUsd),unrealizedPnlUsd:eq.unrealizedPnlUsd,totalPnlUsd:round(totalPnl),totalReturnPct:initial>0?round(totalPnl/initial*100):0},
      risk:{maxDailyLossPct:this.config.maxDailyLossPct,dailyLossPct:round(dailyLossPct),maxPositionPct:this.config.maxPositionPct,riskPerTradePct:this.config.riskPerTradePct,maxOpenPositions:this.config.maxOpenPositions,openPositions:positions.length},
      positions,setups:setups.slice(0,20),recentTrades:s.trades.slice(0,30),recentDecisions:s.decisions.slice(0,30),
      agents:[
        {id:'ORBIT',task:'discovery'},{id:'SIGNAL',task:'onchain + social confirmation'},{id:'ATLAS',task:'data freshness'},
        {id:'SENTINEL',task:'safety gate'},{id:'VECTOR',task:'entry conditions'},{id:'PULSE',task:'pullback timing'},
        {id:'ANCHOR',task:'position sizing'},{id:'FUSE',task:'final approval'},{id:'LEDGER',task:'paper portfolio'},{id:'COMMANDER',task:'session control'}
      ]
    };
  }
}

module.exports=ShadowDesk;
module.exports.ENTRY_STATES=ENTRY_STATES;
module.exports.REQUIRED_SAFETY=REQUIRED_SAFETY;

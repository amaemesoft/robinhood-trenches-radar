'use strict';

const Auditor=require('./shadowAuditor');
const crypto=require('node:crypto');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const Engine=require('./engine');
const positive=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0;
const exact=x=>/^0x[0-9a-f]{40}$/.test(x||'');
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
      version:2,mode:'SHADOW',createdAt:iso(now),lastRunAt:null,
      initialBalanceUsd:start,cashUsd:start,realizedPnlUsd:0,
      positions:{},setups:{},trades:[],decisions:[],equityHistory:[],audits:{},auditCohorts:{},decisionSignatures:{},counters:{decisions:0,entries:0,exits:0,blocked:0},
      daily:{date:iso(now).slice(0,10),startEquityUsd:start}
    };
  }

  normalize(state,now=Date.now()){
    const base=this.defaultState(now);
    if(!state||typeof state!=='object')return base;
    return{
      ...base,...structuredClone(state),version:2,mode:'SHADOW',
      positions:structuredClone(state.positions||{}),setups:structuredClone(state.setups||{}),
      trades:structuredClone(state.trades||[]),decisions:structuredClone(state.decisions||[]),
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
    const observed=Date.parse(st.marketObservedAt||st.observedAt||'');
    const age=Number.isFinite(observed)?now-observed:Infinity;
    const price=Number(st.priceUsd);
    const pass=st.contractExists===true&&(!st.chainId||st.chainId===4663)&&Number.isFinite(price)&&price>0&&age>=0&&age<=this.config.maxDataAgeMs;
    return{status:pass?'PASS':'REVIEW',ageSeconds:Number.isFinite(age)?Math.round(age/1000):null,reason:pass?'fresh_market_state':'stale_or_missing_market_state'};
  }

  sentinel(tokenState,address){
    const st=tokenState?.[address]||{};
    const safety=st.safety||{},execution=st.execution||{};
    const critical=REQUIRED_SAFETY.map(k=>[k,safety[k]||'UNKNOWN']);
    const safetyPass=critical.every(([,v])=>v==='PASS');
    const exitPass=execution.exitQuoteStatus==='PASS';
    const impact=execution.sellImpactPct==null||execution.sellImpactPct===''?NaN:Number(execution.sellImpactPct);
    const impactPass=Number.isFinite(impact)&&impact>=0&&impact<=this.config.maxSellImpactPct;
    const pass=safetyPass&&exitPass&&impactPass;
    return{
      status:pass?'PASS':'BLOCK',reason:pass?'safety_and_exit_pass':!safetyPass?'critical_safety_not_pass':!exitPass?'exit_quote_not_pass':'sell_impact_too_high',
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
    const exitTarget=Number(execution.exitabilityTargetUsd);
    const liquidity=Number(execution.liquidityUsd);
    if(!positive(execution.exitabilityTargetUsd)||!positive(execution.liquidityUsd))return{status:'BLOCK',reason:'missing_liquidity_or_quote_size',sizeUsd:0};
    const pctCap=eq.equityUsd*(this.config.maxPositionPct/100);
    const riskCap=eq.equityUsd*(this.config.riskPerTradePct/100)/(this.config.stopLossPct/100);
    const size=Math.max(0,Math.min(Number(state.cashUsd||0),pctCap,riskCap,exitTarget,liquidity*0.001));
    if(size<this.config.minPositionUsd)return{status:'BLOCK',reason:'position_below_minimum',sizeUsd:round(size),dailyLossPct:round(dailyLossPct)};
    return{status:'PASS',reason:'risk_budget_available',sizeUsd:round(size),dailyLossPct:round(dailyLossPct),exitabilityTargetUsd:round(exitTarget)};
  }

  createSetup(signal,price,now){
    const address=lower(signal.tokenAddress);
    return{
      id:`setup-${now}-${address}`,chainId:4663,tokenAddress:address,symbol:signal.symbol||signal.ticker||address.slice(0,8),createdAt:iso(now),updatedAt:iso(now),status:'WAIT_PULLBACK',
      referencePriceUsd:price,highWaterPriceUsd:price,invalidationPriceUsd:round(price*(1-this.config.maxPullbackPct/100),12),
      minPullbackPct:this.config.minPullbackPct,maxPullbackPct:this.config.maxPullbackPct,expiresAt:iso(now+this.config.setupExpiryMs)
    };
  }

  pulse(setup,price,signalState,now){
    if(!setup)return{status:'WAIT',reason:'no_vector_setup'};
    if(price>Number(setup.referencePriceUsd)*2)return{status:'WAIT',reason:'do_not_chase_reference_multiple'};
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
    const slip=Number(tokenState[address].execution.sellImpactPct);
    const fill=price*(1-slip/100);
    const proceeds=Number(p.quantity||0)*fill;
    const pnl=proceeds-Number(p.costUsd||0);
    state.cashUsd=round(Number(state.cashUsd||0)+proceeds,8);
    state.realizedPnlUsd=round(Number(state.realizedPnlUsd||0)+pnl,8);
    delete state.positions[address];
    if(state.setups[address])state.setups[address].status='CLOSED';
    const trade={id:`shadow-exit-${now}-${address}`,side:'SELL_SHADOW',chainId:4663,positionId:p.id,entryDecisionId:p.decisionId,entryAt:p.openedAt,entryPriceUsd:p.entryPriceUsd,costUsd:p.costUsd,stopPriceUsd:p.stopPriceUsd,exitConditions:p.exitConditions,tokenAddress:address,symbol:p.symbol,at:iso(now),reason,signalState:signalState||null,priceUsd:round(price,12),fillPriceUsd:round(fill,12),slippagePct:slip,quantity:p.quantity,proceedsUsd:round(proceeds),pnlUsd:round(pnl),returnPct:p.costUsd>0?round(pnl/p.costUsd*100):0};
    state.trades.unshift(trade);
    return trade;
  }

  openPosition(state,setup,price,sizeUsd,tokenState,now,signalState){
    const address=setup.tokenAddress,slip=this.slippagePct(tokenState,address);
    const fill=price*(1+slip/100),qty=sizeUsd/fill;
    state.cashUsd=round(Number(state.cashUsd||0)-sizeUsd,8);
    state.positions[address]={
      id:`position-${now}-${address}`,chainId:4663,setupId:setup.id,tokenAddress:address,symbol:setup.symbol,openedAt:iso(now),signalState,entryPriceUsd:round(fill,12),marketPriceAtEntryUsd:round(price,12),
      quantity:qty,costUsd:round(sizeUsd),lastPriceUsd:round(price,12),highWaterPriceUsd:round(price,12),
      stopPriceUsd:round(fill*(1-this.config.stopLossPct/100),12),slippagePct:slip,fillModel:'market_plus_exit_impact_proxy',invalidationPriceUsd:setup.invalidationPriceUsd,exitConditions:['risk_stop','trailing_stop','distribution','critical_safety_fail'],status:'OPEN'
    };
    setup.status='ENTERED';setup.enteredAt=iso(now);setup.updatedAt=iso(now);
    const trade={id:`shadow-entry-${now}-${address}`,side:'BUY_SHADOW',chainId:4663,positionId:state.positions[address].id,setupId:setup.id,invalidationPriceUsd:setup.invalidationPriceUsd,stopPriceUsd:state.positions[address].stopPriceUsd,exitConditions:state.positions[address].exitConditions,fillModel:'market_plus_exit_impact_proxy',tokenAddress:address,symbol:setup.symbol,at:iso(now),reason:'fuse_approved_after_pullback',signalState,priceUsd:round(price,12),fillPriceUsd:round(fill,12),slippagePct:slip,quantity:qty,costUsd:round(sizeUsd)};
    state.trades.unshift(trade);
    return trade;
  }

  signalGate(signal,actors,now){
    const events=(signal.events||[]).filter(e=>['BUY','ADD','REENTRY'].includes(e.action)&&Date.parse(e.at)<=now&&Date.parse(e.at)>=now-86400000&&
      (!e.receivedAt||Date.parse(e.receivedAt)<=now)&&e.tokenAddress?.toLowerCase()===signal.tokenAddress.toLowerCase()&&
      (e.txHash||/^0x[0-9a-f]{64}:/i.test(e.key||''))&&
      actors[e.actorId]?.kind==='money'&&['verified','strong'].includes(actors[e.actorId]?.identityConfidence)&&actors[e.actorId]?.enabled!==false);
    const normalized=events.map(e=>({...e,txHash:e.txHash||e.key.split(':')[0],independenceCluster:actors[e.actorId]?.evmAddress||e.independenceCluster}));
    const independent=Engine.independentActors(normalized);
    const chase=Number(signal.chaseMultiple)>2||signal.state==='DO_NOT_CHASE';
    const pass=ENTRY_STATES.has(signal.state)&&independent.length>=2&&!chase;
    return{status:pass?'PASS':'WAIT',reason:chase?'do_not_chase':independent.length<2?'needs_two_verified_economic_actors':`radar_${String(signal.state).toLowerCase()}`,economicActors:independent.map(e=>e.actorId),socialScouts:(signal.events||[]).filter(e=>e.action==='SCOUT'&&Date.parse(e.at)<=now).map(e=>e.key)};
  }

  run({state,tacticalSignals=[],cycleMemes=[],tokenState={},actors={},now=Date.now()}={}){
    const s=this.normalize(state,now),journal=[],runTrades=[],auditUpdates=[];
    tokenState=Object.fromEntries(Object.entries(tokenState).map(([a,m])=>[a,Date.parse(m.marketObservedAt||m.observedAt||'')>now?{...m,priceUsd:null}:m]));
    // Repeated runs in overlapping deployments cannot evaluate the same time twice.
    if(Date.parse(s.lastRunAt||'')>=now)return{state:s,snapshot:this.snapshot(s,tokenState,now),trades:[],journal:[],auditUpdates:[]};
    const signalMap=new Map(tacticalSignals.filter(x=>exact(lower(x?.tokenAddress))).map(x=>[lower(x.tokenAddress),x]));
    const cycleMap=new Map(cycleMemes.filter(x=>exact(lower(x?.tokenAddress))).map(x=>[lower(x.tokenAddress),x]));
    const record=d=>{
      d.kind='decision';d.chainId=4663;d.policyVersion=2;d.policy=structuredClone(this.config);
      const market=tokenState[d.tokenAddress]||{};
      d.evidence={observedAt:market.marketObservedAt||market.observedAt||null,safetyEvaluatedAt:market.safetyEvidence?.evaluatedAt||null,
        market:structuredClone(market),events:structuredClone((signalMap.get(d.tokenAddress)?.events||[]).filter(e=>Date.parse(e.at)<=now&&(!e.receivedAt||Date.parse(e.receivedAt)<=now))),
        actors:Object.fromEntries(Object.entries(actors).filter(([id])=>(signalMap.get(d.tokenAddress)?.events||[]).some(e=>e.actorId===id)))};
      d.agents.COMMANDER={status:'RECORDED',reason:'cannot_override_required_gates'};
      const signature=crypto.createHash('sha256').update(JSON.stringify(canonical({decision:d.decision,setupId:d.setupId,evidence:d.evidence,
        agents:Object.fromEntries(Object.entries(d.agents).map(([n,a])=>[n,{...a,ageSeconds:undefined}]))}))).digest('hex');
      s.counters.evaluations=(s.counters.evaluations||0)+1;
      if(!['ENTRY','EXIT'].includes(d.decision)&&s.decisionSignatures[d.tokenAddress]===signature)return;
      s.decisionSignatures[d.tokenAddress]=signature;
      s.decisions.unshift(d);journal.push(d);s.counters.decisions++;
      if(d.decision==='BLOCK')s.counters.blocked++;
      // One observational cohort per token/outcome/day, plus every trade/setup change.
      const cohort=d.setupId||`${d.tokenAddress}:${d.decision}:${iso(now).slice(0,10)}`;
      if(!s.auditCohorts[cohort]||d.decision==='ENTRY'||d.decision==='EXIT'){
        const audit=Auditor.register(d);s.audits[audit.id]=audit;s.auditCohorts[cohort]=audit.id;auditUpdates.push(audit);
      }
    };
    const today=iso(now).slice(0,10);
    if(s.daily.date!==today)s.daily={date:today,startEquityUsd:this.equity(s,tokenState).equityUsd};
    const exited=new Set();
    for(const [address,p] of Object.entries(s.positions)){
      const price=this.statePrice(tokenState,address),atlas=this.atlas(tokenState,address,now),sentinel=this.sentinel(tokenState,address),sig=signalMap.get(address);
      const hardSafety=REQUIRED_SAFETY.some(k=>tokenState[address]?.safety?.[k]==='FAIL');
      if(atlas.status==='PASS'){
        p.lastPriceUsd=price;p.lastObservedAt=tokenState[address].marketObservedAt||tokenState[address].observedAt;
        p.highWaterPriceUsd=Math.max(p.highWaterPriceUsd,price);
        if(p.highWaterPriceUsd>=p.entryPriceUsd*(1+this.config.trailArmPct/100))p.stopPriceUsd=Math.max(p.stopPriceUsd,p.highWaterPriceUsd*(1-this.config.trailGivebackPct/100));
      }
      let reason=p.pendingExitReason||null;
      if(sig&&HARD_EXIT_STATES.has(sig.state))reason=`signal_${sig.state.toLowerCase()}`;
      else if(hardSafety)reason='critical_safety_fail';
      else if(atlas.status==='PASS'&&price<=p.stopPriceUsd)reason='risk_stop';
      if(!reason){journal.push({id:`mark-${now}-${address}`,kind:'position_mark',at:iso(now),positionId:p.id,tokenAddress:address,priceUsd:price,atlas,stopPriceUsd:p.stopPriceUsd});continue;}
      p.pendingExitReason=reason;
      const execution=tokenState[address]?.execution||{};
      const quoteAge=now-Date.parse(tokenState[address]?.safetyEvidence?.evaluatedAt||tokenState[address]?.observedAt||'');
      const exitPossible=atlas.status==='PASS'&&execution.exitQuoteStatus==='PASS'&&execution.sellImpactPct!=null&&Number.isFinite(Number(execution.sellImpactPct))&&Number(execution.sellImpactPct)>=0&&Number(execution.sellImpactPct)<100&&quoteAge>=0&&quoteAge<=this.config.maxDataAgeMs&&positive(execution.exitabilityTargetUsd)&&p.quantity*price<=Number(execution.exitabilityTargetUsd);
      const d={id:`shadow-exit-decision-${now}-${address}`,at:iso(now),tokenAddress:address,symbol:p.symbol,setupId:p.setupId,decision:exitPossible?'EXIT':'BLOCK',reason:exitPossible?reason:'exit_unavailable_no_simulated_fill',marketPriceUsd:price,agents:{ATLAS:atlas,SENTINEL:sentinel,LEDGER:{status:exitPossible?'CLOSED':'EXIT_PENDING',reason}}};
      if(exitPossible){const trade=this.closePosition(s,address,price,tokenState,reason,now,sig?.state);trade.decisionId=d.id;trade.kind='trade';runTrades.push(trade);journal.push(trade);s.counters.exits++;exited.add(address);
        const audit=s.audits[p.decisionId];if(audit){audit.exitQuality={at:trade.at,returnPct:trade.returnPct,reason,givebackFromObservedHighPct:(p.highWaterPriceUsd-price)/p.highWaterPriceUsd*100};auditUpdates.push(audit);}
      }
      record(d);
    }
    for(const [address,signal] of signalMap){
      if(s.positions[address]||exited.has(address))continue;
      const price=this.statePrice(tokenState,address),atlas=this.atlas(tokenState,address,now),sentinel=this.sentinel(tokenState,address),signalAgent=this.signalGate(signal,actors,now);
      const safetyAge=now-Date.parse(tokenState[address]?.safetyEvidence?.evaluatedAt||tokenState[address]?.observedAt||'');
      if(!Number.isFinite(safetyAge)||safetyAge<0||safetyAge>this.config.maxDataAgeMs){sentinel.status='BLOCK';sentinel.reason='stale_or_future_safety_quote';}
      let setup=s.setups[address];
      if(setup&&now>=Date.parse(setup.expiresAt)){setup.status='EXPIRED';}
      if(setup&&HARD_EXIT_STATES.has(signal.state)){setup.status='CANCELLED';setup.cancelReason=signal.state;}
      if(signalAgent.status==='PASS'&&atlas.status==='PASS'&&sentinel.status==='PASS'&&(!setup||['CLOSED','CANCELLED','EXPIRED','INVALID'].includes(setup.status))){
        setup=this.createSetup(signal,price,now);s.setups[address]=setup;journal.push({...structuredClone(setup),kind:'setup',at:iso(now)});
      }
      const active=setup&&setup.status==='WAIT_PULLBACK';
      if(active&&atlas.status==='PASS')setup.highWaterPriceUsd=Math.max(setup.highWaterPriceUsd,price);
      const pulse=active&&atlas.status==='PASS'?this.pulse(setup,price,signal.state,now):{status:'WAIT',reason:active?'market_not_fresh':'no_active_setup'};
      if(pulse.status==='INVALID'){setup.status='INVALID';setup.cancelReason=pulse.reason;}
      const anchor=this.anchor(s,tokenState,address),vector={status:active?'PASS':'WAIT',reason:active?'setup_defined':'no_valid_setup',invalidationPriceUsd:setup?.invalidationPriceUsd||null};
      const approved=[signalAgent,atlas,sentinel,vector,pulse,anchor].every(x=>x.status==='PASS');
      const blocked=sentinel.status==='BLOCK'||anchor.status==='BLOCK'||signal.state==='BLOCKED';
      const agents={ORBIT:{status:'PASS',reason:cycleMap.has(address)?'cycle_and_tactical_observation':'tactical_observation'},SIGNAL:signalAgent,ATLAS:atlas,SENTINEL:sentinel,VECTOR:vector,PULSE:pulse,ANCHOR:anchor,FUSE:{status:approved?'APPROVE':blocked?'BLOCK':'WAIT',reason:approved?'all_gates_pass':'required_gate_not_pass'},LEDGER:{status:approved?'OPENED':'WATCH',reason:'paper_only'}};
      const d={id:`shadow-decision-${now}-${address}`,at:iso(now),tokenAddress:address,symbol:signal.symbol||signal.ticker||address,setupId:active?setup.id:null,decision:approved?'ENTRY':blocked?'BLOCK':'WAIT',score:signal.score||0,reason:approved?'all_gates_pass':Object.entries(agents).filter(([,a])=>['BLOCK','WAIT','REVIEW','INVALID'].includes(a.status)).map(([n,a])=>`${n}: ${a.reason}`).join('; '),marketPriceUsd:price,signalState:signal.state,agents};
      if(approved){const trade=this.openPosition(s,setup,price,anchor.sizeUsd,tokenState,now,signal.state);trade.decisionId=d.id;trade.kind='trade';s.positions[address].decisionId=d.id;runTrades.push(trade);journal.push(trade);s.counters.entries++;d.tradeId=trade.id;}
      record(d);
    }
    for(const [id,audit] of Object.entries(s.audits)){
      if(audit.status.startsWith('COMPLETE'))continue;
      const next=Auditor.observe(audit,tokenState[audit.tokenAddress],now);s.audits[id]=next;
      if(JSON.stringify(next)!==JSON.stringify(audit))auditUpdates.push(next);
      if(now-Date.parse(audit.at)>87300000){next.status=next.status==='COMPLETE'?'COMPLETE':'COMPLETE_WITH_GAPS';auditUpdates.push(next);}
    }
    const eq=this.equity(s,tokenState);s.lastRunAt=iso(now);
    s.equityHistory.push({at:iso(now),...eq,cashUsd:round(s.cashUsd)});
    s.trades=s.trades.slice(0,this.config.maxTradeHistory);s.decisions=s.decisions.slice(0,this.config.maxDecisionHistory);s.equityHistory=s.equityHistory.slice(-this.config.maxEquityHistory);
    // Durable journals retain every record; only the working cache is bounded.
    s.audits=Object.fromEntries(Object.entries(s.audits).filter(([,r])=>now-Date.parse(r.at)<2*86400000));
    s.auditCohorts=Object.fromEntries(Object.entries(s.auditCohorts).filter(([,id])=>s.audits[id]));
    return{state:s,snapshot:this.snapshot(s,tokenState,now),trades:runTrades,journal,auditUpdates};
  }

  snapshot(state,tokenState={},now=Date.now()){
    tokenState=Object.fromEntries(Object.entries(tokenState).map(([a,m])=>[a,Date.parse(m.marketObservedAt||m.observedAt||'')>now?{...m,priceUsd:null}:m]));
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
      generatedAt:iso(now),createdAt:s.createdAt,counters:s.counters,auditor:Auditor.summarize(Object.values(s.audits||{})),generatedBy:'deterministic_policy_pipeline',version:2,mode:'SHADOW',execution:'PAPER_ONLY',lastRunAt:s.lastRunAt,
      bankroll:{initialBalanceUsd:round(initial),cashUsd:round(s.cashUsd),equityUsd:eq.equityUsd,positionsValueUsd:eq.positionsValueUsd,realizedPnlUsd:round(s.realizedPnlUsd),unrealizedPnlUsd:eq.unrealizedPnlUsd,totalPnlUsd:round(totalPnl),totalReturnPct:initial>0?round(totalPnl/initial*100):0},
      risk:{maxDailyLossPct:this.config.maxDailyLossPct,dailyLossPct:round(dailyLossPct),maxPositionPct:this.config.maxPositionPct,riskPerTradePct:this.config.riskPerTradePct,maxOpenPositions:this.config.maxOpenPositions,openPositions:positions.length},
      positions,setups:setups.slice(0,20),recentTrades:s.trades.slice(0,30),recentDecisions:[...s.decisions].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||(b.score||0)-(a.score||0)).slice(0,30),
      agents:[
        {id:'ORBIT',task:'discovery'},{id:'SIGNAL',task:'onchain + social confirmation'},{id:'ATLAS',task:'data freshness'},
        {id:'SENTINEL',task:'safety gate'},{id:'VECTOR',task:'entry conditions'},{id:'PULSE',task:'pullback timing'},
        {id:'ANCHOR',task:'position sizing'},{id:'FUSE',task:'final approval'},{id:'LEDGER',task:'paper portfolio'},{id:'COMMANDER',task:'session control'},{id:'AUDITOR',task:'post-decision observer; no gate authority'}
      ]
    };
  }
}

module.exports=ShadowDesk;
module.exports.ENTRY_STATES=ENTRY_STATES;
module.exports.REQUIRED_SAFETY=REQUIRED_SAFETY;

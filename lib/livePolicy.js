'use strict';

const CHAIN_ID=4663;
const CHAIN_ID_HEX='0x1237';
const WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const UNISWAP_V3_FACTORY='0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const QUOTER_V2='0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7';
const SWAP_ROUTER_02='0xcaf681a66d020601342297493863e78c959e5cb2';
const SELECTORS={
  exactInputSingle:'0x04e45aaf',
  approve:'0x095ea7b3',
  withdraw:'0x2e1a7d4d'
};
const REQUIRED_SAFETY=['tokenControl','upgradeAuthority','canonicalLp','sellRestriction'];
const exactAddress=value=>/^0x[0-9a-f]{40}$/.test(String(value||'').toLowerCase());
const positiveBigInt=value=>{try{return BigInt(value)>0n}catch{return false}};
const envBigInt=(value,fallback)=>{try{const n=BigInt(value||fallback);return n>0n?n:BigInt(fallback)}catch{return BigInt(fallback)}};
const envNumber=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback};

class LivePolicy{
  constructor(options={}){
    this.config={
      chainId:CHAIN_ID,
      pilotBankrollWei:envBigInt(options.pilotBankrollWei??process.env.LIVE_PILOT_BANKROLL_WEI,'5000000000000000'),
      sessionSpendWei:envBigInt(options.sessionSpendWei??process.env.LIVE_SESSION_SPEND_WEI,'4000000000000000'),
      maxEntryWei:envBigInt(options.maxEntryWei??process.env.LIVE_MAX_ENTRY_WEI,'1000000000000000'),
      validationEntryWei:envBigInt(options.validationEntryWei??process.env.LIVE_VALIDATION_ENTRY_WEI,'100000000000000'),
      dailyLossWei:envBigInt(options.dailyLossWei??process.env.LIVE_DAILY_LOSS_WEI,'1500000000000000'),
      gasReserveWei:envBigInt(options.gasReserveWei??process.env.LIVE_GAS_RESERVE_WEI,'500000000000000'),
      maxOpenPositions:Math.max(1,Math.floor(envNumber(options.maxOpenPositions??process.env.LIVE_MAX_OPEN_POSITIONS,1))),
      quoteTtlMs:envNumber(options.quoteTtlMs??process.env.LIVE_QUOTE_TTL_MS,20000),
      evidenceTtlMs:envNumber(options.evidenceTtlMs??process.env.LIVE_EVIDENCE_TTL_MS,180000),
      decisionTtlMs:envNumber(options.decisionTtlMs??process.env.LIVE_DECISION_TTL_MS,180000),
      slippageBps:Math.min(500,Math.max(10,Math.floor(envNumber(options.slippageBps??process.env.LIVE_SLIPPAGE_BPS,300)))),
      stopLossBps:Math.min(5000,Math.max(100,Math.floor(envNumber(options.stopLossBps??process.env.LIVE_STOP_LOSS_BPS,1200)))),
      trailArmBps:Math.min(10000,Math.max(100,Math.floor(envNumber(options.trailArmBps??process.env.LIVE_TRAIL_ARM_BPS,3500)))),
      trailGivebackBps:Math.min(9000,Math.max(100,Math.floor(envNumber(options.trailGivebackBps??process.env.LIVE_TRAIL_GIVEBACK_BPS,1800)))),
      sessionDays:Math.min(30,Math.max(1,Math.floor(envNumber(options.sessionDays??process.env.LIVE_SESSION_DAYS,7)))),
      allowed:String(options.allowed??process.env.LIVE_EXECUTION_ALLOWED??'false').toLowerCase()==='true',
      ownerAddress:exactAddress(options.ownerAddress??process.env.LIVE_OWNER_ADDRESS)?String(options.ownerAddress??process.env.LIVE_OWNER_ADDRESS).toLowerCase():null
    };
    if(this.config.validationEntryWei>this.config.maxEntryWei)this.config.validationEntryWei=this.config.maxEntryWei;
    if(this.config.sessionSpendWei>this.config.pilotBankrollWei)this.config.sessionSpendWei=this.config.pilotBankrollWei;
  }

  publicConfig(){
    const c=this.config;
    return{
      chainId:c.chainId,
      accountArchitecture:'DEDICATED_SMART_ACCOUNT',
      pilotBankrollWei:c.pilotBankrollWei.toString(),
      sessionSpendWei:c.sessionSpendWei.toString(),
      maxEntryWei:c.maxEntryWei.toString(),
      validationEntryWei:c.validationEntryWei.toString(),
      dailyLossWei:c.dailyLossWei.toString(),
      gasReserveWei:c.gasReserveWei.toString(),
      maxOpenPositions:c.maxOpenPositions,
      slippageBps:c.slippageBps,
      stopLossBps:c.stopLossBps,
      trailArmBps:c.trailArmBps,
      trailGivebackBps:c.trailGivebackBps,
      sessionDays:c.sessionDays,
      liveExecutionAllowed:c.allowed,
      ownerLocked:c.ownerAddress!=null,
      factory:UNISWAP_V3_FACTORY,
      router:SWAP_ROUTER_02,
      quoter:QUOTER_V2,
      weth:WETH
    };
  }

  validateOwner(address){
    const owner=String(address||'').toLowerCase();
    if(!exactAddress(owner))return{ok:false,reason:'invalid_owner'};
    if(this.config.ownerAddress&&owner!==this.config.ownerAddress)return{ok:false,reason:'owner_not_authorized'};
    return{ok:true,owner};
  }

  permissions(){
    return[
      {type:'native-token-transfer',data:{allowance:`0x${this.config.sessionSpendWei.toString(16)}`}},
      {type:'erc20-token-transfer',data:{address:WETH,allowance:`0x${this.config.sessionSpendWei.toString(16)}`}},
      {type:'gas-limit',data:{limit:'0x7a1200'}},
      {type:'functions-on-contract',data:{address:SWAP_ROUTER_02,functions:[SELECTORS.exactInputSingle]}},
      {type:'functions-on-contract',data:{address:WETH,functions:[SELECTORS.approve,SELECTORS.withdraw]}},
      // Token contracts are not known until a signal resolves an exact contract. This
      // selector is needed only to approve the verified router for the exact live
      // position amount; the executor validates both spender and amount again.
      {type:'functions-on-all-contracts',data:{functions:[SELECTORS.approve]}}
    ];
  }

  validateEntry({decision,signal,tokenState,now=Date.now(),amountWei}={}){
    const address=String(decision?.tokenAddress||'').toLowerCase();
    if(!this.config.allowed)return{ok:false,reason:'live_execution_not_allowed'};
    if(!exactAddress(address)||address===WETH)return{ok:false,reason:'invalid_exact_contract'};
    if(typeof decision?.id!=='string'||!decision.id.trim())return{ok:false,reason:'missing_decision_id'};
    if(decision?.decision!=='ENTRY')return{ok:false,reason:'shadow_decision_not_entry'};
    const decisionAge=now-Date.parse(decision.at||'');
    if(!Number.isFinite(decisionAge)||decisionAge<0||decisionAge>this.config.decisionTtlMs)return{ok:false,reason:'stale_entry_decision'};
    if(!['ENTRY_CANDIDATE','HIGH_CONFLUENCE'].includes(signal?.state))return{ok:false,reason:'current_signal_not_entry'};
    if(String(signal?.tokenAddress||'').toLowerCase()!==address)return{ok:false,reason:'signal_contract_mismatch'};
    const chaseMultiple=Number(signal?.chaseMultiple);
    if(!Number.isFinite(chaseMultiple)||chaseMultiple<=0)return{ok:false,reason:'missing_chase_evidence'};
    if(chaseMultiple>2||signal?.state==='DO_NOT_CHASE')return{ok:false,reason:'do_not_chase'};
    const st=tokenState?.[address]||{};
    if(st.contractExists!==true||Number(st.chainId||CHAIN_ID)!==CHAIN_ID)return{ok:false,reason:'contract_or_chain_not_verified'};
    if(!REQUIRED_SAFETY.every(key=>st.safety?.[key]==='PASS'))return{ok:false,reason:'critical_safety_not_pass'};
    if(st.execution?.exitQuoteStatus!=='PASS')return{ok:false,reason:'exit_quote_not_pass'};
    const impact=Number(st.execution?.sellImpactPct);
    if(!Number.isFinite(impact)||impact<0||impact>10)return{ok:false,reason:'sell_impact_out_of_bounds'};
    if(!(Number.isFinite(Number(st.priceUsd))&&Number(st.priceUsd)>0))return{ok:false,reason:'missing_market_price'};
    const marketAge=now-Date.parse(st.marketObservedAt||'');
    if(!Number.isFinite(marketAge)||marketAge<0||marketAge>this.config.evidenceTtlMs)return{ok:false,reason:'stale_market_evidence'};
    const safetyAge=now-Date.parse(st.safetyEvidence?.evaluatedAt||'');
    if(!Number.isFinite(safetyAge)||safetyAge<0||safetyAge>this.config.evidenceTtlMs)return{ok:false,reason:'stale_safety_evidence'};
    if(st.safetyEvidence?.marketPairMatches!==true)return{ok:false,reason:'market_pair_not_canonical'};
    if(!Number.isInteger(Number(st.safetyEvidence?.poolFee))||Number(st.safetyEvidence.poolFee)<=0)return{ok:false,reason:'missing_verified_pool_fee'};
    if(!positiveBigInt(amountWei)||BigInt(amountWei)>this.config.maxEntryWei)return{ok:false,reason:'entry_size_out_of_policy'};
    const requiredAgents=['SIGNAL','ATLAS','SENTINEL','VECTOR','PULSE','ANCHOR'];
    if(!requiredAgents.every(name=>decision.agents?.[name]?.status==='PASS')||decision.agents?.FUSE?.status!=='APPROVE')return{ok:false,reason:'entry_gates_not_pass'};
    return{ok:true,reason:'all_live_entry_gates_pass',address,poolFee:Number(st.safetyEvidence.poolFee)};
  }
}

module.exports={LivePolicy,CHAIN_ID,CHAIN_ID_HEX,WETH,UNISWAP_V3_FACTORY,QUOTER_V2,SWAP_ROUTER_02,SELECTORS,REQUIRED_SAFETY,exactAddress};

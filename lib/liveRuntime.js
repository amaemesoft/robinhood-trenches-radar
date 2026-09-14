'use strict';

const crypto=require('node:crypto');
const path=require('node:path');
const {LiveStore}=require('./liveStore');
const {LiveSwap}=require('./liveSwap');
const {WalletProofs}=require('./alchemyWallet');
const {CHAIN_ID,REQUIRED_SAFETY,WETH,UNISWAP_V3_FACTORY,QUOTER_V2,SWAP_ROUTER_02,exactAddress}=require('./livePolicy');

const iso=ms=>new Date(ms??Date.now()).toISOString();
const lower=value=>String(value||'').toLowerCase();
const hexBalance=value=>`0x${BigInt(value||0).toString(16)}`;
const contextHash=value=>value?crypto.createHash('sha256').update(String(value)).digest('hex'):null;
const decodedAddress=value=>/^0x[0-9a-f]{64}$/i.test(String(value||''))?`0x${String(value).slice(-40).toLowerCase()}`:null;
const callStatusCode=status=>Number(status?.statusCode??status?.status);
const pendingStatus=status=>callStatusCode(status)>=100&&callStatusCode(status)<200;
const failedStatus=status=>callStatusCode(status)>=400||status?.status==='failure';
const receiptSucceeded=receipt=>receipt?.status==='0x1'||receipt?.status==='success'||receipt?.status===1||receipt?.status===1n;
const proofActions={
  createAccount:'CREATE_OPERATIONAL_ACCOUNT',requestSession:'REQUEST_LIMITED_SESSION',testSession:'TEST_AUTONOMOUS_SESSION',
  arm:'ARM_LIMITED_AUTONOMY',pause:'STOP_AND_LIQUIDATE',reclaim:'PREPARE_OWNER_RECLAIM'
};

class LiveRuntime{
  constructor({storage,wallet,policy,rpc,getDb,getSignals,getShadowSnapshot,refreshToken,intervalMs=30000}={}){
    this.storage=storage;this.wallet=wallet;this.policy=policy;this.rpc=rpc;this.getDb=getDb;this.getSignals=getSignals;
    this.getShadowSnapshot=getShadowSnapshot;this.refreshToken=refreshToken;this.intervalMs=intervalMs;
    this.store=new LiveStore({pool:storage?.pool,filePath:path.join(__dirname,'../data/live-execution.json')});
    this.swap=new LiveSwap({rpc,policy});this.proofs=new WalletProofs();this.running=false;this.controlBusy=false;this.timer=null;this.startedAt=iso();this.lastError=null;
    this.infrastructure={verified:false,chainId:null,contracts:{weth:false,quoter:false,router:false},bindings:{wethDecimals:false,routerWeth:false,routerFactory:false,quoterFactory:false},checkedAt:null,error:null};
  }

  async init(){
    await this.store.init();
    if(this.wallet.ready()){
      const state=await this.store.state(),publicKey=await this.wallet.publicSessionAddress();
      if(state.permissionContext&&state.sessionPublicKey!==lower(publicKey))await this.store.patchState({
        state:'SESSION_SIGNER_MISMATCH',armed:false,killSwitch:true,sessionTested:false,permissionContext:null,lastError:'configured_session_signer_does_not_match_authorized_session'
      });
    }
    if(this.wallet.ready()&&this.policy.config.allowed)await this.verifyInfrastructure().catch(()=>{});
    const unavailable=!this.wallet.ready()||!this.policy.config.allowed||!this.infrastructure.verified;
    if(unavailable)await this.store.transactState(state=>state.armed?{
      ...state,
      state:!this.wallet.ready()?'SESSION_SIGNER_UNAVAILABLE':!this.policy.config.allowed?'LIVE_EXECUTION_DISABLED':'INFRASTRUCTURE_UNAVAILABLE',
      armed:false,killSwitch:true,
      lastError:!this.wallet.ready()?'session_signer_unavailable':!this.policy.config.allowed?'live_execution_disabled':'infrastructure_unavailable'
    }:state);
    await this.tick();
    this.timer=setInterval(()=>this.tick(),this.intervalMs);this.timer.unref?.();
  }

  stop(){if(this.timer)clearInterval(this.timer);}

  challenge({address,action,host}){
    if(!Object.values(proofActions).includes(action))throw Object.assign(new Error('unsupported authorization action'),{code:'INVALID_ACTION'});
    return this.proofs.issue({address,action,host});
  }

  async verifyProof(proof,action){
    const result=await this.proofs.verify({...proof,action});
    if(!result.ok)throw Object.assign(new Error(result.reason),{code:'OWNER_PROOF_INVALID'});
    return result.address;
  }

  async verifyInfrastructure(){
    const checkedAt=iso();
    try{
      const chainHex=await this.rpc('eth_chainId',[]),chainId=Number(BigInt(chainHex));
      if(chainId!==CHAIN_ID)throw Object.assign(new Error(`live RPC is on chain ${chainId}, expected ${CHAIN_ID}`),{code:'LIVE_CHAIN_MISMATCH'});
      const contracts={};
      for(const [name,address] of Object.entries({weth:WETH,quoter:QUOTER_V2,router:SWAP_ROUTER_02})){
        const code=await this.rpc('eth_getCode',[address,'latest']);
        contracts[name]=typeof code==='string'&&/^0x[0-9a-f]+$/i.test(code)&&code.length>4;
        if(!contracts[name])throw Object.assign(new Error(`${name} has no bytecode on Robinhood Chain`),{code:'LIVE_CONTRACT_MISSING'});
      }
      const call=async(to,data)=>this.rpc('eth_call',[{to,data},'latest']);
      const [wethDecimals,routerWeth,routerFactory,quoterFactory]=await Promise.all([
        call(WETH,'0x313ce567'),call(SWAP_ROUTER_02,'0x4aa4a4fc'),call(SWAP_ROUTER_02,'0xc45a0155'),call(QUOTER_V2,'0xc45a0155')
      ]);
      const bindings={
        wethDecimals:BigInt(wethDecimals)===18n,
        routerWeth:decodedAddress(routerWeth)===WETH,
        routerFactory:decodedAddress(routerFactory)===UNISWAP_V3_FACTORY,
        quoterFactory:decodedAddress(quoterFactory)===UNISWAP_V3_FACTORY
      };
      if(!Object.values(bindings).every(Boolean))throw Object.assign(new Error('Robinhood Uniswap contract bindings do not match the official deployment'),{code:'LIVE_CONTRACT_BINDING_MISMATCH'});
      this.infrastructure={verified:true,chainId,contracts,bindings,checkedAt,error:null};
      return this.infrastructure;
    }catch(error){
      this.infrastructure={verified:false,chainId:null,contracts:{weth:false,quoter:false,router:false},bindings:{wethDecimals:false,routerWeth:false,routerFactory:false,quoterFactory:false},checkedAt,error:this.cleanError(error)};
      throw error;
    }
  }

  async requireInfrastructure(){
    const stale=!this.infrastructure.checkedAt||Date.now()-Date.parse(this.infrastructure.checkedAt)>5*60*1000;
    if(!this.infrastructure.verified||stale)await this.verifyInfrastructure();
    if(!this.infrastructure.verified)throw Object.assign(new Error('live Robinhood/Uniswap infrastructure is unavailable'),{code:'LIVE_INFRASTRUCTURE_UNAVAILABLE'});
  }

  async assertNoUnresolvedExecution(state){
    const unresolved=(await this.store.recentOrders(200)).find(order=>['SUBMISSION_UNKNOWN','RECONCILIATION_ERROR'].includes(order.status)&&!order.resolvedAt);
    if(state?.state==='MANUAL_RECONCILIATION_REQUIRED'||unresolved)throw Object.assign(new Error('resolve the indeterminate live operation by reclaiming the operational account first'),{code:'LIVE_MANUAL_RECOVERY_REQUIRED'});
  }

  async requestAccount({proof}){
    const owner=await this.verifyProof(proof,proofActions.createAccount);
    await this.requireInfrastructure();
    const ownerPolicy=this.policy.validateOwner(owner);
    if(!ownerPolicy.ok)throw Object.assign(new Error(ownerPolicy.reason),{code:'OWNER_NOT_AUTHORIZED'});
    const existing=await this.store.state();
    if(existing.ownerAddress&&existing.ownerAddress!==owner)throw Object.assign(new Error('operational account is locked to another owner'),{code:'ACCOUNT_OWNER_LOCKED'});
    if(existing.ownerAddress===owner&&exactAddress(existing.accountAddress))return{
      ownerAddress:owner,accountAddress:existing.accountAddress,existing:true,
      funding:{to:existing.accountAddress,value:hexBalance(this.policy.config.pilotBankrollWei),chainId:4663}
    };
    const account=await this.wallet.requestSmartAccount(owner);
    await this.store.transactState(state=>({
      ...state,ownerAddress:owner,accountAddress:account.address,accountId:account.id,
      sessionPublicKey:null,pendingSession:null,pendingReclaim:null,permissionContext:null,sessionExpiresAt:null,
      state:'ACCOUNT_CREATED',fundingTxHash:null,sessionTested:false,roundTripValidated:false,armed:false,killSwitch:false,lastError:null
    }));
    return{ownerAddress:owner,accountAddress:account.address,funding:{to:account.address,value:hexBalance(this.policy.config.pilotBankrollWei),chainId:4663}};
  }

  async requestSession({proof}){
    const owner=await this.verifyProof(proof,proofActions.requestSession);
    await this.requireInfrastructure();
    const state=await this.store.state();
    await this.assertNoUnresolvedExecution(state);
    if(state.ownerAddress!==owner||!exactAddress(state.accountAddress))throw Object.assign(new Error('operational account not created for this owner'),{code:'ACCOUNT_NOT_READY'});
    if(state.armed)throw Object.assign(new Error('stop autonomy before replacing its session'),{code:'LIVE_RUNTIME_ARMED'});
    const balance=await this.swap.nativeBalance(state.accountAddress);
    if(balance<this.policy.config.pilotBankrollWei)throw Object.assign(new Error('fund the operational account before authorizing it'),{code:'ACCOUNT_NOT_FUNDED'});
    const expirySec=Math.floor(Date.now()/1000)+this.policy.config.sessionDays*86400;
    const result=await this.wallet.createSession({accountAddress:state.accountAddress,expirySec,permissions:this.policy.permissions()});
    if(!/^0x[0-9a-f]+$/i.test(result?.sessionId||'')||!result?.signatureRequest)throw Object.assign(new Error('Alchemy returned an invalid session request'),{code:'INVALID_SESSION_REQUEST'});
    const publicKey=await this.wallet.publicSessionAddress();
    await this.store.patchState({
      sessionPublicKey:publicKey,pendingSession:{sessionId:result.sessionId,signatureRequest:result.signatureRequest,expirySec},
      permissionContext:null,sessionExpiresAt:iso(expirySec*1000),state:'AWAITING_SESSION_SIGNATURE',sessionTested:false,armed:false,lastError:null,
      fundingVerifiedAt:iso(),fundingBalanceWei:balance.toString()
    });
    return{accountAddress:state.accountAddress,sessionPublicKey:publicKey,expirySec,signatureRequest:result.signatureRequest,policy:this.policy.publicConfig()};
  }

  async authorizeSession({ownerAddress,sessionId,signature}){
    const owner=lower(ownerAddress),state=await this.store.state(),pending=state.pendingSession;
    if(state.ownerAddress!==owner||pending?.sessionId!==sessionId)throw Object.assign(new Error('pending session does not match this owner'),{code:'SESSION_MISMATCH'});
    if(Number(pending.expirySec)<=Math.floor(Date.now()/1000)+3600)throw Object.assign(new Error('pending session expires too soon; request a new one'),{code:'SESSION_EXPIRING'});
    const valid=await this.wallet.verifySessionAuthorization({ownerAddress:owner,signatureRequest:pending.signatureRequest,signature});
    if(!valid)throw Object.assign(new Error('Phantom session signature is invalid'),{code:'INVALID_SESSION_SIGNATURE'});
    const context=this.wallet.permissionContext(sessionId,signature);
    await this.store.patchState({permissionContext:context,pendingSession:null,state:'SESSION_AUTHORIZED',sessionTested:false,armed:false,killSwitch:false,lastError:null});
    return{ok:true,state:'SESSION_AUTHORIZED',sessionExpiresAt:state.sessionExpiresAt};
  }

  async testSession({proof}){
    const owner=await this.verifyProof(proof,proofActions.testSession);
    await this.requireInfrastructure();
    const state=await this.store.state();
    await this.assertNoUnresolvedExecution(state);
    await this.assertOwnerSession(owner,state);
    const calls=[{to:WETH,value:'0',data:this.swap.approveData(SWAP_ROUTER_02,0)}];
    const order={
      id:`session-test-${crypto.randomUUID()}`,decisionId:`session-test-${Date.now()}`,side:'SESSION_TEST',tokenAddress:WETH,status:'SUBMITTING',at:iso(),calls,
      sessionContextHash:contextHash(state.permissionContext),sessionExpiresAt:state.sessionExpiresAt
    };
    await this.store.createOrder(order);
    try{
      const result=await this.wallet.execute({accountAddress:state.accountAddress,permissionContext:state.permissionContext,calls,onSubmitted:async callId=>this.store.updateOrder(order.id,{status:'SUBMITTED',callId,submittedAt:iso()})});
      const finalized=await this.finalizeOrder(order.id,result.status,null);
      if(finalized?.status!=='CONFIRMED')throw Object.assign(new Error('session test was not confirmed'),{code:'SESSION_TEST_NOT_CONFIRMED'});
      await this.applyConfirmedOrder(finalized);
      return{ok:true,state:'SESSION_TESTED',txHash:finalized.txHash};
    }catch(error){
      const current=(await this.store.recentOrders(200)).find(item=>item.id===order.id);
      if(current?.status==='SUBMITTED')await this.store.patchState({state:'SESSION_TEST_SUBMITTED',sessionTested:false,armed:false,killSwitch:true,lastError:this.cleanError(error)});
      else{
        if(!['FAILED','RECONCILIATION_ERROR'].includes(current?.status))await this.store.updateOrder(order.id,{status:'FAILED',failedAt:iso(),error:this.cleanError(error)});
        await this.store.patchState({state:'SESSION_ERROR',sessionTested:false,armed:false,killSwitch:true,lastError:this.cleanError(error)});
      }
      throw error;
    }
  }

  async arm({proof}){
    const owner=await this.verifyProof(proof,proofActions.arm);
    await this.requireInfrastructure();
    const state=await this.store.state();
    await this.assertNoUnresolvedExecution(state);
    await this.assertOwnerSession(owner,state);
    if(!this.policy.config.allowed)throw Object.assign(new Error('live execution is disabled by deployment policy'),{code:'LIVE_EXECUTION_DISABLED'});
    if(!state.sessionTested)throw Object.assign(new Error('autonomous session must pass its mainnet test first'),{code:'SESSION_NOT_TESTED'});
    if(Date.parse(state.sessionExpiresAt||'')<=Date.now()+3600000)throw Object.assign(new Error('session expires too soon'),{code:'SESSION_EXPIRING'});
    const start=new Date();start.setUTCHours(0,0,0,0);
    if(await this.store.realizedPnlSince(start.toISOString())<=-this.policy.config.dailyLossWei)throw Object.assign(new Error('the realized daily-loss stop is still active'),{code:'DAILY_LOSS_LIMIT'});
    await this.store.patchState({state:state.roundTripValidated?'AUTONOMOUS_LIMITED':'ARMED_FOR_ROUND_TRIP',armed:true,killSwitch:false,emergencyExitRequested:false,lastError:null,armedAt:iso()});
    queueMicrotask(()=>this.tick());
    return{ok:true,state:state.roundTripValidated?'AUTONOMOUS_LIMITED':'ARMED_FOR_ROUND_TRIP'};
  }

  async pause({proof}){
    const owner=await this.verifyProof(proof,proofActions.pause),state=await this.store.state();
    if(state.ownerAddress!==owner)throw Object.assign(new Error('owner mismatch'),{code:'OWNER_MISMATCH'});
    await this.store.patchState({state:'STOPPING',armed:false,killSwitch:true,emergencyExitRequested:true,stoppedAt:iso(),lastError:null});
    queueMicrotask(()=>this.tick());
    return{ok:true,state:'STOPPING',message:'new entries blocked; open positions queued for liquidation'};
  }

  async requestReclaim({proof,nativeOnly=false}){
    if(typeof nativeOnly!=='boolean')throw Object.assign(new Error('nativeOnly must be a boolean'),{code:'INVALID_RECLAIM_MODE'});
    const owner=await this.verifyProof(proof,proofActions.reclaim),state=await this.store.state();
    if(state.ownerAddress!==owner||!exactAddress(state.accountAddress))throw Object.assign(new Error('operational account does not belong to this owner'),{code:'OWNER_MISMATCH'});
    if(this.running||this.controlBusy)throw Object.assign(new Error('execution loop is busy; retry the reclaim after it settles'),{code:'RUNTIME_BUSY'});
    this.controlBusy=true;
    try{
      if((await this.store.pendingOrders()).some(order=>order.status==='SUBMITTED'||order.status==='SUBMITTING'))throw Object.assign(new Error('a live order must reconcile before reclaiming funds'),{code:'PENDING_LIVE_ORDER'});
      await this.store.patchState({state:'RECLAIM_PREPARING',pendingReclaim:null,armed:false,killSwitch:true,lastError:null});
      const balances=await this.swap.balances(state.accountAddress,null);
      let gasPrice=0n;try{gasPrice=BigInt(await this.rpc('eth_gasPrice',[]));}catch{}
      const estimated=gasPrice*800000n*2n,minReserve=50000000000000n,maxReserve=500000000000000n;
      const reserve=estimated<minReserve?minReserve:estimated>maxReserve?maxReserve:estimated;
      if(balances.liquidWei<=reserve)throw Object.assign(new Error('operational balance is too small to reclaim after gas reserve'),{code:'RECLAIM_BALANCE_TOO_LOW'});
      const amount=balances.liquidWei-reserve,calls=[],tokenTransfers=[];
      if(!nativeOnly){
        const recoveryTokens=new Map((await this.store.positions()).map(position=>[position.tokenAddress,{tokenAddress:position.tokenAddress,symbol:position.symbol||null}]));
        for(const order of await this.store.recentOrders(200)){
          if(['SUBMISSION_UNKNOWN','RECONCILIATION_ERROR'].includes(order.status)&&(order.side||'').endsWith('BUY')&&exactAddress(order.tokenAddress)){
            recoveryTokens.set(order.tokenAddress,{tokenAddress:order.tokenAddress,symbol:order.symbol||null});
          }
        }
        for(const token of recoveryTokens.values()){
          const balance=await this.swap.tokenBalance(token.tokenAddress,state.accountAddress);
          if(balance>0n){calls.push({to:token.tokenAddress,value:'0',data:this.swap.transferData(owner,balance)});tokenTransfers.push({...token,amountRaw:balance.toString()});}
        }
      }
      if(balances.wethWei>0n)calls.push({to:WETH,value:'0',data:this.swap.withdrawData(balances.wethWei)});
      calls.push({to:owner,value:amount.toString(),data:'0x'});
      const prepared=await this.wallet.prepareOwnerCalls({accountAddress:state.accountAddress,calls});
      const id=`reclaim-${crypto.randomUUID()}`,createdAt=iso();
      await this.store.patchState({
        state:'AWAITING_RECLAIM_SIGNATURE',pendingReclaim:{id,createdAt,nativeOnly,amountWei:amount.toString(),reserveWei:reserve.toString(),tokenTransfers,calls,prepared},
        armed:false,killSwitch:true,lastError:null
      });
      return{id,accountAddress:state.accountAddress,to:owner,nativeOnly,amountWei:amount.toString(),reserveWei:reserve.toString(),tokenTransfers,signatureRequest:prepared.signatureRequest};
    }catch(error){
      await this.store.patchState({state:'RECLAIM_ERROR',pendingReclaim:null,armed:false,killSwitch:true,lastError:this.cleanError(error)});throw error;
    }finally{this.controlBusy=false;}
  }

  async authorizeReclaim({ownerAddress,reclaimId,signature}){
    const owner=lower(ownerAddress),state=await this.store.state(),pending=state.pendingReclaim;
    if(state.ownerAddress!==owner||!pending||pending.id!==reclaimId||Date.now()-Date.parse(pending.createdAt)>5*60*1000)throw Object.assign(new Error('reclaim request is missing, mismatched or expired'),{code:'RECLAIM_MISMATCH'});
    if(this.running||this.controlBusy)throw Object.assign(new Error('execution loop is busy; retry the reclaim after it settles'),{code:'RUNTIME_BUSY'});
    const valid=await this.wallet.verifyOwnerSignature({ownerAddress:owner,signatureRequest:pending.prepared.signatureRequest,signature});
    if(!valid)throw Object.assign(new Error('Phantom reclaim signature is invalid'),{code:'INVALID_RECLAIM_SIGNATURE'});
    const before=await this.swap.balances(state.accountAddress,null);
    const order={
      id:`live-${crypto.randomUUID()}`,decisionId:pending.id,side:'RECLAIM',tokenAddress:WETH,symbol:'ETH',status:'SUBMITTING',at:iso(),
      reclaimId:pending.id,nativeOnly:pending.nativeOnly===true,calls:pending.calls,beforeBalances:Object.fromEntries(Object.entries(before).map(([key,value])=>typeof value==='bigint'?[key,value.toString()]:[key,value]))
    };
    await this.store.createOrder(order);this.controlBusy=true;
    try{
      const result=await this.wallet.sendOwnerPrepared({
        prepared:pending.prepared,signature,
        onSubmitted:async callId=>this.store.updateOrder(order.id,{status:'SUBMITTED',callId,submittedAt:iso()})
      });
      const finalized=await this.finalizeOrder(order.id,result.status,null);
      if(finalized?.status==='CONFIRMED')await this.applyConfirmedOrder(finalized);
      return{ok:finalized?.status==='CONFIRMED',state:(await this.store.state()).state,txHash:finalized?.txHash||null};
    }catch(error){
      const current=(await this.store.recentOrders(200)).find(item=>item.id===order.id);
      if(current?.status!=='SUBMITTED')await this.store.updateOrder(order.id,{status:'FAILED',failedAt:iso(),error:this.cleanError(error)});
      await this.store.patchState({state:current?.status==='SUBMITTED'?'RECLAIM_SUBMITTED':'RECLAIM_ERROR',armed:false,killSwitch:true,lastError:this.cleanError(error)});
      throw error;
    }finally{this.controlBusy=false;}
  }

  async assertOwnerSession(owner,state){
    if(state.ownerAddress!==owner||!exactAddress(state.accountAddress)||!state.permissionContext)throw Object.assign(new Error('limited session is not authorized for this owner'),{code:'SESSION_NOT_AUTHORIZED'});
    if(state.sessionPublicKey!==lower(await this.wallet.publicSessionAddress()))throw Object.assign(new Error('configured session signer does not match the authorized key'),{code:'SESSION_SIGNER_UNAVAILABLE'});
  }

  async status(ownerAddress){
    const state=await this.store.state(),owner=lower(ownerAddress),ownerAllowed=this.policy.validateOwner(owner).ok;
    const matches=ownerAllowed&&(!state.ownerAddress||state.ownerAddress===owner);
    if(!matches)return{
      generatedAt:iso(),mode:'NOT_AUTHORIZED',ownerMatches:false,state:{architecture:state.architecture,state:'OWNER_MISMATCH'},balances:null,
      policy:this.policy.publicConfig(),positions:[],orders:[],
      readiness:{walletApi:this.wallet.ready(),infrastructure:this.infrastructure.verified,smartAccount:false,funded:false,sessionAuthorized:false,sessionTested:false,roundTripValidated:false,armed:false,killSwitch:true,validEntryNow:false},
      infrastructure:this.infrastructure,
      runtime:{status:'LOCKED',startedAt:this.startedAt,lastError:null}
    };
    let balances=null;
    if(exactAddress(state.accountAddress))try{balances=await this.swap.balances(state.accountAddress,null);}catch{}
    const positions=await this.store.positions(),orders=await this.store.recentOrders(12);
    let signalReady=false;try{signalReady=!!await this.latestEligibleDecision();}catch{}
    let currentSessionKey=null;try{currentSessionKey=lower(await this.wallet.publicSessionAddress());}catch{}
    const sessionValid=!!state.permissionContext&&state.sessionPublicKey===currentSessionKey&&Date.parse(state.sessionExpiresAt||'')>Date.now();
    const funded=balances?balances.nativeWei>=this.policy.config.pilotBankrollWei||(sessionValid&&balances.liquidWei>=this.policy.config.validationEntryWei+this.policy.config.gasReserveWei):state.fundingVerifiedAt!=null&&sessionValid;
    const safeState={
      ...state,
      pendingSession:state.pendingSession?{sessionId:state.pendingSession.sessionId,expirySec:state.pendingSession.expirySec}:null,
      pendingReclaim:state.pendingReclaim?{id:state.pendingReclaim.id,createdAt:state.pendingReclaim.createdAt,amountWei:state.pendingReclaim.amountWei,reserveWei:state.pendingReclaim.reserveWei}:null,
      permissionContext:state.permissionContext?'STORED_SERVER_SIDE':null
    };
    return{
      generatedAt:iso(),mode:state.armed?(state.roundTripValidated?'AUTONOMOUS_LIMITED':'ROUND_TRIP_VALIDATION'):'NOT_ARMED',
      ownerMatches:matches,state:safeState,balances:balances&&Object.fromEntries(Object.entries(balances).map(([key,value])=>typeof value==='bigint'?[key,value.toString()]:[key,value])),
      policy:this.policy.publicConfig(),positions,orders:orders.map(this.publicOrder),
      readiness:{walletApi:this.wallet.ready(),infrastructure:this.infrastructure.verified,smartAccount:exactAddress(state.accountAddress),funded,sessionAuthorized:sessionValid,sessionTested:state.sessionTested===true,roundTripValidated:state.roundTripValidated===true,armed:state.armed===true,killSwitch:state.killSwitch===true,validEntryNow:signalReady},
      infrastructure:this.infrastructure,
      runtime:{status:this.lastError?'DEGRADED':this.running?'RUNNING':'IDLE',startedAt:this.startedAt,lastError:this.lastError}
    };
  }

  publicOrder(order){
    const copy={...order};delete copy.calls;delete copy.beforeBalances;delete copy.afterBalances;delete copy.sessionContextHash;return copy;
  }

  publicReceipt(receipt){
    if(!receipt)return null;
    const serial=value=>typeof value==='bigint'?value.toString():value??null;
    return{status:serial(receipt.status),blockNumber:serial(receipt.blockNumber),gasUsed:serial(receipt.gasUsed),transactionHash:receipt.transactionHash||null};
  }

  receiptFromStatus(status){return status?.receipts?.find(receipt=>receipt.transactionHash)||status?.receipts?.[0]||null;}
  cleanError(error){return String(error?.message||error||'unknown live execution error').replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,500);}

  async tick(){
    if(this.running||this.controlBusy)return;
    this.running=true;
    try{
      await this.reconcilePending();
      if((await this.store.pendingOrders()).length)return;
      let state=await this.store.state();
      await this.store.patchState({lastTickAt:iso()});
      const positions=await this.store.positions();
      const sessionUnavailable=!state.permissionContext||Date.parse(state.sessionExpiresAt||'')<=Date.now();
      if(positions.length&&sessionUnavailable){
        await this.store.patchState({
          state:'SESSION_UNAVAILABLE_WITH_POSITION',armed:false,killSwitch:true,emergencyExitRequested:false,
          sessionTested:false,permissionContext:null,lastError:'owner_session_required_to_recover_open_position'
        });
        return;
      }
      if(!positions.length&&state.permissionContext&&Date.parse(state.sessionExpiresAt||'')<=Date.now()){
        await this.store.patchState({state:'SESSION_EXPIRED',armed:false,killSwitch:true,sessionTested:false,permissionContext:null,lastError:'session_expired'});
        return;
      }
      if(state.emergencyExitRequested){
        for(const position of positions)await this.exitPosition(position,'user_kill_switch');
        const remaining=await this.store.positions();
        if(!remaining.length)await this.store.patchState({state:'STOPPED',emergencyExitRequested:false});
        else if(!(await this.store.pendingOrders()).some(order=>order.status==='SUBMITTED'||order.status==='SUBMITTING'))await this.store.patchState({state:'EXIT_FAILED_OWNER_ACTION_REQUIRED',emergencyExitRequested:false,armed:false,killSwitch:true,lastError:'automatic_exit_failed_use_owner_reclaim'});
        this.lastError=null;return;
      }
      if(positions.length){
        for(let position of positions){
          if(position.validation===true){await this.exitPosition(position,'round_trip_validation');continue;}
          position=await this.refreshPosition(position);
          const reason=this.exitReason(position);
          if(reason)await this.exitPosition(position,reason);
        }
      }
      state=await this.store.state();
      if(!state.armed||state.killSwitch||!state.sessionTested)return;
      if((await this.store.positions()).length>=this.policy.config.maxOpenPositions)return;
      const start=new Date();start.setUTCHours(0,0,0,0);
      const realized=await this.store.realizedPnlSince(start.toISOString());
      if(realized<=-this.policy.config.dailyLossWei){
        await this.store.patchState({state:'DAILY_LOSS_STOP',armed:false,killSwitch:true,lastError:'daily_loss_limit'});return;
      }
      const decision=await this.latestEligibleDecision(state.roundTripValidated);
      if(!decision)return;
      if(state.roundTripValidated)await this.enterPosition(decision,this.policy.config.maxEntryWei,false);
      else await this.enterPosition(decision,this.policy.config.validationEntryWei,true);
      this.lastError=null;
    }catch(error){
      this.lastError=this.cleanError(error);
      await this.store.patchState({lastError:this.lastError}).catch(()=>{});
      console.error(`[live-execution] tick failed closed: ${this.lastError}`);
    }finally{this.running=false;}
  }

  async latestEligibleDecision(){
    const snapshot=await this.getShadowSnapshot?.();
    const decisions=(snapshot?.recentDecisions||[]).filter(decision=>decision.decision==='ENTRY').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    const signals=this.getSignals?.()||[],db=this.getDb?.()||{tokenState:{}};
    for(const decision of decisions){
      const side=(await this.store.state()).roundTripValidated?'BUY':'VALIDATION_BUY';
      if(await this.store.orderForDecision(decision.id,side))continue;
      const signal=signals.find(item=>lower(item.tokenAddress)===lower(decision.tokenAddress));
      const amount=(await this.store.state()).roundTripValidated?this.policy.config.maxEntryWei:this.policy.config.validationEntryWei;
      const check=this.policy.validateEntry({decision,signal,tokenState:db.tokenState,amountWei:amount});
      if(check.ok)return{decision,signal,check};
    }
    return null;
  }

  async enterPosition(candidate,amountWei,validation){
    await this.requireInfrastructure();
    const state=await this.store.state();await this.assertOwnerSession(state.ownerAddress,state);
    const balance=await this.swap.nativeBalance(state.accountAddress);
    if(balance<amountWei+this.policy.config.gasReserveWei)throw Object.assign(new Error('operational account lacks entry amount plus gas reserve'),{code:'INSUFFICIENT_OPERATIONAL_BALANCE'});
    const token=lower(candidate.decision.tokenAddress);
    await this.refreshToken?.(token);
    const currentSignal=(this.getSignals?.()||[]).find(item=>lower(item.tokenAddress)===token);
    const check=this.policy.validateEntry({decision:candidate.decision,signal:currentSignal,tokenState:this.getDb().tokenState,amountWei});
    if(!check.ok)throw Object.assign(new Error(`live recheck blocked: ${check.reason}`),{code:'LIVE_RECHECK_BLOCKED'});
    const build=await this.swap.buildBuy({account:state.accountAddress,token,amountWei,poolFee:check.poolFee});
    const side=validation?'VALIDATION_BUY':'BUY';
    const order=await this.submitSwap({decision:candidate.decision,side,token,build});
    if(order.status!=='CONFIRMED')return;
    await this.applyConfirmedOrder(order);
    if(validation)await this.exitPosition((await this.store.positions()).find(position=>position.entryOrderId===order.id),'round_trip_validation');
  }

  exitReason(position){
    const db=this.getDb?.()||{tokenState:{}},st=db.tokenState?.[position.tokenAddress]||{};
    const signal=(this.getSignals?.()||[]).find(item=>lower(item.tokenAddress)===position.tokenAddress);
    if(['DISTRIBUTION','BLOCKED'].includes(signal?.state))return`signal_${signal.state.toLowerCase()}`;
    if(REQUIRED_SAFETY.some(key=>st.safety?.[key]!=='PASS'))return'critical_safety_not_pass';
    if(Number(position.stopPriceUsd)>0&&Number(st.priceUsd)>0&&Number(st.priceUsd)<=Number(position.stopPriceUsd))return'risk_stop';
    return null;
  }

  async refreshPosition(position){
    try{await this.refreshToken?.(position.tokenAddress);}
    catch(error){console.warn(`[live-execution] position refresh unavailable ${position.tokenAddress}: ${this.cleanError(error)}`);return position;}
    const market=this.getDb?.()?.tokenState?.[position.tokenAddress]||{},price=Number(market.priceUsd);
    if(!(price>0))return position;
    const entry=Number(position.entryPriceUsd)||price,previousHigh=Number(position.highWaterPriceUsd)||entry;
    const high=Math.max(previousHigh,price);let stop=Number(position.stopPriceUsd)||entry*(1-this.policy.config.stopLossBps/10000);
    if(high>=entry*(1+this.policy.config.trailArmBps/10000))stop=Math.max(stop,high*(1-this.policy.config.trailGivebackBps/10000));
    if(high===previousHigh&&stop===Number(position.stopPriceUsd))return position;
    return this.store.savePosition({...position,lastPriceUsd:price,lastObservedAt:market.marketObservedAt||market.observedAt||iso(),highWaterPriceUsd:high,stopPriceUsd:stop});
  }

  async exitPosition(position,reason){
    if(!position)return;
    const state=await this.store.state();
    if(!state.permissionContext||Date.parse(state.sessionExpiresAt||'')<=Date.now())throw Object.assign(new Error('cannot exit: limited session unavailable'),{code:'EXIT_SESSION_UNAVAILABLE'});
    const token=position.tokenAddress;
    try{await this.refreshToken?.(token);}catch(error){console.warn(`[live-execution] exit market refresh unavailable ${token}: ${this.cleanError(error)}`);}
    const balance=await this.swap.tokenBalance(token,state.accountAddress);
    if(balance<=0n){await this.store.deletePosition(token);return;}
    const poolFee=Number(this.getDb().tokenState[token]?.safetyEvidence?.poolFee||position.poolFee);
    const build=await this.swap.buildSell({account:state.accountAddress,token,amountRaw:balance,poolFee});
    const side=position.validation?'VALIDATION_SELL':'SELL';
    const decision={id:`${position.decisionId}:${side}`,tokenAddress:token,symbol:position.symbol,at:iso(),decision:'EXIT',reason};
    const order=await this.submitSwap({decision,side,token,build,position});
    if(order.status!=='CONFIRMED')return;
    await this.applyConfirmedOrder(order);
  }

  async submitSwap({decision,side,token,build,position}){
    const state=await this.store.state(),before=await this.swap.balances(state.accountAddress,token);
    if(side.endsWith('BUY')&&(!state.armed||state.killSwitch))throw Object.assign(new Error('live entry stopped before submission'),{code:'LIVE_ENTRY_STOPPED'});
    this.swap.validateCalls({side:side.endsWith('BUY')?'BUY':'SELL',calls:build.calls,token,amountRaw:build.quote?.amountInRaw,account:state.accountAddress,poolFee:build.quote?.poolFee});
    const market=this.getDb?.()?.tokenState?.[token]||{};
    const order={
      id:`live-${crypto.randomUUID()}`,decisionId:decision.id,side,tokenAddress:token,symbol:decision.symbol||token.slice(0,8),
      status:'QUOTED',at:iso(),reason:decision.reason||null,quote:build.quote,minimumOutRaw:build.minimumOutRaw,calls:build.calls,
      poolFee:Number(build.quote?.poolFee||position?.poolFee||0),validation:side.startsWith('VALIDATION_'),
      entryPriceUsd:side.endsWith('BUY')?(Number(market.priceUsd)||null):null,
      stopPriceUsd:side.endsWith('BUY')&&Number(market.priceUsd)>0?Number(market.priceUsd)*(1-this.policy.config.stopLossBps/10000):null,
      entryOrderId:position?.entryOrderId||null,positionCostWei:position?.costWei||null,positionValidation:position?.validation===true,
      beforeBalances:Object.fromEntries(Object.entries(before).map(([key,value])=>typeof value==='bigint'?[key,value.toString()]:[key,value]))
    };
    const existing=await this.store.createOrder(order);
    if(existing.id!==order.id)return existing;
    await this.store.updateOrder(order.id,{status:'SUBMITTING'});
    let executionAttempted=false;
    try{
      const sendState=await this.store.state();
      if(sendState.accountAddress!==state.accountAddress||sendState.permissionContext!==state.permissionContext||Date.parse(sendState.sessionExpiresAt||'')<=Date.now())throw Object.assign(new Error('authorized live session changed before submission'),{code:'LIVE_SESSION_CHANGED'});
      if(side.endsWith('BUY')&&(!sendState.armed||sendState.killSwitch))throw Object.assign(new Error('live entry stopped immediately before submission'),{code:'LIVE_ENTRY_STOPPED'});
      if(Date.parse(build.quote?.expiresAt||'')<=Date.now())throw Object.assign(new Error('live quote expired before submission'),{code:'LIVE_QUOTE_EXPIRED'});
      this.swap.validateCalls({side:side.endsWith('BUY')?'BUY':'SELL',calls:build.calls,token,amountRaw:build.quote?.amountInRaw,account:sendState.accountAddress,poolFee:build.quote?.poolFee});
      executionAttempted=true;
      const result=await this.wallet.execute({
        accountAddress:sendState.accountAddress,permissionContext:sendState.permissionContext,calls:build.calls,
        onSubmitted:async callId=>this.store.updateOrder(order.id,{status:'SUBMITTED',callId,submittedAt:iso()})
      });
      return this.finalizeOrder(order.id,result.status,position);
    }catch(error){
      const current=(await this.store.recentOrders(200)).find(item=>item.id===order.id);
      if(current?.status==='SUBMITTED')return current;
      const failed=await this.store.updateOrder(order.id,{status:executionAttempted?'SUBMISSION_UNKNOWN':'FAILED',failedAt:iso(),error:this.cleanError(error)});
      if(executionAttempted)await this.store.patchState({state:'MANUAL_RECONCILIATION_REQUIRED',armed:false,killSwitch:true,sessionTested:false,lastError:'submission_state_unknown'});
      return failed;
    }
  }

  async finalizeOrder(orderId,status,position){
    const order=(await this.store.recentOrders(200)).find(item=>item.id===orderId);
    if(!order)return null;
    if(['CONFIRMED','FAILED','RECONCILIATION_ERROR'].includes(order.status))return order;
    if(pendingStatus(status))return this.store.updateOrder(orderId,{status:'SUBMITTED',callStatus:callStatusCode(status)});
    const receipt=this.receiptFromStatus(status);
    if(failedStatus(status)||!receiptSucceeded(receipt)){
      const failed=await this.store.updateOrder(orderId,{status:'FAILED',failedAt:iso(),callStatus:callStatusCode(status)||null,error:'wallet call failed or reverted',receipt:this.publicReceipt(receipt)});
      const failedState=order.side==='RECLAIM'?'RECLAIM_ERROR':order.side==='SESSION_TEST'?'SESSION_ERROR':order.side.endsWith('SELL')?'EXIT_FAILED_OWNER_ACTION_REQUIRED':'EXECUTION_FAILED';
      await this.store.patchState({state:failedState,armed:false,killSwitch:true,sessionTested:false,lastError:'wallet_call_failed_or_reverted'});
      return failed;
    }
    const state=await this.store.state(),before=Object.fromEntries(Object.entries(order.beforeBalances||{}).map(([key,value])=>key.endsWith('Wei')||key.endsWith('Raw')?[key,BigInt(value)]:[key,value]));
    let after=null;
    if(order.side.endsWith('BUY')||order.side.endsWith('SELL')){
      for(let attempt=0;attempt<6;attempt++){
        after=await this.swap.balances(state.accountAddress,order.tokenAddress);
        const tokenMoved=order.side.endsWith('BUY')?after.tokenRaw>before.tokenRaw:after.tokenRaw<before.tokenRaw;
        const liquidMoved=order.side.endsWith('BUY')?after.liquidWei<before.liquidWei:true;
        if(tokenMoved&&liquidMoved)break;
        if(attempt<5)await new Promise(resolve=>setTimeout(resolve,750));
      }
    }
    const patch={status:'CONFIRMED',confirmedAt:iso(),callStatus:callStatusCode(status)||200,txHash:receipt.transactionHash,receipt:this.publicReceipt(receipt)};
    if(after)patch.afterBalances=Object.fromEntries(Object.entries(after).map(([key,value])=>typeof value==='bigint'?[key,value.toString()]:[key,value]));
    if(order.side.endsWith('BUY')){
      const acquired=after.tokenRaw-before.tokenRaw,spent=before.liquidWei-after.liquidWei;
      if(acquired<=0n||spent<=0n){
        const failed=await this.store.updateOrder(orderId,{...patch,status:'RECONCILIATION_ERROR',error:'buy receipt succeeded without positive token and liquid deltas'});
        await this.store.patchState({state:'MANUAL_RECONCILIATION_REQUIRED',armed:false,killSwitch:true,sessionTested:false,lastError:'buy_balance_reconciliation_failed'});
        return failed;
      }
      patch.actualTokenDeltaRaw=acquired.toString();patch.actualLiquidSpentWei=spent.toString();
    }else if(order.side.endsWith('SELL')){
      const sold=before.tokenRaw-after.tokenRaw,proceeds=after.liquidWei-before.liquidWei;
      if(sold<=0n||after.tokenRaw!==0n){
        const failed=await this.store.updateOrder(orderId,{...patch,status:'RECONCILIATION_ERROR',error:'sell receipt succeeded without fully clearing the exact token balance'});
        await this.store.patchState({state:'MANUAL_RECONCILIATION_REQUIRED',armed:false,killSwitch:true,sessionTested:false,lastError:'sell_balance_reconciliation_failed'});
        return failed;
      }
      patch.actualTokenDeltaRaw=sold.toString();patch.actualLiquidProceedsWei=proceeds.toString();
      const cost=BigInt(position?.costWei||order.positionCostWei||0);patch.pnlWei=(proceeds-cost).toString();
    }
    return this.store.updateOrder(orderId,patch);
  }

  async reconcilePending(){
    for(const order of await this.store.pendingOrders()){
      if(order.status==='QUOTED'){
        await this.store.updateOrder(order.id,{status:'ABANDONED',failedAt:iso(),error:'server restarted before submission'});continue;
      }
      if(order.status==='SUBMITTING'&&!order.callId){
        await this.store.updateOrder(order.id,{status:'SUBMISSION_UNKNOWN',failedAt:iso(),error:'server restarted in the submission window; automatic entries stopped'});
        await this.store.patchState({state:'MANUAL_RECONCILIATION_REQUIRED',armed:false,killSwitch:true,sessionTested:false,lastError:'submission_state_unknown'});continue;
      }
      if(order.status!=='SUBMITTED'||!order.callId)continue;
      const status=await this.wallet.callsStatus(order.callId);
      if(pendingStatus(status))continue;
      const position=(await this.store.positions()).find(item=>item.tokenAddress===order.tokenAddress);
      const finalized=await this.finalizeOrder(order.id,status,position);
      if(finalized?.status==='CONFIRMED')await this.applyConfirmedOrder(finalized);
    }
    await this.recoverConfirmedOrders();
  }

  async applyConfirmedOrder(order){
    if(!order||order.status!=='CONFIRMED'||order.appliedAt)return;
    if(order.side==='SESSION_TEST'){
      const state=await this.store.state();
      if(!state.permissionContext||contextHash(state.permissionContext)!==order.sessionContextHash||Date.parse(order.sessionExpiresAt||'')<=Date.now()){
        await this.store.updateOrder(order.id,{appliedAt:iso(),applicationError:'confirmed session test no longer matches the active owner session'});
        return;
      }
      await this.store.patchState({state:'SESSION_TESTED',sessionTested:true,armed:false,killSwitch:false,lastError:null});
      await this.store.updateOrder(order.id,{appliedAt:iso()});
      return;
    }
    if(order.side==='RECLAIM'){
      if(order.nativeOnly!==true){
        for(const position of await this.store.positions())await this.store.deletePosition(position.tokenAddress);
        for(const unresolved of (await this.store.recentOrders(200)).filter(item=>['SUBMISSION_UNKNOWN','RECONCILIATION_ERROR'].includes(item.status)&&!item.resolvedAt))await this.store.updateOrder(unresolved.id,{resolvedAt:iso(),resolution:'OWNER_RECLAIM'});
      }
      await this.store.patchState({
        state:order.nativeOnly===true?'NATIVE_RECLAIMED_TOKENS_REMAIN':'RECLAIMED',pendingReclaim:null,permissionContext:null,sessionPublicKey:null,sessionExpiresAt:null,
        sessionTested:false,roundTripValidated:false,armed:false,killSwitch:true,emergencyExitRequested:false,lastError:null,reclaimedAt:iso()
      });
      await this.store.updateOrder(order.id,{appliedAt:iso()});
      return;
    }
    if(order.side.endsWith('BUY')){
      const positions=await this.store.positions();
      const existing=positions.find(item=>item.tokenAddress===order.tokenAddress);
      if(existing?.entryOrderId===order.id){await this.store.updateOrder(order.id,{appliedAt:iso()});return existing;}
      if(existing){
        await this.store.patchState({state:'MANUAL_RECONCILIATION_REQUIRED',armed:false,killSwitch:true,lastError:'conflicting_open_position'});
        await this.store.updateOrder(order.id,{appliedAt:iso(),applicationError:'conflicting open position'});
        return null;
      }
      const position=await this.store.savePosition({
        tokenAddress:order.tokenAddress,symbol:order.symbol||order.tokenAddress.slice(0,8),quantityRaw:order.actualTokenDeltaRaw,
        costWei:order.actualLiquidSpentWei,entryOrderId:order.id,decisionId:order.decisionId,openedAt:order.confirmedAt,
        entryPriceUsd:order.entryPriceUsd??null,stopPriceUsd:order.stopPriceUsd??null,poolFee:Number(order.poolFee),
        highWaterPriceUsd:order.entryPriceUsd??null,lastPriceUsd:order.entryPriceUsd??null,
        validation:order.validation===true,status:'OPEN'
      });
      await this.store.updateOrder(order.id,{appliedAt:iso()});
      return position;
    }
    if(order.side.endsWith('SELL')){
      const position=(await this.store.positions()).find(item=>item.tokenAddress===order.tokenAddress);
      if(position&&(!order.entryOrderId||position.entryOrderId===order.entryOrderId))await this.store.deletePosition(order.tokenAddress);
      if(order.validation===true||order.positionValidation===true){
        const state=await this.store.state();
        await this.store.patchState({roundTripValidated:true,state:state.armed?'AUTONOMOUS_LIMITED':'ROUND_TRIP_VALIDATED',lastError:null});
      }
      await this.store.updateOrder(order.id,{appliedAt:iso()});
    }
  }

  async recoverConfirmedOrders(){
    const orders=(await this.store.recentOrders(200)).filter(order=>order.status==='CONFIRMED');
    const sells=new Set(orders.filter(order=>order.side.endsWith('SELL')&&order.entryOrderId).map(order=>order.entryOrderId));
    for(const order of [...orders].reverse()){
      if(order.side.endsWith('BUY')&&!sells.has(order.id))await this.applyConfirmedOrder(order);
    }
    for(const order of [...orders].reverse())if(order.side.endsWith('SELL')||['SESSION_TEST','RECLAIM'].includes(order.side))await this.applyConfirmedOrder(order);
  }
}

LiveRuntime.proofActions=proofActions;
module.exports=LiveRuntime;

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const LiveRuntime=require('../lib/liveRuntime');
const {LiveStore}=require('../lib/liveStore');
const {LivePolicy,SWAP_ROUTER_02,QUOTER_V2,WETH,UNISWAP_V3_FACTORY}=require('../lib/livePolicy');

const OWNER='0x71c50c7f6ba3962fe37b6c6e16757427b21debcb';
const ACCOUNT='0x3333333333333333333333333333333333333333';
const TOKEN='0x1111111111111111111111111111111111111111';

async function runtimeFixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trenches-live-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const policy=new LivePolicy({allowed:true,ownerAddress:OWNER});
  const runtime=new LiveRuntime({policy,wallet:{ready:()=>true},rpc:async()=>{throw new Error('unexpected rpc')},getDb:()=>({tokenState:{}}),getSignals:()=>[],getShadowSnapshot:async()=>({recentDecisions:[]})});
  runtime.store=new LiveStore({filePath:path.join(dir,'live.json')});await runtime.store.init();
  await runtime.store.patchState({ownerAddress:OWNER,accountAddress:ACCOUNT,state:'SESSION_TESTED',sessionTested:true,permissionContext:'0x1234',sessionExpiresAt:new Date(Date.now()+86400000).toISOString()});
  return runtime;
}

test('confirmed validation buy and sell recover idempotently across restarts',async t=>{
  const runtime=await runtimeFixture(t);
  const buy={id:'buy-1',decisionId:'decision-1',side:'VALIDATION_BUY',tokenAddress:TOKEN,symbol:'TEST',status:'CONFIRMED',at:new Date().toISOString(),confirmedAt:new Date().toISOString(),actualTokenDeltaRaw:'1000',actualLiquidSpentWei:'100',poolFee:3000,validation:true,entryPriceUsd:1,stopPriceUsd:.88};
  await runtime.store.createOrder(buy);await runtime.recoverConfirmedOrders();await runtime.recoverConfirmedOrders();
  assert.equal((await runtime.store.positions()).length,1);
  const sell={id:'sell-1',decisionId:'decision-1:VALIDATION_SELL',side:'VALIDATION_SELL',tokenAddress:TOKEN,symbol:'TEST',status:'CONFIRMED',at:new Date().toISOString(),confirmedAt:new Date().toISOString(),entryOrderId:'buy-1',positionValidation:true,pnlWei:'-5'};
  await runtime.store.createOrder(sell);await runtime.recoverConfirmedOrders();
  assert.equal((await runtime.store.positions()).length,0);assert.equal((await runtime.store.state()).roundTripValidated,true);
});

test('an indeterminate submission stops entries instead of retrying',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.createOrder({id:'unknown-1',decisionId:'decision-unknown',side:'BUY',tokenAddress:TOKEN,status:'SUBMITTING',at:new Date().toISOString()});
  await runtime.reconcilePending();
  const order=await runtime.store.orderForDecision('decision-unknown','BUY'),state=await runtime.store.state();
  assert.equal(order.status,'SUBMISSION_UNKNOWN');assert.equal(state.armed,false);assert.equal(state.killSwitch,true);assert.equal(state.state,'MANUAL_RECONCILIATION_REQUIRED');
});

test('a pending broadcast globally blocks every later entry until reconciliation',async t=>{
  const runtime=await runtimeFixture(t);let decisionReads=0;
  await runtime.store.patchState({armed:true,killSwitch:false});
  await runtime.store.createOrder({id:'pending-buy',decisionId:'pending-decision',side:'BUY',tokenAddress:TOKEN,status:'SUBMITTED',callId:'0x1234',at:new Date().toISOString()});
  runtime.wallet.callsStatus=async()=>({chainId:'0x1237',status:100,receipts:[]});
  runtime.getShadowSnapshot=async()=>{decisionReads++;return{recentDecisions:[]};};
  await runtime.tick();
  assert.equal(decisionReads,0);assert.equal((await runtime.store.orderForDecision('pending-decision','BUY')).status,'SUBMITTED');
});

test('a confirmed owner reclaim erases the local autonomous session',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.patchState({armed:true,roundTripValidated:true,pendingReclaim:{id:'reclaim-1'}});
  const order={id:'reclaim-order',decisionId:'reclaim-1',side:'RECLAIM',tokenAddress:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',status:'CONFIRMED',at:new Date().toISOString(),confirmedAt:new Date().toISOString()};
  await runtime.store.createOrder(order);await runtime.recoverConfirmedOrders();
  let state=await runtime.store.state();
  assert.equal(state.state,'RECLAIMED');assert.equal(state.permissionContext,null);assert.equal(state.sessionExpiresAt,null);assert.equal(state.armed,false);assert.equal(state.killSwitch,true);
  await runtime.store.patchState({state:'SESSION_AUTHORIZED',permissionContext:'0x5678',sessionExpiresAt:new Date(Date.now()+86400000).toISOString(),killSwitch:false});
  await runtime.recoverConfirmedOrders();state=await runtime.store.state();
  assert.equal(state.state,'SESSION_AUTHORIZED');assert.equal(state.permissionContext,'0x5678');
});

test('a confirmed ETH-only reclaim erases autonomy but preserves token recovery state',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.savePosition({tokenAddress:TOKEN,symbol:'TEST',quantityRaw:'100',costWei:'10',entryOrderId:'buy-token',decisionId:'decision-token',status:'OPEN'});
  await runtime.store.createOrder({id:'unknown-token-buy',decisionId:'unknown-token-buy',side:'BUY',tokenAddress:'0x2222222222222222222222222222222222222222',status:'SUBMISSION_UNKNOWN',at:new Date().toISOString()});
  const order={id:'native-reclaim-order',decisionId:'reclaim-native',side:'RECLAIM',nativeOnly:true,tokenAddress:WETH,status:'CONFIRMED',at:new Date().toISOString(),confirmedAt:new Date().toISOString()};
  await runtime.store.createOrder(order);await runtime.recoverConfirmedOrders();
  const state=await runtime.store.state(),positions=await runtime.store.positions(),unresolved=await runtime.store.orderForDecision('unknown-token-buy','BUY');
  assert.equal(state.state,'NATIVE_RECLAIMED_TOKENS_REMAIN');assert.equal(state.permissionContext,null);assert.equal(state.armed,false);assert.equal(state.killSwitch,true);
  assert.equal(positions.length,1);assert.equal(unresolved.resolvedAt,undefined);
});

test('expired session fails closed and marks an open position for owner recovery',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.patchState({armed:true,sessionExpiresAt:new Date(Date.now()-1000).toISOString()});
  await runtime.store.savePosition({tokenAddress:TOKEN,symbol:'TEST',quantityRaw:'100',costWei:'10',entryOrderId:'buy-expired',decisionId:'decision-expired',validation:false,status:'OPEN'});
  await runtime.tick();
  const state=await runtime.store.state();
  assert.equal(state.state,'SESSION_UNAVAILABLE_WITH_POSITION');assert.equal(state.armed,false);assert.equal(state.killSwitch,true);assert.equal(state.permissionContext,null);
  assert.equal((await runtime.store.positions()).length,1);
});

test('expired session with no position is erased and cannot remain armed',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.patchState({armed:true,sessionExpiresAt:new Date(Date.now()-1000).toISOString()});
  await runtime.tick();
  const state=await runtime.store.state();
  assert.equal(state.state,'SESSION_EXPIRED');assert.equal(state.armed,false);assert.equal(state.killSwitch,true);assert.equal(state.permissionContext,null);
});

test('stop request reaches STOPPED immediately when there is no open position',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.patchState({state:'STOPPING',armed:false,killSwitch:true,emergencyExitRequested:true});
  await runtime.tick();
  const state=await runtime.store.state();
  assert.equal(state.state,'STOPPED');assert.equal(state.emergencyExitRequested,false);
});

test('confirmed sell reconciles even when gas makes the net liquid delta negative',async t=>{
  const runtime=await runtimeFixture(t);
  runtime.swap.balances=async()=>({nativeWei:890n,wethWei:0n,tokenRaw:0n,liquidWei:890n,observedAt:new Date().toISOString()});
  const order={
    id:'sell-net-negative',decisionId:'sell-negative',side:'SELL',tokenAddress:TOKEN,status:'SUBMITTED',at:new Date().toISOString(),
    callId:'0x1234',positionCostWei:'100',beforeBalances:{nativeWei:'900',wethWei:'0',tokenRaw:'10',liquidWei:'900'},entryOrderId:'buy-negative'
  };
  await runtime.store.createOrder(order);
  const receipt={status:'0x1',transactionHash:'0x'+'12'.repeat(32)};
  const finalized=await runtime.finalizeOrder(order.id,{status:200,receipts:[receipt]},null);
  assert.equal(finalized.status,'CONFIRMED');assert.equal(finalized.actualTokenDeltaRaw,'10');assert.equal(finalized.actualLiquidProceedsWei,'-10');assert.equal(finalized.pnlWei,'-110');
});

test('Robinhood infrastructure verification checks chain and all execution contracts',async t=>{
  const runtime=await runtimeFixture(t),seen=[];
  const encodedAddress=address=>`0x${'0'.repeat(24)}${address.slice(2)}`;
  runtime.rpc=async(method,params)=>{
    seen.push([method,params]);
    if(method==='eth_chainId')return'0x1237';
    if(method==='eth_getCode')return'0x60016000';
    if(method==='eth_call'&&params[0].to===WETH)return`0x${'0'.repeat(63)}12`;
    if(method==='eth_call'&&params[0].to===SWAP_ROUTER_02&&params[0].data==='0x4aa4a4fc')return encodedAddress(WETH);
    if(method==='eth_call'&&[SWAP_ROUTER_02,QUOTER_V2].includes(params[0].to))return encodedAddress(UNISWAP_V3_FACTORY);
    throw new Error('unexpected rpc');
  };
  const result=await runtime.verifyInfrastructure();
  assert.equal(result.verified,true);assert.equal(result.chainId,4663);assert.deepEqual(result.contracts,{weth:true,quoter:true,router:true});assert.equal(Object.values(result.bindings).every(Boolean),true);
  assert.equal(seen.filter(([method])=>method==='eth_getCode').length,3);
});

test('a kill switch raised during quote processing blocks the buy immediately before signing',async t=>{
  const runtime=await runtimeFixture(t);let executed=false;
  await runtime.store.patchState({armed:true,killSwitch:false});
  runtime.swap.balances=async()=>({nativeWei:1000n,wethWei:0n,tokenRaw:0n,liquidWei:1000n,observedAt:new Date().toISOString()});
  runtime.wallet.execute=async()=>{executed=true;throw new Error('must not execute');};
  const originalCreate=runtime.store.createOrder.bind(runtime.store);
  runtime.store.createOrder=async order=>{const created=await originalCreate(order);await runtime.store.patchState({armed:false,killSwitch:true});return created;};
  const amount=100n,poolFee=3000,quote={amountInRaw:amount.toString(),amountOutRaw:'1000',poolFee,quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+20000).toISOString()};
  const calls=[{to:SWAP_ROUTER_02,value:amount.toString(),data:runtime.swap.swapData({tokenIn:WETH,tokenOut:TOKEN,poolFee,recipient:ACCOUNT,amountIn:amount,amountOutMinimum:900n})}];
  const order=await runtime.submitSwap({decision:{id:'race-decision',symbol:'TEST'},side:'BUY',token:TOKEN,build:{quote,minimumOutRaw:'900',calls}});
  assert.equal(order.status,'FAILED');assert.equal(executed,false);assert.match(order.error,/stopped immediately/);
});

test('an execution error after signing begins is indeterminate and stops autonomy',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.patchState({armed:true,killSwitch:false});
  runtime.swap.balances=async()=>({nativeWei:1000n,wethWei:0n,tokenRaw:0n,liquidWei:1000n,observedAt:new Date().toISOString()});
  runtime.wallet.execute=async()=>{throw new Error('response lost');};
  const amount=100n,poolFee=3000,quote={amountInRaw:amount.toString(),amountOutRaw:'1000',poolFee,quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+20000).toISOString()};
  const calls=[{to:SWAP_ROUTER_02,value:amount.toString(),data:runtime.swap.swapData({tokenIn:WETH,tokenOut:TOKEN,poolFee,recipient:ACCOUNT,amountIn:amount,amountOutMinimum:900n})}];
  const order=await runtime.submitSwap({decision:{id:'unknown-decision',symbol:'TEST'},side:'BUY',token:TOKEN,build:{quote,minimumOutRaw:'900',calls}}),state=await runtime.store.state();
  assert.equal(order.status,'SUBMISSION_UNKNOWN');assert.equal(state.state,'MANUAL_RECONCILIATION_REQUIRED');assert.equal(state.armed,false);assert.equal(state.killSwitch,true);
});

test('a reverted wallet call fails closed',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.patchState({armed:true,killSwitch:false});
  const order={id:'reverted-buy',decisionId:'reverted-decision',side:'BUY',tokenAddress:TOKEN,status:'SUBMITTED',at:new Date().toISOString(),beforeBalances:{nativeWei:'1000',wethWei:'0',tokenRaw:'0',liquidWei:'1000'}};
  await runtime.store.createOrder(order);
  const failed=await runtime.finalizeOrder(order.id,{status:500,receipts:[{status:'0x0',transactionHash:'0x'+'34'.repeat(32)}]},null),state=await runtime.store.state();
  assert.equal(failed.status,'FAILED');assert.equal(state.state,'EXECUTION_FAILED');assert.equal(state.armed,false);assert.equal(state.killSwitch,true);
});

test('a delayed confirmed session test is recovered idempotently',async t=>{
  const runtime=await runtimeFixture(t);
  await runtime.store.patchState({state:'SESSION_TEST_SUBMITTED',sessionTested:false,killSwitch:true});
  const active=await runtime.store.state();
  const order={
    id:'delayed-test',decisionId:'delayed-test',side:'SESSION_TEST',tokenAddress:WETH,status:'SUBMITTED',callId:'0x1234',at:new Date().toISOString(),
    sessionContextHash:crypto.createHash('sha256').update(active.permissionContext).digest('hex'),sessionExpiresAt:active.sessionExpiresAt
  };
  await runtime.store.createOrder(order);
  runtime.wallet.callsStatus=async()=>({status:200,receipts:[{status:'0x1',transactionHash:'0x'+'56'.repeat(32)}]});
  await runtime.reconcilePending();
  await runtime.store.patchState({state:'ARMED_FOR_ROUND_TRIP',armed:true});
  await runtime.reconcilePending();
  const state=await runtime.store.state();
  assert.equal(state.state,'ARMED_FOR_ROUND_TRIP');assert.equal(state.sessionTested,true);assert.equal(state.armed,true);assert.equal(state.killSwitch,false);
});

test('owner reclaim includes a token from an indeterminate buy even without a stored position',async t=>{
  const runtime=await runtimeFixture(t);
  runtime.verifyProof=async()=>OWNER;
  await runtime.store.createOrder({id:'unknown-buy',decisionId:'unknown-buy',side:'BUY',tokenAddress:TOKEN,symbol:'TEST',status:'SUBMISSION_UNKNOWN',at:new Date().toISOString()});
  runtime.swap.balances=async()=>({nativeWei:1000000000000000n,wethWei:0n,tokenRaw:0n,liquidWei:1000000000000000n,observedAt:new Date().toISOString()});
  runtime.swap.tokenBalance=async token=>token===TOKEN?123n:0n;
  runtime.rpc=async()=> '0x0';
  runtime.wallet.prepareOwnerCalls=async({calls})=>({type:'user-operation-v070',chainId:'0x1237',data:{sender:ACCOUNT},signatureRequest:{type:'personal_sign',data:{raw:'0x'+'11'.repeat(32)}},calls});
  const request=await runtime.requestReclaim({proof:{}});
  assert.deepEqual(request.tokenTransfers,[{tokenAddress:TOKEN,symbol:'TEST',amountRaw:'123'}]);
});

test('emergency native-only reclaim never calls an ERC-20 token',async t=>{
  const runtime=await runtimeFixture(t);let tokenBalanceReads=0;
  runtime.verifyProof=async()=>OWNER;
  await runtime.store.savePosition({tokenAddress:TOKEN,symbol:'TEST',quantityRaw:'123',costWei:'100',entryOrderId:'buy-1',decisionId:'decision-1',status:'OPEN'});
  runtime.swap.balances=async()=>({nativeWei:1000000000000000n,wethWei:0n,tokenRaw:0n,liquidWei:1000000000000000n,observedAt:new Date().toISOString()});
  runtime.swap.tokenBalance=async()=>{tokenBalanceReads++;return 123n;};
  runtime.rpc=async()=> '0x0';
  runtime.wallet.prepareOwnerCalls=async({calls})=>({type:'user-operation-v070',chainId:'0x1237',data:{sender:ACCOUNT},signatureRequest:{type:'personal_sign',data:{raw:'0x'+'11'.repeat(32)}},calls});
  const request=await runtime.requestReclaim({proof:{},nativeOnly:true});
  assert.equal(request.nativeOnly,true);assert.deepEqual(request.tokenTransfers,[]);assert.equal(tokenBalanceReads,0);
  assert.equal(request.signatureRequest.type,'personal_sign');
});

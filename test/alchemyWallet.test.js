'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {AlchemyWallet,WalletProofs,extractAlchemyApiKey}=require('../lib/alchemyWallet');

test('Alchemy key extraction accepts only an Alchemy endpoint',()=>{
  assert.equal(extractAlchemyApiKey('https://foo.g.alchemy.com/v2/example-api-key'),'example-api-key');
  assert.equal(extractAlchemyApiKey('https://example.com/v2/not-secret'),null);
  assert.equal(extractAlchemyApiKey('https://notalchemy.com/v2/not-secret'),null);
});

test('owner challenges are signed, single-use and action-bound',async()=>{
  const {privateKeyToAccount,generatePrivateKey}=await import('viem/accounts');
  const account=privateKeyToAccount(generatePrivateKey()),proofs=new WalletProofs();
  const challenge=proofs.issue({address:account.address,action:'CREATE_OPERATIONAL_ACCOUNT'});
  const signature=await account.signMessage({message:challenge.message});
  assert.equal((await proofs.verify({...challenge,signature})).ok,true);
  assert.equal((await proofs.verify({...challenge,signature})).ok,false);
});

test('owner challenge cache remains bounded under unauthenticated traffic',()=>{
  const proofs=new WalletProofs();
  for(let index=0;index<250;index++)proofs.issue({address:'0x71c50c7f6ba3962fe37b6c6e16757427b21debcb',action:'CREATE_OPERATIONAL_ACCOUNT'});
  assert.equal(proofs.challenges.size,200);
});

test('wallet API requests a dedicated modular account and limited session',async()=>{
  const requests=[];
  const fetchFn=async(_url,options)=>{
    const request=JSON.parse(options.body);requests.push(request);
    const result=request.method==='wallet_requestAccount'
      ?{accountAddress:'0x2222222222222222222222222222222222222222',id:'account-id'}
      :{sessionId:'0x1234',chainId:'0x1237',signatureRequest:{type:'eth_signTypedData_v4',data:{domain:{chainId:4663,verifyingContract:'0x2222222222222222222222222222222222222222'},types:{Test:[{name:'value',type:'uint256'}]},primaryType:'Test',message:{value:1}}}};
    return{ok:true,status:200,json:async()=>({jsonrpc:'2.0',id:1,result})};
  };
  const wallet=new AlchemyWallet({apiKey:'example-api-key',sessionPrivateKey:'0x'+'11'.repeat(32),fetchFn});
  const account=await wallet.requestSmartAccount('0x71c50c7f6ba3962fe37b6c6e16757427b21debcb');
  await wallet.createSession({accountAddress:account.address,expirySec:2000000000,permissions:[{type:'gas-limit',data:{limit:'0x1'}}]});
  assert.equal(requests[0].params[0].creationHint.accountType,'sma-b');
  assert.equal(requests[0].params[0].creationHint.createAdditional,true);
  assert.match(requests[0].params[0].creationHint.salt,/^0x[0-9a-f]{64}$/);
  assert.equal(requests[1].method,'wallet_createSession');
  assert.equal(requests[1].params[0].account,account.address);
  assert.equal(requests[1].params[0].chainId,'0x1237');
  assert.equal(wallet.permissionContext('0x1234','0x'+'22'.repeat(65)),'0x001234'+'22'.repeat(65));
});

test('owner-prepared reclaim is signature-checked, submitted and status-polled',async()=>{
  const {privateKeyToAccount,generatePrivateKey}=await import('viem/accounts');
  const owner=privateKeyToAccount(generatePrivateKey()),hash='0x'+'ab'.repeat(32),requests=[];
  const prepared={
    type:'user-operation-v070',chainId:'0x1237',data:{sender:'0x2222222222222222222222222222222222222222',nonce:'0x0',callData:'0x01',callGasLimit:'0x1',verificationGasLimit:'0x1',preVerificationGas:'0x1',maxFeePerGas:'0x1',maxPriorityFeePerGas:'0x1'},
    signatureRequest:{type:'personal_sign',data:{raw:hash},rawPayload:hash},feePayment:{sponsored:false,tokenAddress:'0x0000000000000000000000000000000000000000',maxAmount:'0x1'}
  };
  const fetchFn=async(_url,options)=>{
    const request=JSON.parse(options.body);requests.push(request);
    const result=request.method==='wallet_prepareCalls'?prepared:request.method==='wallet_sendPreparedCalls'?{id:'0x1234'}:{id:'0x1234',chainId:'0x1237',status:200,receipts:[{status:'0x1',transactionHash:'0x'+'33'.repeat(32)}]};
    return{ok:true,status:200,json:async()=>({jsonrpc:'2.0',id:1,result})};
  };
  const wallet=new AlchemyWallet({apiKey:'example-api-key',sessionPrivateKey:'0x'+'11'.repeat(32),fetchFn});
  const signature=await owner.signMessage({message:{raw:hash}});
  assert.equal(await wallet.verifyOwnerSignature({ownerAddress:owner.address,signatureRequest:prepared.signatureRequest,signature}),true);
  const next=await wallet.prepareOwnerCalls({accountAddress:prepared.data.sender,calls:[{to:owner.address,value:'10',data:'0x'}]});
  let submitted=null;const result=await wallet.sendOwnerPrepared({prepared:next,signature,onSubmitted:id=>{submitted=id;}});
  assert.equal(submitted,'0x1234');assert.equal(result.status.status,200);
  const sent=requests.find(request=>request.method==='wallet_sendPreparedCalls').params[0];
  assert.equal(sent.signature.data,signature);assert.equal('signatureRequest' in sent,false);assert.equal('feePayment' in sent,false);
});

test('personal-sign owner payloads are verified as raw bytes even when returned as a string',async()=>{
  const {privateKeyToAccount,generatePrivateKey}=await import('viem/accounts');
  const owner=privateKeyToAccount(generatePrivateKey()),raw='0x'+'42'.repeat(32);
  const signature=await owner.signMessage({message:{raw}}),wallet=new AlchemyWallet({});
  assert.equal(await wallet.verifyOwnerSignature({ownerAddress:owner.address,signatureRequest:{type:'personal_sign',data:raw},signature}),true);
});

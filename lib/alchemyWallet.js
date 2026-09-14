'use strict';

const crypto=require('node:crypto');
const {CHAIN_ID,CHAIN_ID_HEX,exactAddress}=require('./livePolicy');

function extractAlchemyApiKey(rpcUrl){
  try{
    const url=new URL(rpcUrl);
    if(!/(^|\.)alchemy\.com$/i.test(url.hostname))return null;
    const parts=url.pathname.split('/').filter(Boolean);
    const marker=parts.lastIndexOf('v2');
    const key=marker>=0?parts[marker+1]:parts.at(-1);
    return key&&key.length>=8?key:null;
  }catch{return null;}
}

class WalletProofs{
  constructor({ttlMs=5*60*1000}={}){this.ttlMs=ttlMs;this.challenges=new Map();}

  issue({address,action,host='Robinhood Trenches'}={}){
    const owner=String(address||'').toLowerCase();
    if(!exactAddress(owner))throw Object.assign(new Error('valid owner address required'),{code:'INVALID_OWNER'});
    const safeAction=String(action||'').replace(/[^A-Z0-9_-]/g,'').slice(0,64);
    if(!safeAction)throw Object.assign(new Error('valid action required'),{code:'INVALID_ACTION'});
    const safeHost=String(host||'Robinhood Trenches').replace(/[^a-zA-Z0-9.:-]/g,'').slice(0,120)||'RobinhoodTrenches';
    const nonce=crypto.randomBytes(18).toString('hex');
    const expiresAt=new Date(Date.now()+this.ttlMs).toISOString();
    const id=crypto.randomUUID();
    const message=[
      'Robinhood Trenches — autorización de cuenta operativa',
      `Acción: ${safeAction}`,
      `Cuenta Phantom: ${owner}`,
      `Red: Robinhood Chain (${CHAIN_ID})`,
      `Sitio: ${safeHost}`,
      `Nonce: ${nonce}`,
      `Expira: ${expiresAt}`,
      '',
      'Esta firma no mueve fondos. No compartas tu seed phrase ni tu clave privada.'
    ].join('\n');
    this.challenges.set(id,{id,owner,action:safeAction,message,expiresAt,used:false});
    if(this.challenges.size>200){
      for(const [key,value] of this.challenges)if(value.used||Date.parse(value.expiresAt)<Date.now())this.challenges.delete(key);
      while(this.challenges.size>200)this.challenges.delete(this.challenges.keys().next().value);
    }
    return{id,message,address:owner,action:safeAction,expiresAt};
  }

  async verify({id,address,action,message,signature}={}){
    const row=this.challenges.get(String(id||''));
    const owner=String(address||'').toLowerCase();
    if(!row||row.used||Date.parse(row.expiresAt)<Date.now())return{ok:false,reason:'challenge_missing_or_expired'};
    if(row.owner!==owner||row.action!==action||row.message!==message)return{ok:false,reason:'challenge_mismatch'};
    try{
      const {verifyMessage}=await import('viem');
      const ok=await verifyMessage({address:owner,message,signature});
      if(!ok)return{ok:false,reason:'invalid_owner_signature'};
      row.used=true;
      return{ok:true,address:owner};
    }catch{return{ok:false,reason:'invalid_owner_signature'};}
  }
}

class AlchemyWallet{
  constructor({apiKey,alchemyRpcUrl,sessionPrivateKey,paymasterPolicyId,fetchFn=global.fetch}={}){
    this.apiKey=apiKey||extractAlchemyApiKey(alchemyRpcUrl)||'';
    this.sessionPrivateKey=String(sessionPrivateKey||'');
    this.paymasterPolicyId=String(paymasterPolicyId||'');
    this.fetch=fetchFn;
    this.endpoint=this.apiKey?`https://api.g.alchemy.com/v2/${this.apiKey}`:'';
    this._sessionAccount=null;
  }

  ready(){return !!this.apiKey&&/^0x[0-9a-fA-F]{64}$/.test(this.sessionPrivateKey)&&typeof this.fetch==='function';}

  async rpc(method,params){
    if(!this.apiKey)throw Object.assign(new Error('Alchemy Wallet API key unavailable'),{code:'ALCHEMY_WALLET_API_UNAVAILABLE'});
    const response=await this.fetch(this.endpoint,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    let payload;
    try{payload=await response.json();}catch{throw Object.assign(new Error('Alchemy Wallet API returned invalid JSON'),{code:'ALCHEMY_WALLET_API_ERROR'});}
    if(!response.ok||payload?.error){
      const reason=String(payload?.error?.message||`HTTP ${response.status}`).slice(0,300);
      throw Object.assign(new Error(`Alchemy Wallet API: ${reason}`),{code:'ALCHEMY_WALLET_API_ERROR',rpcCode:payload?.error?.code});
    }
    return payload.result;
  }

  async sessionAccount(){
    if(this._sessionAccount)return this._sessionAccount;
    if(!/^0x[0-9a-fA-F]{64}$/.test(this.sessionPrivateKey))return null;
    const {privateKeyToAccount}=await import('viem/accounts');
    this._sessionAccount=privateKeyToAccount(this.sessionPrivateKey);
    return this._sessionAccount;
  }

  async publicSessionAddress(){return(await this.sessionAccount())?.address?.toLowerCase()||null;}

  async requestSmartAccount(ownerAddress){
    const owner=String(ownerAddress||'').toLowerCase();
    if(!exactAddress(owner))throw Object.assign(new Error('valid owner address required'),{code:'INVALID_OWNER'});
    const salt=`0x${crypto.createHash('sha256').update(`robinhood-trenches-live-v1:${owner}`).digest('hex')}`;
    const result=await this.rpc('wallet_requestAccount',[{signerAddress:owner,creationHint:{accountType:'sma-b',createAdditional:true,salt},includeCounterfactualInfo:true}]);
    const address=String(result?.accountAddress||'').toLowerCase();
    if(!exactAddress(address))throw Object.assign(new Error('Alchemy returned an invalid smart account'),{code:'INVALID_SMART_ACCOUNT'});
    if(result.counterfactualInfo&&result.counterfactualInfo.factoryType!=='MAv2.0.0-sma-b')throw Object.assign(new Error('Alchemy returned an unexpected smart-account type'),{code:'INVALID_SMART_ACCOUNT'});
    return{address,id:result.id||null};
  }

  async createSession({accountAddress,expirySec,permissions}){
    const account=String(accountAddress||'').toLowerCase();
    const publicKey=await this.publicSessionAddress();
    if(!exactAddress(account)||!exactAddress(publicKey))throw Object.assign(new Error('smart account or session key unavailable'),{code:'SESSION_SETUP_UNAVAILABLE'});
    const result=await this.rpc('wallet_createSession',[{account,chainId:CHAIN_ID_HEX,expirySec,key:{publicKey,type:'secp256k1'},permissions}]);
    let responseChain=null;try{responseChain=Number(BigInt(result?.chainId));}catch{}
    const domainChain=result?.signatureRequest?.data?.domain?.chainId;
    const verifyingContract=String(result?.signatureRequest?.data?.domain?.verifyingContract||'').toLowerCase();
    let typedChain=null;try{typedChain=domainChain==null?CHAIN_ID:Number(BigInt(domainChain));}catch{}
    if(responseChain!==CHAIN_ID||typedChain!==CHAIN_ID||verifyingContract!==account||result?.signatureRequest?.type!=='eth_signTypedData_v4')throw Object.assign(new Error('Alchemy returned a session for the wrong chain, account or signature type'),{code:'INVALID_SESSION_REQUEST'});
    return result;
  }

  async verifySessionAuthorization({ownerAddress,signatureRequest,signature}){
    return this.verifyOwnerSignature({ownerAddress,signatureRequest,signature});
  }

  async verifyOwnerSignature({ownerAddress,signatureRequest,signature}){
    const owner=String(ownerAddress||'').toLowerCase();
    if(!exactAddress(owner)||!/^0x[0-9a-fA-F]{130}$/.test(signature||''))return false;
    try{
      const {verifyMessage,verifyTypedData}=await import('viem');
      if(signatureRequest?.type==='eth_signTypedData_v4'&&signatureRequest.data)return await verifyTypedData({...signatureRequest.data,address:owner,signature});
      if(signatureRequest?.type==='personal_sign'&&signatureRequest.data){
        const data=typeof signatureRequest.data==='string'?signatureRequest.data:signatureRequest.data.raw;
        const message=/^0x[0-9a-fA-F]*$/.test(data||'')?{raw:data}:data;
        return await verifyMessage({address:owner,message,signature});
      }
      return false;
    }catch{return false;}
  }

  permissionContext(sessionId,signature){
    if(!/^0x[0-9a-fA-F]+$/.test(sessionId||'')||!/^0x[0-9a-fA-F]{130}$/.test(signature||''))throw Object.assign(new Error('invalid session authorization'),{code:'INVALID_SESSION_AUTH'});
    return`0x00${sessionId.slice(2)}${signature.slice(2)}`.toLowerCase();
  }

  async execute({accountAddress,permissionContext,calls,timeoutMs=90000,onSubmitted}){
    if(!this.ready())throw Object.assign(new Error('autonomous signer is not configured'),{code:'SESSION_SIGNER_UNAVAILABLE'});
    if(!exactAddress(accountAddress)||!/^0x[0-9a-f]+$/i.test(permissionContext||''))throw Object.assign(new Error('account session is not authorized'),{code:'SESSION_NOT_AUTHORIZED'});
    const [{createSmartWalletClient,alchemyWalletTransport},{defineChain}]=await Promise.all([import('@alchemy/wallet-apis'),import('viem')]);
    const signer=await this.sessionAccount();
    const chain=defineChain({
      id:CHAIN_ID,name:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
      rpcUrls:{default:{http:['https://rpc.mainnet.chain.robinhood.com']}},blockExplorers:{default:{name:'Robinhood Chain Explorer',url:'https://robinhoodchain.blockscout.com'}}
    });
    const client=createSmartWalletClient({
      signer,account:accountAddress,chain,
      transport:alchemyWalletTransport({apiKey:this.apiKey}),
      ...(this.paymasterPolicyId?{paymaster:{policyId:this.paymasterPolicyId}}:{})
    });
    const normalized=(calls||[]).map(call=>({to:String(call.to).toLowerCase(),data:call.data||'0x',value:BigInt(call.value||0)}));
    const capabilities={permissions:{context:permissionContext}};
    const sent=await client.sendCalls({calls:normalized,capabilities});
    if(typeof onSubmitted==='function')await onSubmitted(sent.id);
    const status=await client.waitForCallsStatus({id:sent.id,timeout:timeoutMs});
    if(Number(status?.chainId)!==CHAIN_ID)throw Object.assign(new Error('Alchemy returned execution status for the wrong chain'),{code:'LIVE_CHAIN_MISMATCH'});
    return{id:sent.id,status};
  }

  async callsStatus(id){
    const status=await this.rpc('wallet_getCallsStatus',[id]);
    let chainId=null;try{chainId=Number(BigInt(status?.chainId));}catch{}
    if(chainId!==CHAIN_ID)throw Object.assign(new Error('Alchemy returned call status for the wrong chain'),{code:'LIVE_CHAIN_MISMATCH'});
    return status;
  }

  async prepareOwnerCalls({accountAddress,calls}){
    const account=String(accountAddress||'').toLowerCase();
    if(!exactAddress(account)||!Array.isArray(calls)||!calls.length)throw Object.assign(new Error('valid owner calls required'),{code:'INVALID_OWNER_CALLS'});
    const normalized=calls.map(call=>({to:String(call.to).toLowerCase(),data:call.data||'0x',value:`0x${BigInt(call.value||0).toString(16)}`}));
    const result=await this.rpc('wallet_prepareCalls',[{from:account,chainId:CHAIN_ID_HEX,calls:normalized}]);
    if(!['user-operation-v060','user-operation-v070'].includes(result?.type)||!result.signatureRequest)throw Object.assign(new Error('Alchemy returned an unsupported owner call'),{code:'INVALID_OWNER_CALLS'});
    let responseChain=null;try{responseChain=Number(BigInt(result.chainId));}catch{}
    if(responseChain!==CHAIN_ID||String(result?.data?.sender||'').toLowerCase()!==account)throw Object.assign(new Error('Alchemy returned an owner call for the wrong chain or account'),{code:'INVALID_OWNER_CALLS'});
    return result;
  }

  async sendOwnerPrepared({prepared,signature,onSubmitted,timeoutMs=90000}){
    if(!['user-operation-v060','user-operation-v070'].includes(prepared?.type)||!/^0x[0-9a-fA-F]{130}$/.test(signature||''))throw Object.assign(new Error('valid prepared owner signature required'),{code:'INVALID_OWNER_CALLS'});
    const {signatureRequest:_signatureRequest,feePayment:_feePayment,details:_details,...call}=prepared;
    const result=await this.rpc('wallet_sendPreparedCalls',[{...call,signature:{type:'secp256k1',data:signature}}]);
    if(!/^0x[0-9a-fA-F]+$/.test(result?.id||''))throw Object.assign(new Error('Alchemy did not return a call id'),{code:'ALCHEMY_WALLET_API_ERROR'});
    if(typeof onSubmitted==='function')await onSubmitted(result.id);
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const status=await this.callsStatus(result.id),code=Number(status?.status);
      if(code>=200)return{id:result.id,status};
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
    throw Object.assign(new Error('owner call confirmation timed out'),{code:'CALL_STATUS_TIMEOUT',callId:result.id});
  }
}

module.exports={AlchemyWallet,WalletProofs,extractAlchemyApiKey};

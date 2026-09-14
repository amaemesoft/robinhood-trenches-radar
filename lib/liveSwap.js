'use strict';

const {WETH,QUOTER_V2,SWAP_ROUTER_02,SELECTORS,exactAddress}=require('./livePolicy');

const strip=value=>String(value||'').replace(/^0x/i,'');
const pad64=value=>strip(value).padStart(64,'0');
const encodeAddress=value=>pad64(String(value||'').toLowerCase());
const encodeUint=value=>pad64(BigInt(value).toString(16));
const callData=(selector,args=[])=>`0x${strip(selector)}${args.join('')}`;
const asHex=value=>`0x${BigInt(value||0).toString(16)}`;
const decodeFirstUint=value=>{
  const raw=strip(value);
  if(raw.length<64||!/^[0-9a-f]+$/i.test(raw))return null;
  try{return BigInt(`0x${raw.slice(0,64)}`);}catch{return null;}
};
const decodeWords=data=>{const raw=strip(data).slice(8);return raw.match(/.{64}/g)||[];};
const wordAddress=word=>word&&/^0{24}[0-9a-f]{40}$/i.test(word)?`0x${word.slice(24).toLowerCase()}`:null;
const wordUint=word=>{try{return BigInt(`0x${word}`)}catch{return null}};
const minAfterSlippage=(amount,bps)=>BigInt(amount)*(10000n-BigInt(bps))/10000n;

class LiveSwap{
  constructor({rpc,policy}={}){
    if(typeof rpc!=='function')throw new Error('LiveSwap requires rpc');
    this.rpc=rpc;this.policy=policy;
  }

  async ethCall(to,data,from,value){
    const tx={to,data};
    if(from)tx.from=from;
    if(value!=null)tx.value=asHex(value);
    return this.rpc('eth_call',[tx,'latest']);
  }

  async nativeBalance(address){
    const value=await this.rpc('eth_getBalance',[address,'latest']);
    try{return BigInt(value);}catch{throw Object.assign(new Error('invalid native balance response'),{code:'BALANCE_RESPONSE_INVALID'});}
  }

  async tokenBalance(token,address){
    const value=await this.ethCall(token,callData('70a08231',[encodeAddress(address)]));
    const balance=decodeFirstUint(value);
    if(balance==null)throw Object.assign(new Error('invalid token balance response'),{code:'BALANCE_RESPONSE_INVALID'});
    return balance;
  }

  async balances(account,token){
    const [native,weth,tokenValue]=await Promise.all([
      this.nativeBalance(account),this.tokenBalance(WETH,account),token&&token!==WETH?this.tokenBalance(token,account):Promise.resolve(0n)
    ]);
    return{nativeWei:native,wethWei:weth,tokenRaw:tokenValue,liquidWei:native+weth,observedAt:new Date().toISOString()};
  }

  quoteData({tokenIn,tokenOut,amountIn,poolFee}){
    return callData('c6a5026a',[
      encodeAddress(tokenIn),encodeAddress(tokenOut),encodeUint(amountIn),encodeUint(poolFee),encodeUint(0)
    ]);
  }

  async quote({tokenIn,tokenOut,amountIn,poolFee}){
    if(!exactAddress(tokenIn)||!exactAddress(tokenOut)||BigInt(amountIn)<=0n||!Number.isInteger(Number(poolFee)))throw Object.assign(new Error('invalid quote request'),{code:'INVALID_QUOTE'});
    const raw=await this.ethCall(QUOTER_V2,this.quoteData({tokenIn,tokenOut,amountIn,poolFee}));
    const amountOut=decodeFirstUint(raw);
    if(amountOut==null||amountOut<=0n)throw Object.assign(new Error('quoter returned no executable output'),{code:'NO_EXECUTABLE_QUOTE'});
    const quotedAt=new Date().toISOString();
    return{tokenIn,tokenOut,amountInRaw:BigInt(amountIn).toString(),amountOutRaw:amountOut.toString(),poolFee:Number(poolFee),quotedAt,expiresAt:new Date(Date.now()+this.policy.config.quoteTtlMs).toISOString(),source:'uniswap-v3-quoter-v2'};
  }

  swapData({tokenIn,tokenOut,poolFee,recipient,amountIn,amountOutMinimum}){
    return callData(SELECTORS.exactInputSingle,[
      encodeAddress(tokenIn),encodeAddress(tokenOut),encodeUint(poolFee),encodeAddress(recipient),
      encodeUint(amountIn),encodeUint(amountOutMinimum),encodeUint(0)
    ]);
  }

  approveData(spender,amount){return callData(SELECTORS.approve,[encodeAddress(spender),encodeUint(amount)]);}
  transferData(recipient,amount){return callData('a9059cbb',[encodeAddress(recipient),encodeUint(amount)]);}
  withdrawData(amount){return callData(SELECTORS.withdraw,[encodeUint(amount)]);}

  async buildBuy({account,token,amountWei,poolFee}){
    const amount=BigInt(amountWei),quote=await this.quote({tokenIn:WETH,tokenOut:token,amountIn:amount,poolFee});
    const minimum=minAfterSlippage(quote.amountOutRaw,this.policy.config.slippageBps);
    if(minimum<=0n)throw Object.assign(new Error('buy minimum output is zero'),{code:'NO_EXECUTABLE_QUOTE'});
    const call={to:SWAP_ROUTER_02,value:amount.toString(),data:this.swapData({tokenIn:WETH,tokenOut:token,poolFee,recipient:account,amountIn:amount,amountOutMinimum:minimum})};
    await this.simulateBuy(account,call);
    this.validateCalls({side:'BUY',calls:[call],token,amountRaw:amount.toString(),account,poolFee});
    return{side:'BUY',quote,minimumOutRaw:minimum.toString(),calls:[call]};
  }

  async buildSell({account,token,amountRaw,poolFee}){
    const amount=BigInt(amountRaw),quote=await this.quote({tokenIn:token,tokenOut:WETH,amountIn:amount,poolFee});
    const minimum=minAfterSlippage(quote.amountOutRaw,this.policy.config.slippageBps);
    if(minimum<=0n)throw Object.assign(new Error('sell minimum output is zero'),{code:'NO_EXECUTABLE_QUOTE'});
    const calls=[
      {to:token,value:'0',data:this.approveData(SWAP_ROUTER_02,amount)},
      {to:SWAP_ROUTER_02,value:'0',data:this.swapData({tokenIn:token,tokenOut:WETH,poolFee,recipient:account,amountIn:amount,amountOutMinimum:minimum})},
      {to:WETH,value:'0',data:this.withdrawData(minimum)}
    ];
    this.validateCalls({side:'SELL',calls,token,amountRaw:amount.toString(),account,poolFee});
    return{side:'SELL',quote,minimumOutRaw:minimum.toString(),calls};
  }

  async simulateBuy(account,call){
    try{
      await this.ethCall(call.to,call.data,account,call.value);
      const gas=await this.rpc('eth_estimateGas',[{from:account,to:call.to,data:call.data,value:asHex(call.value)}]);
      return{ok:true,gas};
    }catch(error){throw Object.assign(new Error(`buy simulation failed: ${String(error.message||error).slice(0,180)}`),{code:'BUY_SIMULATION_FAILED'});}
  }

  validateCalls({side,calls,token,amountRaw,account,poolFee}){
    const amount=BigInt(amountRaw);
    const recipient=String(account||'').toLowerCase(),fee=BigInt(poolFee||0);
    if(!exactAddress(token)||!exactAddress(recipient)||amount<=0n||fee<=0n)throw Object.assign(new Error('call policy rejected invalid token, account, fee or amount'),{code:'CALL_POLICY_REJECTED'});
    const selector=call=>String(call?.data||'').slice(0,10).toLowerCase();
    const validSwap=(call,tokenIn,tokenOut)=>{
      const words=decodeWords(call.data);
      return words.length===7&&wordAddress(words[0])===tokenIn&&wordAddress(words[1])===tokenOut&&wordUint(words[2])===fee&&
        wordAddress(words[3])===recipient&&wordUint(words[4])===amount&&wordUint(words[5])>0n&&wordUint(words[6])===0n;
    };
    if(side==='BUY'){
      const call=calls?.[0];
      if(calls?.length!==1||String(call?.to).toLowerCase()!==SWAP_ROUTER_02||selector(call)!==SELECTORS.exactInputSingle||BigInt(call.value||0)!==amount||!validSwap(call,WETH,token))throw Object.assign(new Error('buy call is outside router policy'),{code:'CALL_POLICY_REJECTED'});
      return true;
    }
    if(side==='SELL'){
      const [approve,swap,withdraw]=calls||[];
      const ok=calls?.length===3&&String(approve?.to).toLowerCase()===token&&selector(approve)===SELECTORS.approve&&BigInt(approve.value||0)===0n&&
        String(swap?.to).toLowerCase()===SWAP_ROUTER_02&&selector(swap)===SELECTORS.exactInputSingle&&BigInt(swap.value||0)===0n&&validSwap(swap,token,WETH)&&
        String(withdraw?.to).toLowerCase()===WETH&&selector(withdraw)===SELECTORS.withdraw&&BigInt(withdraw.value||0)===0n;
      if(!ok)throw Object.assign(new Error('sell calls are outside router policy'),{code:'CALL_POLICY_REJECTED'});
      const approvalWords=strip(approve.data).slice(8).match(/.{64}/g)||[];
      const spender=approvalWords[0]?`0x${approvalWords[0].slice(24)}`:null;
      const approved=approvalWords[1]?BigInt(`0x${approvalWords[1]}`):null;
      if(spender!==SWAP_ROUTER_02||approved!==amount)throw Object.assign(new Error('sell approval is not exact'),{code:'CALL_POLICY_REJECTED'});
      return true;
    }
    throw Object.assign(new Error('unsupported live side'),{code:'CALL_POLICY_REJECTED'});
  }
}

module.exports={LiveSwap,callData,encodeAddress,encodeUint,decodeFirstUint,decodeWords,minAfterSlippage,asHex};

'use strict';

const WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const V3_FACTORY='0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const QUOTER_V2='0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7';
const PONS_FACTORIES=[
  {version:'active',address:'0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',startBlock:8991118},
  {version:'legacy',address:'0x0c37a24f5d23a486fa692d1500881d698b1f77a4',startBlock:8600612}
];
const SELECTORS={
  getLaunchedToken:'3cf28b5a',liquidityPool:'665a11ca',totalSupply:'18160ddd',decimals:'313ce567',
  factory:'c45a0155',token0:'0dfe1681',token1:'d21220a7',fee:'ddca3f43',
  quoteExactInputSingle:'c6a5026a'
};
const ZERO_ADDRESS='0x0000000000000000000000000000000000000000';
const lower=v=>String(v||'').toLowerCase();
const validAddress=v=>/^0x[a-f0-9]{40}$/.test(lower(v));
const strip=v=>String(v||'').replace(/^0x/i,'');
const pad64=v=>strip(v).padStart(64,'0');
const callData=(selector,args=[])=>'0x'+selector+args.join('');
const encodeAddress=v=>pad64(lower(v));
const encodeUint=v=>pad64(BigInt(v).toString(16));

function words(result){
  const raw=strip(result);
  if(!raw||raw.length%64!==0||!/^[a-fA-F0-9]+$/.test(raw))return[];
  return raw.match(/.{64}/g)||[];
}
function wordAddress(word){return word?'0x'+word.slice(24).toLowerCase():null;}
function wordBigInt(word){try{return BigInt('0x'+word)}catch{return null;}}
function wordNumber(word){const n=wordBigInt(word);return n==null?null:Number(n);}
function wordBool(word){const n=wordBigInt(word);return n==null?null:n!==0n;}
function addressResult(result){return wordAddress(words(result)[0]);}
function bigintResult(result){return wordBigInt(words(result)[0]);}
function numberResult(result){return wordNumber(words(result)[0]);}

function unitsFromNumber(value,decimals){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0||!Number.isInteger(decimals)||decimals<0||decimals>36)return null;
  const precision=Math.min(decimals,8);
  const fixed=n.toFixed(precision);
  if(/e/i.test(fixed))return null;
  const [whole,frac='']=fixed.split('.');
  return BigInt(whole)*10n**BigInt(decimals)+BigInt((frac+'0'.repeat(decimals)).slice(0,decimals)||'0');
}
function numberFromUnits(value,decimals=18){
  try{
    const n=BigInt(value),base=10n**BigInt(decimals),whole=n/base,frac=n%base;
    return Number(`${whole}.${frac.toString().padStart(decimals,'0').slice(0,12)}`);
  }catch{return null;}
}
const round=(n,d=2)=>Number(Number(n).toFixed(d));

function decodeLaunch(result,factory){
  const w=words(result);
  if(w.length<13)return null;
  return{
    factory:factory.address,version:factory.version,startBlock:factory.startBlock,
    token:wordAddress(w[0]),deployer:wordAddress(w[1]),pairedToken:wordAddress(w[2]),
    positionManager:wordAddress(w[3]),positionId:wordBigInt(w[4]),dexId:wordBigInt(w[5]),
    launchConfigId:wordBigInt(w[6]),restrictionsEndBlock:wordNumber(w[7]),supply:wordBigInt(w[8]),
    isToken0:wordBool(w[9]),poolFee:wordNumber(w[10]),exists:wordBool(w[11]),initialBuyAmount:wordBigInt(w[12])
  };
}

class TokenIntelligence{
  constructor({rpc,targetsUsd=[100,250,1000],primaryTargetUsd=250,cacheMs=5*60*1000}={}){
    if(typeof rpc!=='function')throw new Error('TokenIntelligence requires an rpc function');
    this.rpc=rpc;
    this.targetsUsd=[...new Set((targetsUsd||[]).map(Number).filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>a-b);
    this.primaryTargetUsd=Number(primaryTargetUsd)||250;
    if(!this.targetsUsd.includes(this.primaryTargetUsd))this.targetsUsd.push(this.primaryTargetUsd);
    this.targetsUsd.sort((a,b)=>a-b);
    this.cacheMs=Math.max(1000,Number(cacheMs)||300000);
    this.cache=new Map();
  }

  async ethCall(to,data){return this.rpc('eth_call',[{to,data},'latest']);}

  async findPonsLaunch(token){
    const data=callData(SELECTORS.getLaunchedToken,[encodeAddress(token)]);
    for(const factory of PONS_FACTORIES){
      try{
        const launch=decodeLaunch(await this.ethCall(factory.address,data),factory);
        if(launch?.exists&&launch.token===token)return launch;
      }catch{}
    }
    return null;
  }

  async quoteSell({token,decimals,poolFee,market,targetUsd}){
    const priceUsd=Number(market?.priceUsd),priceNative=Number(market?.priceNative);
    if(!(priceUsd>0)||!(priceNative>0))return null;
    const amountTokens=targetUsd/priceUsd;
    const amountIn=unitsFromNumber(amountTokens,decimals);
    if(!amountIn||amountIn<=0n)return null;
    const data=callData(SELECTORS.quoteExactInputSingle,[
      encodeAddress(token),encodeAddress(WETH),encodeUint(amountIn),encodeUint(poolFee),encodeUint(0)
    ]);
    const out=bigintResult(await this.ethCall(QUOTER_V2,data));
    if(!out||out<=0n)return null;
    const amountOutWeth=numberFromUnits(out,18);
    const spotOutWeth=amountTokens*priceNative;
    if(!(amountOutWeth>=0)||!(spotOutWeth>0))return null;
    const executionRatio=Math.max(0,Math.min(1,amountOutWeth/spotOutWeth));
    return{
      targetUsd,amountInRaw:amountIn.toString(),amountOutRaw:out.toString(),
      proceedsUsd:round(targetUsd*executionRatio),sellImpactPct:round((1-executionRatio)*100),
      source:'pons-quoter-v2'
    };
  }

  unknownResult(reason,market={}){
    return{
      safety:{tokenControl:'UNKNOWN',upgradeAuthority:'UNKNOWN',canonicalLp:'UNKNOWN',sellRestriction:'UNKNOWN'},
      safetyEvidence:{source:'onchain',provenance:'unknown',reason,evaluatedAt:new Date().toISOString()},
      execution:{
        liquidityUsd:market?.liquidityUsd??null,pairAddress:market?.pairAddress??null,
        dexId:market?.dexId??null,marketSource:market?.marketSource??null,
        exitQuoteStatus:'UNKNOWN',exitabilityTargetUsd:this.primaryTargetUsd,exitQuotes:[]
      }
    };
  }

  async inspect(tokenAddress,market={},options={}){
    const token=lower(tokenAddress);
    if(!validAddress(token))return this.unknownResult('invalid_token_address',market);
    const cached=this.cache.get(token);
    if(!options.force&&cached&&Date.now()-cached.at<this.cacheMs)return cached.value;

    let launch,tokenCode,currentBlock,pool,totalSupply,decimals;
    const reads=await Promise.allSettled([
      this.findPonsLaunch(token),
      this.rpc('eth_getCode',[token,'latest']),
      this.rpc('eth_blockNumber',[]),
      this.ethCall(token,callData(SELECTORS.liquidityPool)),
      this.ethCall(token,callData(SELECTORS.totalSupply)),
      this.ethCall(token,callData(SELECTORS.decimals))
    ]);
    [launch,tokenCode,currentBlock,pool,totalSupply,decimals]=reads.map(r=>r.status==='fulfilled'?r.value:null);
    if(!launch){
      const result=this.unknownResult(tokenCode==='0x'?'not_a_contract':'not_verified_pons_launch',market);
      this.cache.set(token,{at:Date.now(),value:result});
      return result;
    }

    pool=addressResult(pool);
    totalSupply=bigintResult(totalSupply);
    decimals=numberResult(decimals);
    const blockNumber=typeof currentBlock==='string'?Number.parseInt(currentBlock,16):Number(currentBlock);
    const poolReads=validAddress(pool)&&pool!==ZERO_ADDRESS?await Promise.allSettled([
      this.rpc('eth_getCode',[pool,'latest']),
      this.ethCall(pool,callData(SELECTORS.factory)),
      this.ethCall(pool,callData(SELECTORS.token0)),
      this.ethCall(pool,callData(SELECTORS.token1)),
      this.ethCall(pool,callData(SELECTORS.fee))
    ]):[];
    const poolValues=poolReads.map(r=>r.status==='fulfilled'?r.value:null);
    const poolCode=poolValues[0],poolFactory=addressResult(poolValues[1]);
    const token0=addressResult(poolValues[2]),token1=addressResult(poolValues[3]),poolFee=numberResult(poolValues[4]);

    let tokenControl='UNKNOWN';
    if(tokenCode==='0x')tokenControl='FAIL';
    else if(totalSupply!=null&&launch.supply!=null)tokenControl=totalSupply===launch.supply&&totalSupply>0n?'PASS':'FAIL';

    const upgradeAuthority=tokenCode&&tokenCode!=='0x'?'PASS':'UNKNOWN';
    const poolReadsComplete=poolCode!=null&&poolFactory&&token0&&token1&&poolFee!=null;
    const poolMatches=poolReadsComplete&&poolCode!=='0x'&&poolFactory===V3_FACTORY&&
      new Set([token0,token1]).size===2&&new Set([token0,token1]).has(token)&&
      new Set([token0,token1]).has(WETH)&&poolFee===launch.poolFee&&launch.pairedToken===WETH;
    const canonicalLp=poolReadsComplete?(poolMatches?'PASS':'FAIL'):'UNKNOWN';
    const sellRestriction=tokenControl==='PASS'?'PASS':'UNKNOWN';

    const quotes=[];
    if(canonicalLp==='PASS'&&Number.isInteger(decimals)){
      for(const targetUsd of this.targetsUsd){
        try{
          const quote=await this.quoteSell({token,decimals,poolFee:launch.poolFee,market,targetUsd});
          if(quote)quotes.push(quote);
        }catch{}
      }
    }
    const primary=quotes.find(q=>q.targetUsd===this.primaryTargetUsd)||null;
    const marketPair=lower(market?.pairAddress);
    const result={
      safety:{tokenControl,upgradeAuthority,canonicalLp,sellRestriction},
      safetyEvidence:{
        source:'pons-onchain',provenance:`pons-${launch.version}`,factory:launch.factory,deployer:launch.deployer,
        tokenSupplyMatches:totalSupply!=null&&launch.supply!=null?totalSupply===launch.supply:null,
        immutableVersionedContracts:true,pairedToken:launch.pairedToken,canonicalPool:pool,
        poolFactory,poolFee,marketPairMatches:validAddress(marketPair)?marketPair===pool:null,
        restrictionsEndBlock:launch.restrictionsEndBlock,currentBlock:Number.isFinite(blockNumber)?blockNumber:null,
        launchProtectionActive:Number.isFinite(blockNumber)&&launch.restrictionsEndBlock!=null?blockNumber<=launch.restrictionsEndBlock:null,
        sellAndTransfersUnrestrictedByProtocol:true,evaluatedAt:new Date().toISOString()
      },
      execution:{
        liquidityUsd:market?.liquidityUsd??null,pairAddress:pool||market?.pairAddress||null,
        dexId:market?.dexId??'uniswap',marketSource:market?.marketSource??null,
        exitQuoteStatus:primary?'PASS':'UNKNOWN',exitabilityTargetUsd:this.primaryTargetUsd,
        sellImpactPct:primary?.sellImpactPct??null,estimatedProceedsUsd:primary?.proceedsUsd??null,
        exitQuotes:quotes,quoteSource:quotes.length?'pons-quoter-v2':null
      }
    };
    this.cache.set(token,{at:Date.now(),value:result});
    return result;
  }
}

module.exports={TokenIntelligence,PONS_FACTORIES,WETH,V3_FACTORY,QUOTER_V2,SELECTORS,decodeLaunch,unitsFromNumber,numberFromUnits};

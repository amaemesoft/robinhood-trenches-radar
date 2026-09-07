'use strict';

function decodeContractString(hex){
  const raw=String(hex||'').replace(/^0x/i,'');
  if(!raw||!/^[a-fA-F0-9]+$/.test(raw))return null;
  try{
    const first=raw.slice(0,64);
    const offset=Number(BigInt('0x'+first))*2;
    let body;
    if(offset>=64&&offset+64<=raw.length){
      const length=Number(BigInt('0x'+raw.slice(offset,offset+64)));
      body=raw.slice(offset+64,offset+64+length*2);
    }else body=first;
    const value=Buffer.from(body,'hex').toString('utf8').replace(/\0+$/,'').trim();
    return value||null;
  }catch{return null;}
}

function cleanTicker(value){
  const v=String(value||'').trim().replace(/^\$/,'');
  return v||null;
}

function displayLabel(name,symbol,address=''){
  const n=String(name||'').trim();
  const ticker=cleanTicker(symbol);
  if(n&&ticker)return `${n} ($${ticker})`;
  if(n)return n;
  if(ticker&&!/^0x[a-fA-F0-9]{6,}$/.test(ticker))return `$${ticker}`;
  return String(address||'TOKEN').slice(0,8);
}

async function resolveDexIdentity(address,fetchImpl=globalThis.fetch){
  if(typeof fetchImpl!=='function')return{verified:null,name:null,symbol:null};
  try{
    const response=await fetchImpl(`https://api.dexscreener.com/tokens/v1/robinhood/${address}`,{
      headers:{accept:'application/json'},
      signal:typeof AbortSignal?.timeout==='function'?AbortSignal.timeout(10000):undefined
    });
    if(!response?.ok)return{verified:null,name:null,symbol:null};
    const rows=await response.json();
    const pairs=(Array.isArray(rows)?rows:[])
      .filter(pair=>pair?.chainId==='robinhood'&&String(pair?.baseToken?.address||'').toLowerCase()===String(address||'').toLowerCase())
      .sort((a,b)=>Number(b?.liquidity?.usd||0)-Number(a?.liquidity?.usd||0));
    if(!pairs.length)return{verified:false,name:null,symbol:null};
    const token=pairs[0]?.baseToken||{};
    const name=String(token.name||'').trim()||null;
    const symbol=cleanTicker(token.symbol);
    return{verified:true,name,symbol};
  }catch{return{verified:null,name:null,symbol:null};}
}

async function resolveTokenIdentity(rpc,address,fetchImpl=globalThis.fetch){
  const [codeResult,dex]=await Promise.all([
    (async()=>{try{return{ok:true,value:await rpc('eth_getCode',[address,'latest'])}}catch{return{ok:false,value:null}}})(),
    resolveDexIdentity(address,fetchImpl)
  ]);
  const code=codeResult.value;
  const contractExists=codeResult.ok?(!!code&&code!=='0x'&&code!=='0x0'):null;
  if(contractExists===false)return{contractExists:false,name:null,symbol:null};
  if(contractExists===true){
    const reads=await Promise.allSettled([
      rpc('eth_call',[{to:address,data:'0x06fdde03'},'latest']),
      rpc('eth_call',[{to:address,data:'0x95d89b41'},'latest'])
    ]);
    const rpcName=reads[0].status==='fulfilled'?decodeContractString(reads[0].value):null;
    const rpcSymbol=reads[1].status==='fulfilled'?decodeContractString(reads[1].value):null;
    return{contractExists:true,name:rpcName||dex.name||null,symbol:cleanTicker(rpcSymbol)||dex.symbol||null};
  }
  if(dex.verified===true)return{contractExists:true,name:dex.name||null,symbol:dex.symbol||null};
  if(dex.verified===false)return{contractExists:false,name:null,symbol:null};
  return{contractExists:null,name:null,symbol:null};
}

module.exports={decodeContractString,cleanTicker,displayLabel,resolveDexIdentity,resolveTokenIdentity};

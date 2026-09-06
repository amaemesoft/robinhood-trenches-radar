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

async function resolveTokenIdentity(rpc,address){
  let code;
  try{code=await rpc('eth_getCode',[address,'latest'])}
  catch{return{contractExists:null,name:null,symbol:null}}
  if(!code||code==='0x'||code==='0x0')return{contractExists:false,name:null,symbol:null};
  const reads=await Promise.allSettled([
    rpc('eth_call',[{to:address,data:'0x06fdde03'},'latest']),
    rpc('eth_call',[{to:address,data:'0x95d89b41'},'latest'])
  ]);
  const name=reads[0].status==='fulfilled'?decodeContractString(reads[0].value):null;
  const symbol=reads[1].status==='fulfilled'?decodeContractString(reads[1].value):null;
  return{contractExists:true,name:name||null,symbol:cleanTicker(symbol)};
}

module.exports={decodeContractString,cleanTicker,displayLabel,resolveTokenIdentity};

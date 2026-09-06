'use strict';

const crypto=require('crypto');
const lower=a=>String(a||'').toLowerCase();

function rawBigInt(v){
  try{return BigInt(String(v??'0'));}catch{return 0n;}
}

function formatUnits(raw,decimals=18){
  try{
    let v=BigInt(String(raw||'0')),neg=v<0n;if(neg)v=-v;
    const s=v.toString().padStart(decimals+1,'0');
    const whole=s.slice(0,-decimals)||'0';
    const frac=decimals?s.slice(-decimals).replace(/0+$/,''):'';
    return (neg?'-':'')+whole+(frac?'.'+frac.slice(0,8):'');
  }catch{return null;}
}

function isValidSignature(rawBody,signature,signingKey){
  if(!rawBody||!signature||!signingKey)return false;
  const expected=crypto.createHmac('sha256',signingKey).update(rawBody,'utf8').digest();
  let actual;try{actual=Buffer.from(String(signature),'hex');}catch{return false;}
  return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
}

function activityHash(a){return a?.hash||a?.log?.transactionHash||null;}
function blockNumber(a){
  const v=a?.blockNum??a?.log?.blockNumber;
  if(v==null)return null;
  if(typeof v==='string'&&/^0x/i.test(v))return Number.parseInt(v,16)||null;
  return Number(v)||null;
}
function rawTransferValue(a){
  const raw=a?.rawContract?.rawValue??a?.log?.data;
  if(raw!=null){const v=rawBigInt(raw);if(v>0n)return{value:v,approximate:false};}
  const numeric=Number(a?.value||0);
  return numeric>0?{value:1n,approximate:true}:{value:0n,approximate:false};
}
function isNft(a){
  const c=lower(a?.category);
  return c==='erc721'||c==='erc1155'||a?.erc721TokenId!=null||Array.isArray(a?.erc1155Metadata);
}
function tokenAddress(a){return lower(a?.rawContract?.address||a?.log?.address);}

function parseAddressActivity(payload,walletMap,{isQuoteToken=()=>false}={}){
  if(payload?.type!=='ADDRESS_ACTIVITY')return[];
  const activities=Array.isArray(payload?.event?.activity)?payload.event.activity:[];
  const byTx=new Map();
  for(const a of activities){
    const hash=activityHash(a);
    if(!hash)continue;
    if(!byTx.has(hash))byTx.set(hash,[]);
    byTx.get(hash).push(a);
  }
  const rows=[];
  for(const [txHash,items] of byTx){
    const involved=new Set();
    for(const a of items){
      const from=lower(a?.fromAddress),to=lower(a?.toAddress);
      if(walletMap.has(from))involved.add(from);
      if(walletMap.has(to))involved.add(to);
    }
    const at=payload?.createdAt||new Date().toISOString();
    const first=items[0]||{};
    for(const wallet of involved){
      const deltas=new Map(),meta=new Map();
      let nativeDelta=0n,nativeApproximate=false;
      for(const a of items){
        const from=lower(a?.fromAddress),to=lower(a?.toAddress);
        const category=lower(a?.category);
        const {value,approximate}=rawTransferValue(a);
        if((category==='external'||category==='internal')&&String(a?.asset||'').toUpperCase()==='ETH'){
          if(from===wallet)nativeDelta-=value;
          if(to===wallet)nativeDelta+=value;
          nativeApproximate=nativeApproximate||approximate;
          continue;
        }
        if(isNft(a))continue;
        const token=tokenAddress(a);
        if(!/^0x[a-f0-9]{40}$/.test(token)||value===0n)continue;
        let d=0n;if(from===wallet)d-=value;if(to===wallet)d+=value;
        if(!d)continue;
        deltas.set(token,(deltas.get(token)||0n)+d);
        meta.set(token,{symbol:a?.asset||token.slice(0,8),decimals:Number(a?.rawContract?.decimals??18)});
      }
      const nonzero=[...deltas.entries()].filter(([,d])=>d!==0n);
      for(const [token,delta] of nonzero){
        if(isQuoteToken(token))continue;
        const p=meta.get(token)||{symbol:token.slice(0,8),decimals:18};
        const otherOutTokens=nonzero.filter(([t,d])=>t!==token&&d<0n).map(([t])=>t);
        const otherInTokens=nonzero.filter(([t,d])=>t!==token&&d>0n).map(([t])=>t);
        const nativeSpent=nativeDelta<0n,nativeReceived=nativeDelta>0n;
        let action;
        if(delta>0n)action=(otherOutTokens.length||nativeSpent)?'BUY':'ACQUIRE';
        else action=(otherInTokens.length||nativeReceived)?'SELL':'TRANSFER_OUT';
        rows.push({
          actorId:walletMap.get(wallet).id,wallet,action,tokenAddress:token,symbol:p.symbol,
          amountRaw:delta.toString(),amount:formatUnits(delta,p.decimals),txHash,
          blockNumber:blockNumber(first),blockHash:first?.log?.blockHash||null,at,
          source:'alchemy-webhook',signalRole:action==='BUY'?'execution':null,
          classificationEvidence:{
            otherTokenOut:otherOutTokens.length>0,otherTokenIn:otherInTokens.length>0,
            otherOutTokens,otherInTokens,nativeSpent,nativeReceived,
            nativeDeltaRaw:nativeDelta.toString(),nativeEvidenceApproximate:nativeApproximate,
            quoteAssetRule:'exact-contract',webhookEventId:payload?.id||null
          }
        });
      }
    }
  }
  return rows;
}

module.exports={isValidSignature,parseAddressActivity};

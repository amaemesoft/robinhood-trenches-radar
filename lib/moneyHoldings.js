'use strict';

const BALANCE_OF='0x70a08231';
const lower=v=>String(v||'').toLowerCase();
const validAddress=v=>/^0x[a-f0-9]{40}$/.test(lower(v));
const isProvisional=a=>a?.kind==='money'&&a?.attributionStatus==='provisional'&&Number(a?.sampleSize||0)<3;

function balanceOfData(wallet){
  const w=lower(wallet);
  if(!validAddress(w))throw new Error('invalid wallet address');
  return BALANCE_OF+w.slice(2).padStart(64,'0');
}

function parseBalance(hex){
  try{return BigInt(String(hex||'0x0'));}catch{return null;}
}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){
    while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length||1)},worker));
  return out;
}

class MoneyHoldingsProvider{
  constructor({rpc,concurrency=5}={}){this.rpc=rpc;this.concurrency=Math.max(1,Math.min(10,Number(concurrency)||5));}
  async snapshot(tokenAddress,actors=[]){
    const token=lower(tokenAddress);
    if(!validAddress(token))return{status:'UNKNOWN',reason:'invalid_token_address'};
    const money=(actors||[]).filter(a=>a?.kind==='money'&&a.enabled!==false&&validAddress(a.evmAddress));
    if(!money.length)return{status:'UNKNOWN',reason:'no_money_wallets'};
    if(typeof this.rpc!=='function')return{status:'UNKNOWN',reason:'rpc_unavailable'};
    const rows=await mapLimit(money,this.concurrency,async actor=>{
      try{
        const raw=await this.rpc('eth_call',[{to:token,data:balanceOfData(actor.evmAddress)},'latest']);
        const balance=parseBalance(raw);
        if(balance==null)return{actorId:actor.id,status:'ERROR',provisional:isProvisional(actor)};
        return{actorId:actor.id,status:'OK',hasBalance:balance>0n,balanceRaw:balance.toString(),provisional:isProvisional(actor)};
      }catch(error){return{actorId:actor.id,status:'ERROR',error:error.message,provisional:isProvisional(actor)};}
    });
    const ok=rows.filter(r=>r.status==='OK');
    const qualified=ok.filter(r=>r.hasBalance&&!r.provisional);
    const provisional=ok.filter(r=>r.hasBalance&&r.provisional);
    const coverage=money.length?ok.length/money.length:0;
    return{
      status:coverage===1?'MEASURED':coverage>=0.6?'PARTIAL':'UNKNOWN',reason:coverage===1?'current_balances_measured':'partial_balance_coverage',
      observedAt:new Date().toISOString(),coverage:Number(coverage.toFixed(2)),tracked:money.length,checked:ok.length,
      qualifiedHolders:qualified.length,qualifiedActorIds:qualified.map(r=>r.actorId),
      provisionalHolders:provisional.length,provisionalActorIds:provisional.map(r=>r.actorId),rows
    };
  }
}

module.exports={MoneyHoldingsProvider,BALANCE_OF,validAddress,isProvisional,balanceOfData,parseBalance,mapLimit};

'use strict';

const DEFAULT_BASE_URL='https://api.fxtwitter.com';
const EVM_ADDRESS_RE=/\b0x[a-fA-F0-9]{40}\b/g;

function cleanHandle(value){
  return String(value||'').trim().replace(/^@/,'');
}

function extractEvmAddresses(text){
  const matches=String(text||'').match(EVM_ADDRESS_RE)||[];
  return [...new Set(matches.map(address=>address.toLowerCase()))];
}

function statusTimestamp(status){
  const raw=Number(status?.created_timestamp);
  if(Number.isFinite(raw)&&raw>0){
    const ms=raw>=1e12?raw:raw*1000;
    return new Date(ms).toISOString();
  }
  const parsed=Date.parse(status?.created_at||'');
  return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}

function normalizeStatus(status,expectedHandle){
  if(!status||typeof status!=='object')return null;
  const expected=cleanHandle(expectedHandle).toLowerCase();
  const author=cleanHandle(status.author?.username||status.author?.screen_name||status.author?.handle).toLowerCase();
  if(!expected||!author||author!==expected)return null;
  const id=String(status.id||'').trim();
  if(!id)return null;
  const addresses=extractEvmAddresses(status.text||status.raw_text?.text||'');
  if(!addresses.length)return null;
  return{
    id,
    handle:cleanHandle(expectedHandle),
    at:statusTimestamp(status),
    url:status.url||null,
    text:status.text||status.raw_text?.text||'',
    tokenAddresses:addresses
  };
}

class FxTwitterClient{
  constructor({baseUrl=DEFAULT_BASE_URL,fetchImpl=globalThis.fetch,timeoutMs=12000}={}){
    this.baseUrl=String(baseUrl||DEFAULT_BASE_URL).replace(/\/$/,'');
    this.fetch=fetchImpl;
    this.timeoutMs=Number(timeoutMs)||12000;
  }

  async latestStatuses(handle,{since,count=20}={}){
    const clean=cleanHandle(handle);
    if(!clean)return[];
    const url=new URL(`${this.baseUrl}/2/profile/${encodeURIComponent(clean)}/statuses`);
    url.searchParams.set('count',String(Math.max(1,Math.min(100,Number(count)||20))));
    if(since!=null&&Number.isFinite(Number(since)))url.searchParams.set('since',String(Number(since)));
    const response=await this.fetch(url,{
      headers:{accept:'application/json','user-agent':'Robinhood-Trenches-Radar/0.4'},
      signal:AbortSignal.timeout(this.timeoutMs)
    });
    if(response.status===204)return[];
    let payload={};
    try{payload=await response.json();}catch{}
    if(response.status===404&&Array.isArray(payload?.results))return[];
    if(!response.ok)throw new Error(`FxTwitter HTTP ${response.status}`);
    const rows=Array.isArray(payload?.results)?payload.results:[];
    return rows.map(row=>normalizeStatus(row,clean)).filter(Boolean);
  }
}

module.exports={FxTwitterClient,cleanHandle,extractEvmAddresses,statusTimestamp,normalizeStatus};

'use strict';

const {FomoScanClient}=require('./lib/fomoscan');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/,'');
const INTERNAL_SYNC_TOKEN = process.env.INTERNAL_SYNC_TOKEN || '';
const WRITE_API_TOKEN = process.env.WRITE_API_TOKEN || '';
const RH_RPC_URL = process.env.RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const FOMOSCAN_API_KEY = process.env.FOMOSCAN_API_KEY || '';
const FOMOSCAN_API_BASE = process.env.FOMOSCAN_API_BASE || 'https://api.fomoscan.sh';
const POLL_SECONDS = Math.max(60, Number(process.env.POLL_SECONDS || 120));
const SOCIAL_IDENTITY_REFRESH_MS = Math.max(3600000, Number(process.env.SOCIAL_IDENTITY_REFRESH_MS || 21600000));
const fomo=new FomoScanClient({apiKey:FOMOSCAN_API_KEY,baseUrl:FOMOSCAN_API_BASE});

if(!INTERNAL_SYNC_TOKEN){
  console.error('INTERNAL_SYNC_TOKEN is required');
  process.exit(1);
}

let running = false;
let fomoActors=new Map();
let identityRefreshedAt=0;
let socialReadyLogged=false;

async function dashboard(){
  const response=await fetch(`${APP_BASE_URL}/api/dashboard`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`dashboard HTTP ${response.status}`);
  return response.json();
}

async function resolveSocialActors(data){
  if(!fomo.enabled())return;
  if(fomoActors.size&&Date.now()-identityRefreshedAt<SOCIAL_IDENTITY_REFRESH_MS)return;
  const social=(data.actors||[]).filter(actor=>actor.kind==='social'&&actor.enabled!==false);
  const next=new Map();
  for(let i=0;i<social.length;i+=4){
    const chunk=social.slice(i,i+4);
    const rows=await Promise.all(chunk.map(async actor=>{
      try{
        const identity=await fomo.resolveHandle(actor.xHandle||actor.handle);
        return identity?.id?[identity.id,actor.id]:null;
      }catch(error){
        if(!/HTTP 404/.test(error.message))console.warn(`[social] identity ${actor.handle}: ${error.message}`);
        return null;
      }
    }));
    for(const row of rows)if(row)next.set(row[0],row[1]);
  }
  if(next.size)fomoActors=next;
  identityRefreshedAt=Date.now();
  console.log(`[social] resolved ${fomoActors.size}/${social.length} candidate handles via FomoScan`);
}

async function existsOnRobinhood(tokenAddress){
  const response=await fetch(RH_RPC_URL,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getCode',params:[tokenAddress,'latest']}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return false;
  const payload=await response.json();
  const code=String(payload?.result||'').toLowerCase();
  return /^0x[0-9a-f]+$/.test(code)&&code!=='0x'&&code!=='0x0'&&code!=='0x00';
}

async function postScout({key,actorId,tokenAddress,at}){
  const response=await fetch(`${APP_BASE_URL}/api/events`,{
    method:'POST',
    headers:{authorization:`Bearer ${WRITE_API_TOKEN}`,'content-type':'application/json'},
    body:JSON.stringify({key,actorId,action:'SCOUT',tokenAddress,at:at||new Date().toISOString(),signalRole:'discovery',source:'fomoscan-thesis'}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok){
    const text=await response.text();
    throw new Error(`SCOUT HTTP ${response.status}: ${text.slice(0,300)}`);
  }
}

async function syncSocial(){
  if(!fomo.enabled()||!WRITE_API_TOKEN){
    if(!socialReadyLogged){
      console.log(`[social] prepared; ${!FOMOSCAN_API_KEY?'awaiting FOMOSCAN_API_KEY':'WRITE_API_TOKEN unavailable'}`);
      socialReadyLogged=true;
    }
    return{status:'awaiting-key',scouts:0};
  }
  const data=await dashboard();
  await resolveSocialActors(data);
  if(!fomoActors.size)return{status:'live',scouts:0,reason:'no_candidate_identities_resolved'};
  const existing=new Set((data.recentEvents||[]).map(event=>event.key).filter(Boolean));
  const theses=await fomo.latestTheses();
  let scouts=0,foreign=0,ignored=0;
  for(const thesis of theses){
    const actorId=fomoActors.get(thesis.authorId);
    const key=`fomo:${thesis.id}`;
    if(!actorId||existing.has(key)){ignored++;continue;}
    if(!(await existsOnRobinhood(thesis.tokenAddress))){foreign++;continue;}
    await postScout({key,actorId,tokenAddress:thesis.tokenAddress,at:thesis.at});
    existing.add(key);
    scouts++;
  }
  if(scouts||foreign)console.log(`[social] ${scouts} new Robinhood SCOUT(s) · ${foreign} non-Robinhood contract(s) rejected`);
  return{status:'live',scouts,foreign,ignored,candidates:fomoActors.size};
}

async function syncOnchain(){
  const r = await fetch(`${APP_BASE_URL}/api/internal/sync`, {
    method:'POST',
    headers:{'authorization':`Bearer ${INTERNAL_SYNC_TOKEN}`,'content-type':'application/json'},
    body:'{}',
    signal:AbortSignal.timeout(90000)
  });
  const text = await r.text();
  if(!r.ok) throw new Error(`sync HTTP ${r.status}: ${text.slice(0,500)}`);
  return text;
}

async function tick(){
  if(running) return;
  running = true;
  try{
    let social;
    try{social=await syncSocial();}catch(error){console.error(`[social] ${new Date().toISOString()} ${error.message}`);}
    const text=await syncOnchain();
    const suffix=social?.status==='live'?` social=${social.scouts}`:'';
    console.log(`[worker] ${new Date().toISOString()} ${text}${suffix}`);
  }catch(e){
    console.error(`[worker] ${new Date().toISOString()} ${e.message}`);
  }finally{
    running = false;
  }
}

console.log(`[worker] polling ${APP_BASE_URL} every ${POLL_SECONDS}s`);
console.log(`[social] FomoScan ${fomo.enabled()?'configured':'not configured'}; SCOUT cannot create Alpha or satisfy economic confluence`);
setTimeout(tick, 1800);
setInterval(tick, POLL_SECONDS * 1000);

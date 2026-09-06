'use strict';

const {FomoScanClient}=require('./lib/fomoscan');
const {FxTwitterClient,cleanHandle}=require('./lib/fxTwitter');
const {TelegramPublicClient}=require('./lib/telegramPublic');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/,'');
const INTERNAL_SYNC_TOKEN = process.env.INTERNAL_SYNC_TOKEN || '';
const WRITE_API_TOKEN = process.env.WRITE_API_TOKEN || '';
const RH_RPC_URL = process.env.RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const FOMOSCAN_API_KEY = process.env.FOMOSCAN_API_KEY || '';
const FOMOSCAN_API_BASE = process.env.FOMOSCAN_API_BASE || 'https://api.fomoscan.sh';
const FXTWITTER_API_BASE = process.env.FXTWITTER_API_BASE || 'https://api.fxtwitter.com';
const TELEGRAM_PUBLIC_BASE = process.env.TELEGRAM_PUBLIC_BASE || 'https://t.me/s';
const POLL_SECONDS = Math.max(60, Number(process.env.POLL_SECONDS || 120));
const SOCIAL_LOOKBACK_MINUTES = Math.max(2, Number(process.env.SOCIAL_LOOKBACK_MINUTES || 10));
const SOCIAL_IDENTITY_REFRESH_MS = Math.max(3600000, Number(process.env.SOCIAL_IDENTITY_REFRESH_MS || 21600000));
const fomo=new FomoScanClient({apiKey:FOMOSCAN_API_KEY,baseUrl:FOMOSCAN_API_BASE});
const fx=new FxTwitterClient({baseUrl:FXTWITTER_API_BASE});
const telegram=new TelegramPublicClient({baseUrl:TELEGRAM_PUBLIC_BASE});

// Public channel <-> existing scout mappings are only added when the channel itself
// clearly links back to the tracked identity. Telegram remains discovery-only SCOUT.
const TELEGRAM_SCOUT_CHANNELS=[
  {actorId:'EricCryptoman',channel:'erics_calls'},
  {actorId:'KookCapitalLLC',channel:'hellokook'},
  {actorId:'GuarEmperor',channel:'guaremperor'},
  {actorId:'traderpow',channel:'PowsGemCalls'}
];

if(!INTERNAL_SYNC_TOKEN){
  console.error('INTERNAL_SYNC_TOKEN is required');
  process.exit(1);
}

let running = false;
let fomoActors=new Map();
let identityRefreshedAt=0;
let socialReadyLogged=false;
const fxSince=new Map();
const telegramSince=new Map();

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
        if(!/HTTP 404/.test(error.message))console.warn(`[social:fomo] identity ${actor.handle}: ${error.message}`);
        return null;
      }
    }));
    for(const row of rows)if(row)next.set(row[0],row[1]);
  }
  if(next.size)fomoActors=next;
  identityRefreshedAt=Date.now();
  console.log(`[social:fomo] resolved ${fomoActors.size}/${social.length} candidate handles`);
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

async function postScout({key,actorId,tokenAddress,at,source}){
  const response=await fetch(`${APP_BASE_URL}/api/events`,{
    method:'POST',
    headers:{authorization:`Bearer ${WRITE_API_TOKEN}`,'content-type':'application/json'},
    body:JSON.stringify({key,actorId,action:'SCOUT',tokenAddress,at:at||new Date().toISOString(),signalRole:'discovery',source:source||'social'}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok){
    const text=await response.text();
    throw new Error(`SCOUT HTTP ${response.status}: ${text.slice(0,300)}`);
  }
}

async function syncFxTwitter(data,existing){
  const social=(data.actors||[]).filter(actor=>actor.kind==='social'&&actor.enabled!==false);
  const initialSince=Date.now()-SOCIAL_LOOKBACK_MINUTES*60000;
  let scouts=0,foreign=0,posts=0,errors=0,ignored=0;

  for(let i=0;i<social.length;i+=4){
    const chunk=social.slice(i,i+4);
    const results=await Promise.all(chunk.map(async actor=>{
      const handle=cleanHandle(actor.xHandle||actor.handle);
      const since=fxSince.get(actor.id)||initialSince;
      try{
        const statuses=await fx.latestStatuses(handle,{since,count:20});
        return{actor,handle,since,statuses,error:null};
      }catch(error){
        return{actor,handle,since,statuses:[],error};
      }
    }));

    for(const result of results){
      if(result.error){
        errors++;
        console.warn(`[social:fx] ${result.handle}: ${result.error.message}`);
        continue;
      }
      posts+=result.statuses.length;
      let newest=result.since;
      for(const status of result.statuses){
        const atMs=Date.parse(status.at||'');
        if(Number.isFinite(atMs))newest=Math.max(newest,atMs);
        for(const tokenAddress of status.tokenAddresses){
          const key=`fx:${status.id}:${tokenAddress}`;
          if(existing.has(key)){ignored++;continue;}
          if(!(await existsOnRobinhood(tokenAddress))){foreign++;continue;}
          await postScout({key,actorId:result.actor.id,tokenAddress,at:status.at,source:'fxtwitter-public'});
          existing.add(key);
          scouts++;
        }
      }
      // Keep a short overlap so delayed timeline results are not missed; deterministic keys absorb repeats.
      fxSince.set(result.actor.id,Math.max(newest,Date.now()-60000));
    }
  }

  return{status:'live',provider:'fxtwitter-public',scouts,foreign,posts,errors,ignored,candidates:social.length};
}

async function syncTelegram(data,existing){
  const actors=new Map((data.actors||[]).map(actor=>[actor.id,actor]));
  const configured=TELEGRAM_SCOUT_CHANNELS
    .map(mapping=>({...mapping,actor:actors.get(mapping.actorId)}))
    .filter(row=>row.actor?.kind==='social'&&row.actor.enabled!==false);
  const initialSince=Date.now()-SOCIAL_LOOKBACK_MINUTES*60000;
  let scouts=0,foreign=0,posts=0,errors=0,ignored=0;

  const results=await Promise.all(configured.map(async row=>{
    const since=telegramSince.get(row.actorId)||initialSince;
    try{
      const messages=await telegram.latestPosts(row.channel);
      return{...row,since,messages,error:null};
    }catch(error){
      return{...row,since,messages:[],error};
    }
  }));

  for(const result of results){
    if(result.error){
      errors++;
      console.warn(`[social:telegram] @${result.channel}: ${result.error.message}`);
      continue;
    }
    let newest=result.since;
    for(const message of result.messages){
      const atMs=Date.parse(message.at||'');
      if(Number.isFinite(atMs))newest=Math.max(newest,atMs);
      // Do not backfill old Telegram calls on worker restarts. Public Telegram is an early-discovery feed.
      if(!Number.isFinite(atMs)||atMs<result.since){ignored++;continue;}
      posts++;
      for(const tokenAddress of message.tokenAddresses){
        const key=`telegram:${String(result.channel).toLowerCase()}:${message.id}:${tokenAddress}`;
        if(existing.has(key)){ignored++;continue;}
        if(!(await existsOnRobinhood(tokenAddress))){foreign++;continue;}
        await postScout({key,actorId:result.actorId,tokenAddress,at:message.at,source:'telegram-public'});
        existing.add(key);
        scouts++;
      }
    }
    telegramSince.set(result.actorId,Math.max(newest,Date.now()-60000));
  }

  return{status:'live',provider:'telegram-public',scouts,foreign,posts,errors,ignored,candidates:configured.length};
}

async function syncFomo(data,existing){
  if(!fomo.enabled())return{status:'disabled',scouts:0};
  await resolveSocialActors(data);
  if(!fomoActors.size)return{status:'live',scouts:0,reason:'no_candidate_identities_resolved'};
  const theses=await fomo.latestTheses();
  let scouts=0,foreign=0,ignored=0;
  for(const thesis of theses){
    const actorId=fomoActors.get(thesis.authorId);
    const key=`fomo:${thesis.id}`;
    if(!actorId||existing.has(key)){ignored++;continue;}
    if(!(await existsOnRobinhood(thesis.tokenAddress))){foreign++;continue;}
    await postScout({key,actorId,tokenAddress:thesis.tokenAddress,at:thesis.at,source:'fomoscan-thesis'});
    existing.add(key);
    scouts++;
  }
  return{status:'live',provider:'fomoscan-thesis',scouts,foreign,ignored,candidates:fomoActors.size};
}

async function syncSocial(){
  if(!WRITE_API_TOKEN){
    if(!socialReadyLogged){
      console.log('[social] WRITE_API_TOKEN unavailable; social ingestion disabled');
      socialReadyLogged=true;
    }
    return{status:'disabled',scouts:0};
  }
  const data=await dashboard();
  const existing=new Set((data.recentEvents||[]).map(event=>event.key).filter(Boolean));
  const [fxResult,telegramResult]=await Promise.all([
    syncFxTwitter(data,existing),
    syncTelegram(data,existing)
  ]);
  let fomoResult={status:'disabled',scouts:0};
  try{fomoResult=await syncFomo(data,existing);}catch(error){console.warn(`[social:fomo] ${error.message}`);}
  const scouts=fxResult.scouts+telegramResult.scouts+fomoResult.scouts;
  const noteworthy=scouts||fxResult.foreign||fxResult.errors||telegramResult.foreign||telegramResult.errors;
  if(noteworthy){
    console.log(`[social] fx=${fxResult.scouts} scout(s) · tg=${telegramResult.scouts} scout(s) · fxPosts=${fxResult.posts} · tgPosts=${telegramResult.posts} · rejected=${fxResult.foreign+telegramResult.foreign} · errors=${fxResult.errors+telegramResult.errors}${fomo.enabled()?` · fomo=${fomoResult.scouts}`:''}`);
  }
  return{status:'live',provider:'public-social',scouts,fx:fxResult,telegram:telegramResult,fomo:fomoResult};
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
console.log(`[social] FxTwitter + public Telegram live; FomoScan ${fomo.enabled()?'supplement enabled':'supplement disabled'}; SCOUT cannot create Alpha or satisfy economic confluence`);
setTimeout(tick, 1800);
setInterval(tick, POLL_SECONDS * 1000);

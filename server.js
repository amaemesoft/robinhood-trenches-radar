'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const {URL}=require('url');
const Engine=require('./lib/engine');
const Storage=require('./lib/storage');
const ChainScanner=require('./lib/chainScanner');
const LiveSubscriber=require('./lib/liveSubscriber');
const AlchemyWebhook=require('./lib/alchemyWebhook');
const {TokenIntelligence}=require('./lib/tokenIntelligence');
const Performance=require('./lib/performance');
const TokenIdentity=require('./lib/tokenIdentity');

const PORT=Number(process.env.PORT||8787);
const DATABASE_URL=process.env.DATABASE_URL||'';
const INTERNAL_SYNC_TOKEN=process.env.INTERNAL_SYNC_TOKEN||'';
const WRITE_API_TOKEN=process.env.WRITE_API_TOKEN||'';
const RH_RPC_URL=process.env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const RH_WSS_URL=process.env.RH_WSS_URL||'';
const BLOCKSCOUT_API_KEY=process.env.BLOCKSCOUT_API_KEY||'';
const ALCHEMY_WEBHOOK_ID=process.env.ALCHEMY_WEBHOOK_ID||'';
const ALCHEMY_WEBHOOK_SIGNING_KEY=process.env.ALCHEMY_WEBHOOK_SIGNING_KEY||'';
const BACKFILL_BLOCKS=Number(process.env.BACKFILL_BLOCKS||1200);
const MAX_BLOCK_RANGE=Number(process.env.MAX_BLOCK_RANGE||500);
const ALCHEMY_BACKFILL_BLOCKS=Number(process.env.ALCHEMY_BACKFILL_BLOCKS||604800);
const ALCHEMY_BACKFILL_MAX_PAGES=Number(process.env.ALCHEMY_BACKFILL_MAX_PAGES||10);
const EXIT_PRIMARY_TARGET_USD=Number(process.env.EXIT_PRIMARY_TARGET_USD||250);
const EXIT_TARGETS_USD=String(process.env.EXIT_TARGETS_USD||'100,250,1000').split(',').map(Number).filter(n=>Number.isFinite(n)&&n>0);
const ROOT=__dirname, PUBLIC=path.join(ROOT,'public'), DB_FILE=path.join(ROOT,'data','db.json');
const storage=new Storage({filePath:DB_FILE,databaseUrl:DATABASE_URL});
const scanner=new ChainScanner({rpcUrl:RH_RPC_URL,blockscoutApiKey:BLOCKSCOUT_API_KEY,backfillBlocks:BACKFILL_BLOCKS,maxBlockRange:MAX_BLOCK_RANGE,alchemyBackfillBlocks:ALCHEMY_BACKFILL_BLOCKS,alchemyBackfillMaxPages:ALCHEMY_BACKFILL_MAX_PAGES});
const intelligence=new TokenIntelligence({rpc:scanner.rpc.bind(scanner),targetsUsd:EXIT_TARGETS_USD,primaryTargetUsd:EXIT_PRIMARY_TARGET_USD});
let db;
let syncRunning=false;
let liveSubscriber=null;
let liveQueue=Promise.resolve();

function alchemyWebhookConfigured(){return !!ALCHEMY_WEBHOOK_ID&&!!ALCHEMY_WEBHOOK_SIGNING_KEY;}
function currentProvider(){return alchemyWebhookConfigured()?'alchemy-webhook':scanner.hasPro()?'blockscout-pro':'awaiting-provider-credentials';}

const seedActors=[
{id:'unipcs',handle:'unipcs',xHandle:'@theunipcs',kind:'money',role:'confirmation',identityConfidence:'verified',evmAddress:'0x0a6ebed0155edb4b21d92ad02897a626cd90119e',copyability:68,roleScores:{discovery:62,confirmation:91,execution:82}},
{id:'ether_monk',handle:'ether_monk',xHandle:'@ether_monk',kind:'money',role:'execution',identityConfidence:'strong',evmAddress:'0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0',copyability:76,roleScores:{discovery:45,confirmation:82,execution:92,reentry:90}},
{id:'DumbCrayonEater',handle:'DumbCrayonEater',kind:'money',role:'discovery',identityConfidence:'strong',evmAddress:'0x8f62a08537cede87d511aca6436274ab4ca080a3',copyability:50,roleScores:{discovery:92,confirmation:72,execution:58}},
{id:'AvgJoesCrypto',handle:'AvgJoesCrypto',xHandle:'@AvgJoesCrypto',kind:'money',role:'confirmation',identityConfidence:'strong',evmAddress:'0x06de9c48b1e639ed5c13ec8fbd4080a38e39f2d1',copyability:73,roleScores:{discovery:58,confirmation:88,execution:71}},
{id:'frankdegods',handle:'frankdegods',xHandle:'@frankdegods',kind:'money',role:'execution',identityConfidence:'verified',evmAddress:'0x696d1265c8fc4f14797abebfae3c43ebfa9d8e28',copyability:78,roleScores:{discovery:66,confirmation:72,execution:77}},
{id:'kenjidgn',handle:'kenjidgn',xHandle:'@kenjidgn',kind:'social',role:'discovery',identityConfidence:'unresolved',copyability:61,roleScores:{discovery:91,confirmation:55}},
{id:'KookCapitalLLC',handle:'KookCapitalLLC',xHandle:'@KookCapitalLLC',kind:'social',role:'discovery',identityConfidence:'unresolved',copyability:63,roleScores:{discovery:88,confirmation:61}},
{id:'GuarEmperor',handle:'GuarEmperor',xHandle:'@GuarEmperor',kind:'social',role:'discovery',identityConfidence:'unresolved',copyability:70,roleScores:{discovery:86,confirmation:64}},
{id:'Gleobets',handle:'Gleobets',xHandle:'@Gleobets',kind:'social',role:'discovery',identityConfidence:'unresolved',calls:5,recentEdge:72,lifetimeEdge:70,copyability:72,roleScores:{discovery:85}},
{id:'Cryptofather',handle:'Cryptofather',xHandle:'@Cryptofather',kind:'social',role:'discovery',identityConfidence:'unresolved',calls:5,recentEdge:69,lifetimeEdge:68,copyability:72,roleScores:{discovery:82}},
{id:'itsjustjaydot',handle:'itsjustjaydot',xHandle:'@itsjustjaydot',kind:'social',role:'discovery',identityConfidence:'unresolved',calls:10,recentEdge:70,lifetimeEdge:69,copyability:75,roleScores:{discovery:84}},
{id:'damskotrades',handle:'damskotrades',xHandle:'@damskotrades',kind:'social',role:'confirmation',identityConfidence:'unresolved',copyability:83,roleScores:{discovery:61,confirmation:84,narrative:78}},
{id:'iruletrenches',handle:'iruletrenches',xHandle:'@iruletrenches',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'Bluntz_Capital',handle:'Bluntz_Capital',xHandle:'@Bluntz_Capital',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'EricCryptoman',handle:'EricCryptoman',xHandle:'@EricCryptoman',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'cottonxbt',handle:'cottonxbt',xHandle:'@cottonxbt',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'traderpow',handle:'traderpow',xHandle:'@traderpow',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'KieranWarwick',handle:'KieranWarwick',xHandle:'@KieranWarwick',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'MINHxDYNASTY',handle:'MINHxDYNASTY',xHandle:'@MINHxDYNASTY',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'PhilOnChain',handle:'PhilOnChain',xHandle:'@PhilOnChain',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'RevengeTrador',handle:'RevengeTrador',xHandle:'@RevengeTrador',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'kyle',handle:'kyle',xHandle:'@kyle',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'econoar',handle:'econoar',xHandle:'@econoar',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'eddie_bellotti',handle:'eddie_bellotti',xHandle:'@eddie_bellotti',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'rittykiddo',handle:'rittykiddo',xHandle:'@rittykiddo',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'IoachimViju',handle:'IoachimViju',xHandle:'@IoachimViju',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'FlapCommunity',handle:'FlapCommunity',xHandle:'@FlapCommunity',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'votesa',handle:'votesa',xHandle:'@votesa',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'Chrisbiz96sats',handle:'Chrisbiz96sats',xHandle:'@Chrisbiz96sats',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'stoopidnobody',handle:'stoopidnobody',xHandle:'@stoopidnobody',kind:'social',role:'discovery',identityConfidence:'unresolved'},
{id:'ChristianDior31',handle:'ChristianDior31',xHandle:'@ChristianDior31',kind:'social',role:'discovery',identityConfidence:'unresolved'}
].map(a=>({...a,enabled:true,sampleSize:a.calls||0,lastEventAt:null}));

function mergeSeedActors(existing=[]){
  const remaining=new Map((existing||[]).map(a=>[a.id,a]));
  const merged=seedActors.map(seed=>{
    const current=remaining.get(seed.id);
    if(!current)return{...seed};
    remaining.delete(seed.id);
    return{...seed,...current,roleScores:{...(seed.roleScores||{}),...(current.roleScores||{})}};
  });
  return[...merged,...remaining.values()];
}

function initial(){const now=new Date().toISOString();return{version:9,createdAt:now,updatedAt:now,actors:seedActors,events:[],tokenState:{},marketHistory:{},alerts:[],sync:{lastChainSync:null,lastScannedBlock:null,lastError:null,lastScan:null,alchemyBackfill:null,ws:null,lastLiveTx:null,provider:currentProvider()}}}
const save=()=>storage.save(db);
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body))};
const auth=(req,token)=>!!token&&req.headers.authorization===`Bearer ${token}`;
function rawBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)reject(new Error('body too large'))});req.on('end',()=>resolve(s));req.on('error',reject)})}
function body(req){return rawBody(req).then(s=>{try{return s?JSON.parse(s):{}}catch(e){throw e}})}
function staticFile(res,p){let rel=p==='/'?'index.html':p.replace(/^\//,'');rel=path.normalize(rel).replace(/^\.\.(\/|\\|$)/,'');const f=path.join(PUBLIC,rel);if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return false;const ext=path.extname(f);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public,max-age=300'});fs.createReadStream(f).pipe(res);return true}
function actorMap(){const out={};for(const a of db.actors){a.adaptiveScore=Engine.adaptiveActorScore(a);a.division=Engine.division(a.sampleSize||a.calls||0,a.kind);out[a.id]=a}return out}
function moneyWalletMap(){return new Map(db.actors.filter(a=>a.kind==='money'&&a.enabled!==false&&/^0x[a-fA-F0-9]{40}$/.test(a.evmAddress||'')).map(a=>[a.evmAddress.toLowerCase(),a]));}
function calibration(){return Performance.calibrationReport(Object.values(actorMap()),db.events,db.marketHistory||{});}
function signals(){const actors=actorMap(),groups=new Map(),cut=Date.now()-24*3600e3;for(const e of db.events){if(new Date(e.at).getTime()<cut)continue;(groups.get(e.tokenAddress)||groups.set(e.tokenAddress,[]).get(e.tokenAddress)).push(e)}const out=[];for(const[address,events]of groups){const st=db.tokenState[address]||{};const latest=[...events].sort((a,b)=>new Date(b.at)-new Date(a.at))[0];let result=Engine.evaluateToken({events,actors,safety:st.safety||{},execution:{...(st.execution||{}),currentMarketCap:st.marketCap||latest.marketCap||null},token:{marketCap:st.marketCap||latest.marketCap||null}});const socialOnly=events.every(e=>e.action==='SCOUT');if(socialOnly&&st.contractExists===false)result={...result,state:'IGNORE',reason:'not_robinhood_contract'};const ticker=st.tokenSymbol||latest.symbol||null;const name=st.tokenName||null;out.push({tokenAddress:address,name,ticker,symbol:TokenIdentity.displayLabel(name,ticker,address),contractExists:st.contractExists??null,lastSeen:latest.at,events,...result,liquidityUsd:st.execution?.liquidityUsd||null,priceUsd:st.priceUsd||null,exitabilityTargetUsd:st.execution?.exitabilityTargetUsd||null,sellImpactPct:st.execution?.sellImpactPct??null,exitQuotes:st.execution?.exitQuotes||[],safetyEvidence:st.safetyEvidence||null})}return out.sort((a,b)=>b.score-a.score)}
function dashboard(){const actors=Object.values(actorMap()),ss=signals(),cal=calibration();return{generatedAt:new Date().toISOString(),summary:{actors:actors.length,money:actors.filter(a=>a.kind==='money').length,social:actors.filter(a=>a.kind==='social').length,resolved:actors.filter(a=>a.evmAddress).length,entryCandidates:ss.filter(s=>['ENTRY_CANDIDATE','HIGH_CONFLUENCE'].includes(s.state)).length,distribution:ss.filter(s=>s.state==='DISTRIBUTION').length},signals:ss,recentEvents:db.events.slice(0,100),actors:actors.sort((a,b)=>b.adaptiveScore-a.adaptiveScore),calibration:cal,sync:db.sync}}

function recordMarketSnapshot(address,state){
  if(!(Number(state?.priceUsd)>0))return;
  const observedAt=state.observedAt||new Date().toISOString();
  const snapshot={at:observedAt,priceUsd:Number(state.priceUsd),marketCap:state.marketCap??null,liquidityUsd:state.execution?.liquidityUsd??null};
  db.marketHistory=db.marketHistory||{};
  const history=db.marketHistory[address]||[];
  const last=history.at(-1);
  if(last&&Math.abs(Date.parse(observedAt)-Date.parse(last.at))<60000)history[history.length-1]=snapshot;
  else history.push(snapshot);
  db.marketHistory[address]=history.slice(-2200);
  const observedMs=Date.parse(observedAt);
  for(const event of db.events){
    if(event.tokenAddress!==address||!Performance.ENTRY_ACTIONS.has(event.action)||event.referencePriceUsd)continue;
    const eventMs=Date.parse(event.at||'');
    if(Number.isFinite(eventMs)&&Number.isFinite(observedMs)&&observedMs>=eventMs&&observedMs-eventMs<=10*60*1000){
      event.referencePriceUsd=snapshot.priceUsd;event.priceObservedAt=observedAt;
      if(snapshot.marketCap!=null)event.marketCap=snapshot.marketCap;
      if(snapshot.liquidityUsd!=null)event.liquidityUsd=snapshot.liquidityUsd;
    }
  }
}

function mergeTokenState(address,state){
  const old=db.tokenState[address]||{};
  db.tokenState[address]={...old,...state,execution:{...(old.execution||{}),...(state.execution||{})},safety:{...(old.safety||{}),...(state.safety||{})}};
  recordMarketSnapshot(address,db.tokenState[address]);
}

async function storeEvents(rows,tokenStates={}){
  const existingKeys=new Set(db.events.map(e=>e.key).filter(Boolean));
  const fresh=[];
  for(const [address,state] of Object.entries(tokenStates||{}))mergeTokenState(address,state);
  for(const e of rows||[]){
    e.key=e.key||`${e.txHash}:${e.actorId}:${e.tokenAddress}`;
    if(existingKeys.has(e.key))continue;
    existingKeys.add(e.key);
    const st=tokenStates?.[e.tokenAddress];
    if(st?.marketCap)e.marketCap=st.marketCap;
    if(st?.execution?.liquidityUsd)e.liquidityUsd=st.execution.liquidityUsd;
    const a=db.actors.find(x=>x.id===e.actorId);
    if(a&&(!a.lastEventAt||new Date(e.at)>new Date(a.lastEventAt)))a.lastEventAt=e.at;
    fresh.push(e);
  }
  if(fresh.length)db.events=[...fresh,...db.events].slice(0,5000);
  return fresh;
}

async function buildTokenState(token,force=false){
  const [m,identity]=await Promise.all([
    scanner.market(token,force),
    TokenIdentity.resolveTokenIdentity(scanner.rpc.bind(scanner),token)
  ]);
  const marketState=m?{
    marketCap:m.marketCap,priceUsd:m.priceUsd,priceNative:m.priceNative,fdv:m.fdv,
    execution:{liquidityUsd:m.liquidityUsd,pairAddress:m.pairAddress,dexId:m.dexId,quoteTokenAddress:m.quoteTokenAddress,marketSource:m.marketSource}
  }:{};
  const intel=await intelligence.inspect(token,m||{},{force});
  return{...marketState,...intel,tokenName:identity.name,tokenSymbol:identity.symbol,contractExists:identity.contractExists,observedAt:new Date().toISOString(),execution:{...(marketState.execution||{}),...(intel.execution||{})}};
}

async function enrichTokens(tokens){
  const tokenStates={};
  for(const token of [...new Set(tokens||[])]){
    tokenStates[token]=await buildTokenState(token,true);
  }
  for(const [address,state] of Object.entries(tokenStates))mergeTokenState(address,state);
  save();await storage.flush();
}
function queueTokenEnrichment(tokens){
  if(!tokens?.length)return;
  liveQueue=liveQueue.then(()=>enrichTokens(tokens)).catch(e=>{db.sync={...(db.sync||{}),lastError:e.message};save();console.error(`[market] ${e.message}`);});
}

async function runAlchemyHistoricalBackfill(){
  const previous=db.sync?.alchemyBackfill||{};
  if(previous.completedAt)return{...previous,skipped:true};
  const startedAt=previous.startedAt||new Date().toISOString();
  db.sync={...(db.sync||{}),alchemyBackfill:{...previous,status:'running',startedAt,lastAttemptAt:new Date().toISOString(),error:null}};
  save();await storage.flush();
  try{
    const existingKeys=new Set(db.events.map(e=>e.key).filter(Boolean));
    const result=await scanner.scanAlchemyBackfill({actors:db.actors,existingKeys,fromBlock:previous.fromBlock,toBlock:previous.toBlock});
    const fresh=await storeEvents(result.events||[]);
    const completedAt=new Date().toISOString();
    const summary={
      status:result.truncatedQueries?'partial':'complete',startedAt,completedAt,error:null,
      fromBlock:result.fromBlock,toBlock:result.toBlock,transactions:result.transactions||0,
      transferRecords:result.transferRecords||0,pages:result.pages||0,truncatedQueries:result.truncatedQueries||0,
      eventsParsed:(result.events||[]).length,newEvents:fresh.length,trackedWallets:result.trackedWallets||0,
      discoveryScope:result.discoveryScope,
      completeness:result.truncatedQueries?'page-limit-reached':'wallet-outbound-activity-complete-in-window',
      nativeInternalCoverage:'unavailable-conservative'
    };
    db.sync={...(db.sync||{}),alchemyBackfill:summary};
    save();await storage.flush();
    return summary;
  }catch(error){
    db.sync={...(db.sync||{}),alchemyBackfill:{...previous,status:'error',startedAt,lastAttemptAt:new Date().toISOString(),error:error.message}};
    save();await storage.flush();
    throw error;
  }
}

async function ingestLiveTx(txHash){
  const rows=await scanner.analyzeTx(txHash,moneyWalletMap());
  const tokenStates={};
  for(const token of [...new Set(rows.map(e=>e.tokenAddress))]){
    tokenStates[token]=await buildTokenState(token,true);
  }
  const fresh=await storeEvents(rows,tokenStates);
  db.sync={...(db.sync||{}),lastChainSync:new Date().toISOString(),lastLiveTx:txHash,lastError:null,lastLiveEvents:fresh.length};
  save();await storage.flush();
  console.log(`[live] ${txHash} -> ${fresh.length} radar event(s)`);
  return fresh;
}
function queueLiveTx(txHash){liveQueue=liveQueue.then(()=>ingestLiveTx(txHash)).catch(e=>{db.sync={...(db.sync||{}),lastError:e.message,lastLiveTx:txHash};save();console.error(`[live] ${txHash} ${e.message}`);});return liveQueue;}

async function ingestAlchemyWebhook(payload){
  const wallets=moneyWalletMap();
  const rows=AlchemyWebhook.parseAddressActivity(payload,wallets,{isQuoteToken:a=>scanner.isQuoteToken(a)});
  const fresh=await storeEvents(rows);
  const txHashes=[...new Set(rows.map(e=>e.txHash).filter(Boolean))];
  const now=new Date().toISOString();
  db.sync={
    ...(db.sync||{}),lastChainSync:now,lastLiveTx:txHashes[0]||db.sync?.lastLiveTx||null,
    lastError:null,lastLiveEvents:fresh.length,provider:'alchemy-webhook',lastWebhookAt:now,
    lastWebhookEventId:payload?.id||null,lastWebhookActivity:Array.isArray(payload?.event?.activity)?payload.event.activity.length:0,
    lastScan:{...(db.sync?.lastScan||{}),trackedWallets:wallets.size,discovery:'alchemy-webhook',providerReady:true,newEvents:fresh.length}
  };
  save();await storage.flush();
  queueTokenEnrichment(rows.map(e=>e.tokenAddress));
  console.log(`[alchemy] ${payload?.id||'event'} -> ${fresh.length}/${rows.length} new radar event(s)`);
  return{rows,fresh};
}

async function runLiveSync(){
  if(syncRunning)return{ok:true,skipped:true,reason:'sync_already_running'};
  syncRunning=true;
  try{
    if(alchemyWebhookConfigured()&&!scanner.hasPro()){
      const now=new Date().toISOString();
      const backfill=await runAlchemyHistoricalBackfill();
      const nowMs=Date.now(),staleBefore=nowMs-5*60*1000;
      const entries=[...new Set(db.events.filter(e=>Performance.ENTRY_ACTIONS.has(e.action)&&new Date(e.at).getTime()>nowMs-7*24*3600e3).map(e=>e.tokenAddress))];
      const observations=[...new Set(db.events.filter(e=>new Date(e.at).getTime()>nowMs-24*3600e3).map(e=>e.tokenAddress))];
      const due=[...new Set([...entries,...observations])]
        .filter(token=>{const at=Date.parse(db.tokenState[token]?.observedAt||'');return!Number.isFinite(at)||at<staleBefore}).slice(0,8);
      let enrichedTokens=0;
      for(const token of due){mergeTokenState(token,await buildTokenState(token,true));enrichedTokens++;}
      const lastScan={fromBlock:db.sync?.lastScannedBlock??null,toBlock:db.sync?.lastScannedBlock??null,transactions:0,transferRecords:0,pages:0,newEvents:0,enrichedTokens,backfillStatus:backfill?.status||null,backfillNewEvents:backfill?.skipped?0:(backfill?.newEvents||0),trackedWallets:moneyWalletMap().size,discovery:'alchemy-webhook',providerReady:true,creditsRemaining:null,rateRemaining:null};
      db.sync={...(db.sync||{}),lastChainSync:now,lastError:null,chainId:4663,provider:'alchemy-webhook',lastScan};
      save();await storage.flush();
      return{ok:true,...lastScan,lastChainSync:now};
    }
    const existingKeys=new Set(db.events.map(e=>e.key).filter(Boolean));
    const result=await scanner.scan({actors:db.actors,sync:db.sync||{},existingKeys});
    result.tokenStates=result.tokenStates||{};
    for(const token of [...new Set((result.events||[]).map(e=>e.tokenAddress))])result.tokenStates[token]=await buildTokenState(token,true);
    const fresh=await storeEvents(result.events||[],result.tokenStates||{});
    db.sync={...(db.sync||{}),lastChainSync:new Date().toISOString(),lastScannedBlock:result.toBlock??db.sync?.lastScannedBlock??null,lastError:null,chainId:4663,provider:result.discovery,lastScan:{fromBlock:result.fromBlock,toBlock:result.toBlock,transactions:result.transactions||0,transferRecords:result.transferRecords||0,pages:result.pages||0,newEvents:fresh.length,trackedWallets:result.trackedWallets||0,discovery:result.discovery,providerReady:result.providerReady!==false,creditsRemaining:result.creditsRemaining??null,rateRemaining:result.rateRemaining??null}};
    save();await storage.flush();
    return{ok:true,...db.sync.lastScan,lastChainSync:db.sync.lastChainSync};
  }catch(e){
    db.sync={...(db.sync||{}),lastChainSync:new Date().toISOString(),lastError:e.message,lastScan:{failed:true},provider:alchemyWebhookConfigured()?'alchemy-webhook':scanner.hasPro()?'blockscout-pro-error':'awaiting-provider-credentials'};
    save();await storage.flush();throw e;
  }finally{syncRunning=false;}
}

function startLiveSubscriber(){
  if(!/^wss:\/\//i.test(RH_WSS_URL)){
    db.sync={...(db.sync||{}),ws:{state:'disabled',at:new Date().toISOString(),reason:alchemyWebhookConfigured()?'alchemy_webhook_primary':'no_production_wss_configured'}};save();console.log(`[wss] disabled; using ${alchemyWebhookConfigured()?'Alchemy webhook':'indexed polling'}`);return;
  }
  liveSubscriber=new LiveSubscriber({wsUrl:RH_WSS_URL,getWallets:()=>[...moneyWalletMap().keys()],onTx:queueLiveTx,onStatus:s=>{db.sync={...(db.sync||{}),ws:s};save();console.log(`[wss] ${s.state}${s.error?' '+s.error:''}`);}});
  liveSubscriber.start();
}

const server=http.createServer(async(req,res)=>{const u=new URL(req.url,`http://${req.headers.host||'localhost'}`),p=u.pathname;try{
if(p==='/api/health')return json(res,200,{ok:true,version:9,storage:DATABASE_URL?'postgres':'file',chainId:4663,provider:currentProvider(),webhook:alchemyWebhookConfigured()?'configured':'disabled',backfill:db?.sync?.alchemyBackfill?.status||'pending',calibration:calibration().status,ws:db?.sync?.ws?.state||'disabled',time:new Date().toISOString()});
if(p==='/api/dashboard'&&req.method==='GET')return json(res,200,dashboard());
if(p==='/api/calibration'&&req.method==='GET')return json(res,200,calibration());
if(p==='/api/webhooks/alchemy'&&req.method==='POST'){
  if(!alchemyWebhookConfigured())return json(res,503,{error:'alchemy webhook not configured'});
  const raw=await rawBody(req),signature=String(req.headers['x-alchemy-signature']||'');
  if(!AlchemyWebhook.isValidSignature(raw,signature,ALCHEMY_WEBHOOK_SIGNING_KEY))return json(res,403,{error:'invalid alchemy signature'});
  let b;try{b=raw?JSON.parse(raw):{}}catch{return json(res,400,{error:'invalid json'})}
  if(b.webhookId!==ALCHEMY_WEBHOOK_ID)return json(res,403,{error:'unexpected webhook id'});
  if(b.type!=='ADDRESS_ACTIVITY')return json(res,200,{ok:true,ignored:true,type:b.type||null});
  const result=await ingestAlchemyWebhook(b);
  return json(res,200,{ok:true,received:result.rows.length,newEvents:result.fresh.length});
}
if(p==='/api/internal/sync'&&req.method==='POST'){if(!auth(req,INTERNAL_SYNC_TOKEN))return json(res,401,{error:'unauthorized'});return json(res,200,await runLiveSync());}
if(p==='/api/events'&&req.method==='POST'){if(!auth(req,WRITE_API_TOKEN))return json(res,401,{error:'unauthorized'});const b=await body(req);if(!b.actorId||!b.action||!/^0x[a-fA-F0-9]{40}$/.test(b.tokenAddress||''))return json(res,400,{error:'actorId, action and exact tokenAddress required'});if(!db.actors.some(a=>a.id===b.actorId))return json(res,404,{error:'actor not found'});const e={key:b.key||`${Date.now()}:${b.actorId}:${b.tokenAddress}`,actorId:b.actorId,action:String(b.action).toUpperCase(),tokenAddress:b.tokenAddress.toLowerCase(),symbol:b.symbol||null,marketCap:b.marketCap??null,blockNumber:b.blockNumber??null,blockHash:b.blockHash??null,at:b.at||new Date().toISOString(),signalRole:b.signalRole||null,source:b.source||'external'};db.events.unshift(e);save();return json(res,201,{ok:true})}
if(p==='/api/token-state'&&req.method==='POST'){if(!auth(req,WRITE_API_TOKEN))return json(res,401,{error:'unauthorized'});const b=await body(req);if(!/^0x[a-fA-F0-9]{40}$/.test(b.tokenAddress||''))return json(res,400,{error:'exact tokenAddress required'});mergeTokenState(b.tokenAddress.toLowerCase(),b.state||{});save();return json(res,200,{ok:true})}
if(p==='/api/actors/performance'&&req.method==='POST'){if(!auth(req,WRITE_API_TOKEN))return json(res,401,{error:'unauthorized'});const b=await body(req),a=db.actors.find(x=>x.id===b.actorId);if(!a)return json(res,404,{error:'actor not found'});for(const k of ['sampleSize','recentEdge','lifetimeEdge','copyability'])if(b[k]!=null)a[k]=Number(b[k]);if(b.roleScores)a.roleScores={...(a.roleScores||{}),...b.roleScores};save();return json(res,200,{ok:true})}
if(staticFile(res,p))return;return json(res,404,{error:'not found'});
}catch(e){if(db?.sync){db.sync.lastError=e.message;save();}return json(res,500,{error:e.message})}});

(async()=>{db=await storage.init(initial(),x=>{const fresh={...initial(),...x,version:9};fresh.sync={...initial().sync,...(x?.sync||{})};fresh.tokenState=x?.tokenState||{};fresh.marketHistory=x?.marketHistory||{};fresh.events=x?.events||[];fresh.actors=mergeSeedActors(x?.actors||[]);return fresh});save();server.listen(PORT,()=>{console.log(`Trenches Radar listening on ${PORT} (${DATABASE_URL?'postgres':'file'})`);startLiveSubscriber();})})().catch(e=>{console.error(e);process.exit(1)});
process.on('SIGTERM',async()=>{try{liveSubscriber?.stop();}catch{}await storage.close();process.exit(0)});

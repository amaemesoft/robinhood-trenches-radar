'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const {URL}=require('url');
const Engine=require('./lib/engine');
const Storage=require('./lib/storage');
const ChainScanner=require('./lib/chainScanner');

const PORT=Number(process.env.PORT||8787);
const DATABASE_URL=process.env.DATABASE_URL||'';
const INTERNAL_SYNC_TOKEN=process.env.INTERNAL_SYNC_TOKEN||'';
const WRITE_API_TOKEN=process.env.WRITE_API_TOKEN||'';
const RH_RPC_URL=process.env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const BACKFILL_BLOCKS=Number(process.env.BACKFILL_BLOCKS||1200);
const MAX_BLOCK_RANGE=Number(process.env.MAX_BLOCK_RANGE||500);
const ROOT=__dirname, PUBLIC=path.join(ROOT,'public'), DB_FILE=path.join(ROOT,'data','db.json');
const storage=new Storage({filePath:DB_FILE,databaseUrl:DATABASE_URL});
const scanner=new ChainScanner({rpcUrl:RH_RPC_URL,backfillBlocks:BACKFILL_BLOCKS,maxBlockRange:MAX_BLOCK_RANGE});
let db;
let syncRunning=false;

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
{id:'damskotrades',handle:'damskotrades',xHandle:'@damskotrades',kind:'social',role:'confirmation',identityConfidence:'unresolved',copyability:83,roleScores:{discovery:61,confirmation:84,narrative:78}}
].map(a=>({...a,enabled:true,sampleSize:a.calls||0,lastEventAt:null}));

function initial(){const now=new Date().toISOString();return{version:3,createdAt:now,updatedAt:now,actors:seedActors,events:[],tokenState:{},alerts:[],sync:{lastChainSync:null,lastScannedBlock:null,lastError:null,lastScan:null}}}
const save=()=>storage.save(db);
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body))};
const auth=(req,token)=>!!token&&req.headers.authorization===`Bearer ${token}`;
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)reject(new Error('body too large'))});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function staticFile(res,p){let rel=p==='/'?'index.html':p.replace(/^\//,'');rel=path.normalize(rel).replace(/^\.\.(\/|\\|$)/,'');const f=path.join(PUBLIC,rel);if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return false;const ext=path.extname(f);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public,max-age=300'});fs.createReadStream(f).pipe(res);return true}
function actorMap(){const out={};for(const a of db.actors){a.adaptiveScore=Engine.adaptiveActorScore(a);a.division=Engine.division(a.sampleSize||a.calls||0,a.kind);out[a.id]=a}return out}
function signals(){const actors=actorMap(),groups=new Map(),cut=Date.now()-24*3600e3;for(const e of db.events){if(new Date(e.at).getTime()<cut)continue;(groups.get(e.tokenAddress)||groups.set(e.tokenAddress,[]).get(e.tokenAddress)).push(e)}const out=[];for(const[address,events]of groups){const st=db.tokenState[address]||{};const latest=[...events].sort((a,b)=>new Date(b.at)-new Date(a.at))[0];const result=Engine.evaluateToken({events,actors,safety:st.safety||{},execution:{...(st.execution||{}),currentMarketCap:st.marketCap||latest.marketCap||null},token:{marketCap:st.marketCap||latest.marketCap||null}});out.push({tokenAddress:address,symbol:latest.symbol||address.slice(0,8),lastSeen:latest.at,events,...result,liquidityUsd:st.execution?.liquidityUsd||null,priceUsd:st.priceUsd||null})}return out.sort((a,b)=>b.score-a.score)}
function dashboard(){const actors=Object.values(actorMap());const ss=signals();return{generatedAt:new Date().toISOString(),summary:{actors:actors.length,money:actors.filter(a=>a.kind==='money').length,social:actors.filter(a=>a.kind==='social').length,resolved:actors.filter(a=>a.evmAddress).length,entryCandidates:ss.filter(s=>['ENTRY_CANDIDATE','HIGH_CONFLUENCE'].includes(s.state)).length,distribution:ss.filter(s=>s.state==='DISTRIBUTION').length},signals:ss,recentEvents:db.events.slice(0,100),actors:actors.sort((a,b)=>b.adaptiveScore-a.adaptiveScore),sync:db.sync}}

function mergeTokenState(address,state){
  const old=db.tokenState[address]||{};
  db.tokenState[address]={...old,...state,execution:{...(old.execution||{}),...(state.execution||{})},safety:{...(old.safety||{}),...(state.safety||{})}};
}

async function runLiveSync(){
  if(syncRunning)return{ok:true,skipped:true,reason:'sync_already_running'};
  syncRunning=true;
  try{
    const existingKeys=new Set(db.events.map(e=>e.key).filter(Boolean));
    const result=await scanner.scan({actors:db.actors,sync:db.sync||{},existingKeys});
    for(const [address,state] of Object.entries(result.tokenStates||{}))mergeTokenState(address,state);
    for(const e of result.events||[]){
      const st=result.tokenStates?.[e.tokenAddress];
      if(st?.marketCap)e.marketCap=st.marketCap;
      if(st?.execution?.liquidityUsd)e.liquidityUsd=st.execution.liquidityUsd;
      const a=db.actors.find(x=>x.id===e.actorId);
      if(a&&(!a.lastEventAt||new Date(e.at)>new Date(a.lastEventAt)))a.lastEventAt=e.at;
    }
    if(result.events?.length)db.events=[...result.events,...db.events].slice(0,5000);
    db.sync={...(db.sync||{}),lastChainSync:new Date().toISOString(),lastScannedBlock:result.toBlock??db.sync?.lastScannedBlock??null,lastError:null,chainId:result.chainId||4663,lastScan:{fromBlock:result.fromBlock,toBlock:result.toBlock,transactions:result.transactions||0,newEvents:result.events?.length||0,trackedWallets:result.trackedWallets||0}};
    save();await storage.flush();
    return{ok:true,...db.sync.lastScan,lastChainSync:db.sync.lastChainSync};
  }catch(e){
    db.sync={...(db.sync||{}),lastChainSync:new Date().toISOString(),lastError:e.message,lastScan:{failed:true}};
    save();await storage.flush();
    throw e;
  }finally{syncRunning=false;}
}

const server=http.createServer(async(req,res)=>{const u=new URL(req.url,`http://${req.headers.host||'localhost'}`),p=u.pathname;try{
if(p==='/api/health')return json(res,200,{ok:true,version:3,storage:DATABASE_URL?'postgres':'file',chainId:4663,scanner:'robinhood-rpc',time:new Date().toISOString()});
if(p==='/api/dashboard'&&req.method==='GET')return json(res,200,dashboard());
if(p==='/api/internal/sync'&&req.method==='POST'){if(!auth(req,INTERNAL_SYNC_TOKEN))return json(res,401,{error:'unauthorized'});return json(res,200,await runLiveSync());}
if(p==='/api/events'&&req.method==='POST'){if(!auth(req,WRITE_API_TOKEN))return json(res,401,{error:'unauthorized'});const b=await body(req);if(!b.actorId||!b.action||!/^0x[a-fA-F0-9]{40}$/.test(b.tokenAddress||''))return json(res,400,{error:'actorId, action and exact tokenAddress required'});if(!db.actors.some(a=>a.id===b.actorId))return json(res,404,{error:'actor not found'});const e={key:b.key||`${Date.now()}:${b.actorId}:${b.tokenAddress}`,actorId:b.actorId,action:String(b.action).toUpperCase(),tokenAddress:b.tokenAddress.toLowerCase(),symbol:b.symbol||null,marketCap:b.marketCap??null,blockNumber:b.blockNumber??null,blockHash:b.blockHash??null,at:b.at||new Date().toISOString(),signalRole:b.signalRole||null,source:b.source||'external'};db.events.unshift(e);save();return json(res,201,{ok:true})}
if(p==='/api/token-state'&&req.method==='POST'){if(!auth(req,WRITE_API_TOKEN))return json(res,401,{error:'unauthorized'});const b=await body(req);if(!/^0x[a-fA-F0-9]{40}$/.test(b.tokenAddress||''))return json(res,400,{error:'exact tokenAddress required'});mergeTokenState(b.tokenAddress.toLowerCase(),b.state||{});save();return json(res,200,{ok:true})}
if(p==='/api/actors/performance'&&req.method==='POST'){if(!auth(req,WRITE_API_TOKEN))return json(res,401,{error:'unauthorized'});const b=await body(req),a=db.actors.find(x=>x.id===b.actorId);if(!a)return json(res,404,{error:'actor not found'});for(const k of ['sampleSize','recentEdge','lifetimeEdge','copyability'])if(b[k]!=null)a[k]=Number(b[k]);if(b.roleScores)a.roleScores={...(a.roleScores||{}),...b.roleScores};save();return json(res,200,{ok:true})}
if(staticFile(res,p))return;return json(res,404,{error:'not found'});
}catch(e){if(db?.sync){db.sync.lastError=e.message;save();}return json(res,500,{error:e.message})}});

(async()=>{db=await storage.init(initial(),x=>{const fresh={...initial(),...x,version:3};fresh.sync={...initial().sync,...(x?.sync||{})};fresh.tokenState=x?.tokenState||{};fresh.events=x?.events||[];fresh.actors=x?.actors?.length?x.actors:seedActors;return fresh});save();server.listen(PORT,()=>console.log(`Trenches Radar listening on ${PORT} (${DATABASE_URL?'postgres':'file'})`))})().catch(e=>{console.error(e);process.exit(1)});
process.on('SIGTERM',async()=>{await storage.close();process.exit(0)});

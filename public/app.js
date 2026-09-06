'use strict';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
}[char]));
const money=value=>value==null?'—':Number(value)>=1e6
  ?'$'+(Number(value)/1e6).toFixed(2)+'M'
  :Number(value)>=1e3?'$'+(Number(value)/1e3).toFixed(1)+'K':'$'+Number(value).toFixed(0);
const ago=value=>{
  if(!value)return'no sync yet';
  const minutes=Math.floor((Date.now()-new Date(value))/60000);
  return minutes<1?'ahora':minutes<60?minutes+'m':Math.floor(minutes/60)+'h';
};
const label=value=>({
  ENTRY_CANDIDATE:'ENTRY CANDIDATE',HIGH_CONFLUENCE:'HIGH CONFLUENCE',DO_NOT_CHASE:'DO NOT CHASE',
  DISTRIBUTION:'DISTRIBUTION',BLOCKED:'BLOCKED',WATCH:'WATCH',
  INSUFFICIENT_VERIFIED_ENTRIES:'MUESTRA INSUFICIENTE',BUILDING_FORWARD_RETURNS:'CONSTRUYENDO RETORNOS',
  CALIBRATION_ACTIVE:'CALIBRACIÓN ACTIVA',NO_VERIFIED_ENTRIES:'SIN ENTRADAS VERIFICADAS',
  BUILDING_RETURNS:'CONSTRUYENDO MUESTRA',TESTED_READY:'TESTED',CORE_READY:'CORE'
}[value]||value);

function providerText(data){
  const provider=data.sync?.provider||data.sync?.lastScan?.discovery;
  const wallets=data.sync?.lastScan?.trackedWallets||data.summary.money;
  const backfill=data.sync?.alchemyBackfill;
  const history=backfill?.status==='complete'
    ?` · histórico ${backfill.transactions||0} tx`
    :backfill?.status?` · histórico ${backfill.status}`:'';
  if(data.sync?.lastError)return'Feed con error · '+data.sync.lastError;
  if(provider==='alchemy-webhook')return`ALCHEMY LIVE · ${wallets} wallets · último webhook ${ago(data.sync.lastWebhookAt)}${history}`;
  if(provider==='blockscout-pro'){
    const newEvents=data.sync?.lastScan?.newEvents||0;
    return`BLOCKSCOUT LIVE · ${wallets} wallets · ${newEvents} eventos nuevos · sync ${ago(data.sync.lastChainSync)}`;
  }
  if(provider==='awaiting-blockscout-key'||provider==='awaiting-provider-credentials')return'Motor online · feed on-chain pendiente de provider';
  return'Motor online · preparando feed';
}

function renderSignals(signals){
  $('#signals').innerHTML=signals.length?signals.map(signal=>`
    <article class="card ${esc(signal.state.toLowerCase())}">
      <div class="row"><b>${esc(signal.symbol||'TOKEN')}</b><span class="tag">${esc(label(signal.state))}</span></div>
      <div class="scores">
        <div><b>${signal.alpha}</b><span>Alpha</span></div>
        <div><b>${esc(signal.safety.status)}</b><span>Safety</span></div>
        <div><b>${esc(signal.exitabilityGate?.status||'UNKNOWN')}</b><span>Exit ${signal.exitability}</span></div>
      </div>
      <p>${signal.independentActors} actores independientes · MC ${money(signal.currentMarketCap)} · Liq ${money(signal.liquidityUsd)}${signal.sellImpactPct!=null?` · impacto $${signal.exitabilityTargetUsd}: ${Number(signal.sellImpactPct).toFixed(1)}%`:''}</p>
      <small>${esc(signal.tokenAddress)} · ${esc(signal.reason)}</small>
    </article>`).join(''):
    '<div class="empty">No hay señales verificadas todavía. El radar no inventa trades ni convierte UNKNOWN en PASS.</div>';
}

function renderCalibration(calibration){
  if(!calibration){$('#calibration').innerHTML='<div class="empty">Calibración todavía no disponible.</div>';return;}
  const dataset=calibration.dataset||{};
  const overview=`
    <article class="calibration ${calibration.status==='CALIBRATION_ACTIVE'?'ready':''}">
      <div class="row"><b>Estado del modelo</b><strong>${esc(label(calibration.status))}</strong></div>
      <p>${dataset.verifiedEntries||0} entradas económicas verificadas · ${dataset.verifiedExits||0} salidas · ${dataset.completedH1||0} retornos H1 completos</p>
    </article>`;
  const wallets=(calibration.actors||[]).map(actor=>{
    const h1=actor.medianReturns?.h1;
    return`<article class="calibration ${['TESTED_READY','CORE_READY'].includes(actor.status)?'ready':''}">
      <div class="row"><b>${esc(actor.handle)}</b><strong>${esc(label(actor.status))}</strong></div>
      <p>${actor.observedEvents} eventos observados · ${actor.verifiedEntries} entradas · ${actor.completedH1} resultados H1${h1!=null?` · mediana ${Number(h1).toFixed(1)}%`:''}</p>
    </article>`;
  }).join('');
  $('#calibration').innerHTML=overview+wallets;
}

function renderActors(data){
  const calibrationByActor=new Map((data.calibration?.actors||[]).map(actor=>[actor.actorId,actor]));
  $('#actors').innerHTML=data.actors.slice(0,20).map(actor=>{
    const measured=calibrationByActor.get(actor.id);
    const sample=measured?` · ${measured.verifiedEntries} entradas verificadas`:'';
    return`<article class="actor"><div><b>${esc(actor.xHandle||actor.handle)}</b><span>${esc(actor.kind)} · ${esc(actor.role)} · ${esc(actor.division)}${sample}</span></div><strong>${actor.adaptiveScore}</strong></article>`;
  }).join('');
}

async function load(){
  try{
    const response=await fetch('/api/dashboard',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    const live=!!data.sync?.lastScan?.providerReady&&!data.sync?.lastError;
    $('#status').textContent=live?'LIVE':'ENGINE';
    $('#money').textContent=data.summary.money;
    $('#resolved').textContent=data.summary.resolved;
    $('#entries').textContent=data.summary.entryCandidates;
    $('#dist').textContent=data.summary.distribution;
    $('#fresh').textContent=providerText(data);
    $('#headline').textContent=data.summary.entryCandidates
      ?`Hay ${data.summary.entryCandidates} candidata(s) para revisar.`
      :live?'Sin Entry Candidates confirmadas ahora.':'Radar listo; no emitirá señales hasta tener datos verificables.';
    renderSignals(data.signals||[]);
    renderCalibration(data.calibration);
    renderActors(data);
  }catch(error){
    $('#status').textContent='ERROR';
    $('#fresh').textContent='Error: '+error.message;
  }
}

load();
setInterval(load,30000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

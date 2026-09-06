'use strict';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
}[char]));
const money=value=>value==null?'—':Number(value)>=1e6
  ?'$'+(Number(value)/1e6).toFixed(2)+'M'
  :Number(value)>=1e3?'$'+(Number(value)/1e3).toFixed(1)+'K':'$'+Number(value).toFixed(0);
const ago=value=>{
  if(!value)return'sin sincronizar';
  const minutes=Math.max(0,Math.floor((Date.now()-new Date(value))/60000));
  if(minutes<1)return'ahora';
  if(minutes<60)return`hace ${minutes} min`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return`hace ${hours} h`;
  return`hace ${Math.floor(hours/24)} d`;
};
const stateLabel=value=>({
  ENTRY_CANDIDATE:'REVISAR ENTRADA',HIGH_CONFLUENCE:'ALTA CONFLUENCIA',DO_NOT_CHASE:'NO PERSEGUIR',
  DISTRIBUTION:'DISTRIBUCIÓN',BLOCKED:'BLOQUEADO',WATCH:'VIGILAR',IGNORE:'SOLO OBSERVADO'
}[value]||value);
const calibrationLabel=value=>({
  INSUFFICIENT_VERIFIED_ENTRIES:'SIN COMPRAS VERIFICADAS',BUILDING_FORWARD_RETURNS:'CONSTRUYENDO RETORNOS',
  CALIBRATION_ACTIVE:'CALIBRACIÓN ACTIVA',NO_VERIFIED_ENTRIES:'SIN ENTRADAS VERIFICADAS',
  BUILDING_RETURNS:'CONSTRUYENDO MUESTRA',TESTED_READY:'TESTED',CORE_READY:'CORE'
}[value]||value);
const gateLabel=value=>({PASS:'OK',CAUTION:'CAUTELA',FAIL:'BLOQUEADO',UNKNOWN:'SIN CONFIRMAR'}[value]||value||'SIN CONFIRMAR');
const roleLabel=value=>({discovery:'descubrimiento',confirmation:'confirmación',execution:'ejecución',reentry:'reentrada',narrative:'narrativa'}[value]||value||'—');
const reasonText=value=>({
  no_entry_evidence:'Movimiento observado, pero no hay una entrada económica verificada.',
  social_scout_only:'Descubierto por una fuente social. Lo vigilamos, pero esperamos confirmación económica on-chain.',
  critical_unknown:'Faltan datos críticos de Safety; todavía no puede convertirse en entrada.',
  needs_second_independent_actor:'Hay una entrada económica válida, pero falta una segunda entrada independiente.',
  exitability_unknown:'No hay una cotización de salida fiable todavía.',
  entry_window_missed:'La confluencia existe, pero el precio ya se alejó demasiado de la primera entrada.',
  high_confluence:'Confluencia fuerte con Safety y salida verificadas.',
  alpha_safety_execution_align:'Alpha, Safety y capacidad de salida están alineados.',
  developing:'La señal está desarrollándose, pero aún no cumple el umbral de entrada.',
  independent_sellers:'Varios actores independientes están reduciendo o saliendo.'
}[value]||String(value||'').replaceAll('_',' '));

function providerText(data){
  const provider=data.sync?.provider||data.sync?.lastScan?.discovery;
  const wallets=data.sync?.lastScan?.trackedWallets||data.summary.money;
  const backfill=data.sync?.alchemyBackfill;
  const social=data.sync?.social;
  const history=backfill?.status==='complete'
    ?` · histórico completo (${backfill.transactions||0} tx)`
    :backfill?.status?` · histórico ${backfill.status}`:'';
  const socialText=social?.status==='live'?` · Social live (${social.scouts||0} scouts)`:
    social?.status==='awaiting-key'?' · Social preparado':'';
  if(data.sync?.lastError)return'Feed con error · '+data.sync.lastError;
  if(provider==='alchemy-webhook')return`Alchemy live · ${wallets} wallets · último webhook ${ago(data.sync.lastWebhookAt)}${history}${socialText}`;
  if(provider==='blockscout-pro'){
    const newEvents=data.sync?.lastScan?.newEvents||0;
    return`Blockscout live · ${wallets} wallets · ${newEvents} eventos nuevos · sync ${ago(data.sync.lastChainSync)}${socialText}`;
  }
  if(provider==='awaiting-blockscout-key'||provider==='awaiting-provider-credentials')return'Motor online · feed on-chain pendiente de provider';
  return'Motor online · preparando feed';
}

function signalCard(signal){
  const hasEntryEvidence=(signal.events||[]).some(event=>['CALL','BUY','ADD','REENTRY'].includes(event.action));
  const hasScouts=Number(signal.scoutActors||0)>0;
  const alpha=hasEntryEvidence?`${Number(signal.alpha||0)}/100`:'—';
  const alphaNote=hasEntryEvidence?'confluencia económica':hasScouts?'social no suma Alpha':'sin entrada válida';
  const impact=signal.sellImpactPct!=null?`${Number(signal.sellImpactPct).toFixed(1)}%`:'—';
  const confluenceLabel=!hasEntryEvidence&&hasScouts?'Scouts':'Confluencia';
  const confluenceValue=!hasEntryEvidence&&hasScouts?Number(signal.scoutActors||0):Number(signal.independentActors||0);
  const confluenceNote=!hasEntryEvidence&&hasScouts?'fuentes sociales':'entradas independientes';
  return`<article class="signal-card state-${esc(String(signal.state||'').toLowerCase())}">
    <div class="signal-top">
      <div><b class="token">${esc(signal.symbol||'TOKEN')}</b><span>${esc(ago(signal.lastSeen))}</span></div>
      <span class="state-tag">${esc(stateLabel(signal.state))}</span>
    </div>
    <p class="verdict">${esc(reasonText(signal.reason))}</p>
    <div class="signal-grid">
      <div><span>Alpha</span><b>${esc(alpha)}</b><small>${esc(alphaNote)}</small></div>
      <div><span>${esc(confluenceLabel)}</span><b>${confluenceValue}</b><small>${esc(confluenceNote)}</small></div>
      <div><span>Safety</span><b>${esc(gateLabel(signal.safety?.status))}</b><small>${esc(signal.safety?.reason||'contrato')}</small></div>
      <div><span>Salida</span><b>${esc(gateLabel(signal.exitabilityGate?.status))}</b><small>${signal.exitabilityTargetUsd?`$${esc(signal.exitabilityTargetUsd)} · impacto ${esc(impact)}`:'quote pendiente'}</small></div>
    </div>
    <div class="market-row"><span>MC <b>${money(signal.currentMarketCap)}</b></span><span>Liquidez <b>${money(signal.liquidityUsd)}</b></span></div>
    <details class="technical"><summary>Ver datos técnicos</summary>
      <p>Contrato <code>${esc(signal.tokenAddress)}</code></p>
      <p>Score ${esc(signal.score)} · Alpha bruto ${esc(signal.alpha)} · Scouts ${esc(signal.scoutActors||0)} · Timing ${esc(signal.timing)} · Exitability ${esc(signal.exitability)}</p>
      <p>Motivo interno: ${esc(signal.reason)}</p>
    </details>
  </article>`;
}

function observationCard(signal){
  const actions=[...new Set((signal.events||[]).map(event=>event.action).filter(Boolean))];
  return`<article class="observation">
    <div><b>${esc(signal.symbol||'TOKEN')}</b><span>${esc(actions.join(' · ')||'movimiento observado')} · ${esc(ago(signal.lastSeen))}</span></div>
    <strong>NO SIGNAL</strong>
    <details class="technical"><summary>Detalles</summary><p><code>${esc(signal.tokenAddress)}</code></p><p>${esc(reasonText(signal.reason))}</p></details>
  </article>`;
}

function renderSignals(signals){
  const actionable=signals.filter(signal=>signal.state!=='IGNORE');
  const ignored=signals.filter(signal=>signal.state==='IGNORE');
  $('#signalCount').textContent=actionable.length;
  $('#signals').innerHTML=actionable.length?actionable.map(signalCard).join(''):
    '<div class="empty good-empty"><b>Sin señales que merezcan atención ahora</b><span>El radar sigue observando money wallets y scouts sociales sin forzar entradas.</span></div>';
  $('#observationsPanel').hidden=!ignored.length;
  $('#ignoredCount').textContent=ignored.length;
  $('#observations').innerHTML=ignored.map(observationCard).join('');
}

function renderCalibration(calibration){
  if(!calibration){$('#calibration').innerHTML='<div class="empty">Calibración todavía no disponible.</div>';return;}
  const dataset=calibration.dataset||{};
  const active=calibration.status==='CALIBRATION_ACTIVE';
  const message=dataset.verifiedEntries
    ?`${dataset.verifiedEntries} compras verificadas · ${dataset.verifiedExits||0} salidas verificadas · ${dataset.completedH1||0} retornos H1 completos.`
    :`${dataset.events||0} eventos observados · ${dataset.verifiedExits||0} salidas verificadas · todavía 0 compras económicas verificadas. ACQUIRE, TRANSFER_OUT y SCOUT no se usan como performance.`;
  const actorRows=(calibration.actors||[]).map(actor=>{
    const h1=actor.medianReturns?.h1;
    return`<div class="cal-row">
      <div><b>${esc(actor.handle)}</b><span>${actor.observedEvents} eventos · ${actor.verifiedEntries} compras · ${actor.verifiedExits} salidas · ${actor.completedH1} H1 completos${h1!=null?` · mediana H1 ${Number(h1).toFixed(1)}%`:''}</span></div>
      <strong>${esc(calibrationLabel(actor.status))}</strong>
    </div>`;
  }).join('');
  $('#calibration').innerHTML=`
    <article class="learning ${active?'ready':''}">
      <span class="eyebrow">${active?'MEDICIÓN ACTIVA':'MUESTRA EN CONSTRUCCIÓN'}</span>
      <h3>${esc(calibrationLabel(calibration.status))}</h3>
      <p>${esc(message)}</p>
    </article>
    <details class="fold inner"><summary><span>Ver calibración por wallet</span><strong>${(calibration.actors||[]).length}</strong></summary><div class="cal-list">${actorRows}</div></details>`;
}

function actorCard(actor,measured){
  const handle=actor.xHandle||actor.handle;
  const observed=measured?.observedEvents||0;
  const verified=measured?.verifiedEntries||0;
  return`<article class="actor">
    <div class="actor-main">
      <b>${esc(handle)}</b>
      <span>Money wallet · ${esc(roleLabel(actor.role))} · ${esc(actor.division)}</span>
      <small>${observed} eventos observados · ${verified} compras verificadas</small>
    </div>
    <div class="actor-score"><b>${esc(actor.adaptiveScore)}</b><span>score provisional</span></div>
  </article>`;
}

function socialActorCard(actor){
  const feed=actor.fomoUserId?'feed verificado':'candidato';
  return`<article class="actor muted-actor">
    <div class="actor-main"><b>${esc(actor.xHandle||actor.handle)}</b><span>Social · ${esc(roleLabel(actor.role))} · ${esc(actor.division)} · ${esc(feed)}</span></div>
    <div class="actor-score"><b>${esc(actor.adaptiveScore)}</b><span>prior</span></div>
  </article>`;
}

function renderActors(data){
  const calibrationByActor=new Map((data.calibration?.actors||[]).map(actor=>[actor.actorId,actor]));
  const moneyActors=data.actors.filter(actor=>actor.kind==='money');
  const socialActors=data.actors.filter(actor=>actor.kind==='social');
  $('#actors').innerHTML=moneyActors.map(actor=>actorCard(actor,calibrationByActor.get(actor.id))).join('');
  $('#socialPanel').hidden=!socialActors.length;
  $('#socialCount').textContent=socialActors.length;
  $('#socialActors').innerHTML=socialActors.map(socialActorCard).join('');
}

async function load(){
  try{
    const response=await fetch('/api/dashboard',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    const live=!!data.sync?.lastScan?.providerReady&&!data.sync?.lastError;
    const dataset=data.calibration?.dataset||{};
    $('#status').textContent=live?'LIVE':'MOTOR';
    document.body.classList.toggle('is-live',live);
    $('#money').textContent=data.summary.money;
    $('#verified').textContent=dataset.verifiedEntries||0;
    $('#entries').textContent=data.summary.entryCandidates;
    $('#dist').textContent=data.summary.distribution;
    $('#fresh').textContent=providerText(data);
    $('#systemMeta').textContent=`${data.summary.resolved}/${data.summary.actors} identidades con wallet resuelta · ${data.summary.social||0} scouts sociales · ${dataset.events||0} eventos observados`;
    $('#headline').textContent=data.summary.entryCandidates
      ?`${data.summary.entryCandidates} oportunidad${data.summary.entryCandidates===1?'':'es'} de entrada para revisar`
      :data.summary.distribution
        ?`${data.summary.distribution} alerta${data.summary.distribution===1?'':'s'} de distribución activa${data.summary.distribution===1?'':'s'}`
        :live?'Sin entradas confirmadas; radar ampliado vigilando':'Radar operativo; esperando datos verificables';
    $('#generated').textContent=`Actualizado ${ago(data.generatedAt)}`;
    renderSignals(data.signals||[]);
    renderCalibration(data.calibration);
    renderActors(data);
  }catch(error){
    $('#status').textContent='ERROR';
    $('#fresh').textContent='Error al cargar el radar: '+error.message;
    $('#headline').textContent='No se pudo leer el estado actual';
  }
}

load();
setInterval(load,30000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

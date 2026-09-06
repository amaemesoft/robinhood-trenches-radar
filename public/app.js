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
const leadTime=value=>{
  if(value==null)return null;
  const minutes=Number(value);
  if(!Number.isFinite(minutes))return null;
  if(minutes<60)return`${Math.round(minutes)} min`;
  return`${(minutes/60).toFixed(1)} h`;
};
const stateLabel=value=>({
  ENTRY_CANDIDATE:'REVISAR ENTRADA',HIGH_CONFLUENCE:'ALTA CONFLUENCIA',DO_NOT_CHASE:'NO PERSEGUIR',
  DISTRIBUTION:'ALERTA DE SALIDA',BLOCKED:'NO ENTRAR',WATCH:'VIGILAR',IGNORE:'SOLO OBSERVADO'
}[value]||value);
const statePriority=value=>({DISTRIBUTION:7,HIGH_CONFLUENCE:6,ENTRY_CANDIDATE:5,DO_NOT_CHASE:4,BLOCKED:3,WATCH:2,IGNORE:1}[value]||0);
const calibrationLabel=value=>({
  INSUFFICIENT_VERIFIED_ENTRIES:'SIN COMPRAS VERIFICADAS',BUILDING_FORWARD_RETURNS:'CONSTRUYENDO RETORNOS',
  CALIBRATION_ACTIVE:'CALIBRACIÓN ACTIVA',NO_VERIFIED_ENTRIES:'SIN ENTRADAS VERIFICADAS',
  BUILDING_RETURNS:'CONSTRUYENDO MUESTRA',BUILDING_SAMPLE:'MUESTRA SOCIAL',NO_SCOUTS:'SIN MUESTRA',
  TESTED_READY:'TESTED',CORE_READY:'CORE'
}[value]||value);
const gateLabel=value=>({PASS:'OK',CAUTION:'CAUTELA',FAIL:'BLOQUEADO',UNKNOWN:'SIN CONFIRMAR'}[value]||value||'SIN CONFIRMAR');
const roleLabel=value=>({discovery:'descubrimiento',confirmation:'confirmación',execution:'ejecución',reentry:'reentrada',narrative:'narrativa'}[value]||value||'—');
const reasonText=value=>({
  no_entry_evidence:'Movimiento observado, pero no hay una entrada económica verificada.',
  social_scout_only:'Descubierto por scouts sociales. Merece vigilancia, pero todavía no existe confirmación económica on-chain.',
  critical_unknown:'Faltan datos críticos de Safety; todavía no puede convertirse en entrada.',
  needs_second_independent_actor:'Hay una entrada económica válida, pero falta una segunda money wallet independiente.',
  exitability_unknown:'No hay una cotización de salida fiable todavía.',
  entry_window_missed:'La confluencia existe, pero el precio ya se alejó demasiado de la primera entrada.',
  high_confluence:'Confluencia fuerte con Safety y salida verificadas.',
  alpha_safety_execution_align:'Alpha económico, Safety y capacidad de salida están alineados.',
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
  const socialText=social?.status==='live'?` · social live (${social.scouts||0} scouts)`:
    social?.status==='awaiting-key'?' · social preparado':'';
  if(data.sync?.lastError)return'Feed con error · '+data.sync.lastError;
  if(provider==='alchemy-webhook')return`Alchemy live · ${wallets} wallets · último webhook ${ago(data.sync.lastWebhookAt)}${history}${socialText}`;
  if(provider==='blockscout-pro'){
    const newEvents=data.sync?.lastScan?.newEvents||0;
    return`Blockscout live · ${wallets} wallets · ${newEvents} eventos nuevos · sync ${ago(data.sync.lastChainSync)}${socialText}`;
  }
  if(provider==='awaiting-blockscout-key'||provider==='awaiting-provider-credentials')return'Motor online · feed on-chain pendiente de provider';
  return'Motor online · preparando feed';
}

function decisionCopy(signal){
  if(signal.state==='DISTRIBUTION')return{title:'Revisar salida',step:'Prioridad alta: comprobar exposición y si las ventas independientes continúan.'};
  if(signal.state==='HIGH_CONFLUENCE')return{title:'Revisar entrada ahora',step:'Confluencia fuerte. Revisar tamaño y precio actual antes de ejecutar cualquier entrada.'};
  if(signal.state==='ENTRY_CANDIDATE')return{title:'Posible entrada',step:'Cumple los gates principales. Revisar el precio actual y no entrar si la ventana se deteriora.'};
  if(signal.state==='DO_NOT_CHASE')return{title:'No entrar ahora',step:'La idea puede ser válida, pero la ventana de precio ya se perdió. Esperar reentrada o nueva base.'};
  if(signal.state==='BLOCKED')return{title:'No entrar',step:'Hay un bloqueo de Safety o salida. No convertir esta señal en operación mientras siga activo.'};
  if(signal.reason==='social_scout_only')return{title:'Vigilar de cerca',step:'Falta una compra on-chain verificable. Los scouts sirven para llegar antes, no para confirmar la entrada.'};
  if(signal.reason==='needs_second_independent_actor')return{title:'Esperar segunda confirmación',step:'Ya existe una compra válida. Falta una segunda money wallet independiente.'};
  if(signal.reason==='critical_unknown')return{title:'Esperar Safety',step:'La señal económica existe, pero faltan comprobaciones críticas del token o pool.'};
  if(signal.reason==='exitability_unknown')return{title:'Esperar salida verificable',step:'Antes de considerar entrada necesitamos saber que el tamaño objetivo se puede vender con impacto aceptable.'};
  return{title:'Seguir vigilando',step:'Todavía falta evidencia para elevarla a candidata de entrada.'};
}

function actorDisplay(id,actorsById){
  const actor=actorsById.get(id);
  return actor?.xHandle||actor?.handle||id;
}

function evidenceChip(label,value,tone=''){
  return`<span class="evidence-chip ${esc(tone)}"><small>${esc(label)}</small><b>${esc(value)}</b></span>`;
}

function signalCard(signal,actorsById){
  const hasEntryEvidence=(signal.events||[]).some(event=>['CALL','BUY','ADD','REENTRY'].includes(event.action));
  const alpha=hasEntryEvidence?`${Number(signal.alpha||0)}/100`:'—';
  const decision=decisionCopy(signal);
  const impact=signal.sellImpactPct!=null?`${Number(signal.sellImpactPct).toFixed(1)}%`:'—';
  const moneyActors=Number(signal.independentActors||0);
  const scouts=Number(signal.scoutActors||0);
  const timing=signal.chaseMultiple!=null?`${Number(signal.chaseMultiple).toFixed(2)}×`:'sin referencia';
  const actorNames=(signal.actorIds||[]).map(id=>actorDisplay(id,actorsById));
  const scoutNames=(signal.scoutActorIds||[]).map(id=>actorDisplay(id,actorsById));
  const sourceBits=[];
  if(actorNames.length)sourceBits.push(`Money: ${actorNames.join(', ')}`);
  if(scoutNames.length)sourceBits.push(`Social: ${scoutNames.join(', ')}`);
  return`<article class="signal-card state-${esc(String(signal.state||'').toLowerCase())}">
    <div class="signal-top">
      <div><b class="token">${esc(signal.symbol||'TOKEN')}</b><span>${esc(ago(signal.lastSeen))}</span></div>
      <span class="state-tag">${esc(stateLabel(signal.state))}</span>
    </div>
    <h3 class="decision-title">${esc(decision.title)}</h3>
    <p class="verdict">${esc(reasonText(signal.reason))}</p>
    <div class="evidence-row">
      ${evidenceChip('Money',moneyActors?`${moneyActors} independiente${moneyActors===1?'':'s'}`:'sin confirmar',moneyActors>=2?'positive':'')}
      ${evidenceChip('Social',scouts?`${scouts} scout${scouts===1?'':'s'}`:'sin scout',scouts?'info':'')}
      ${evidenceChip('Safety',gateLabel(signal.safety?.status),signal.safety?.status==='PASS'?'positive':signal.safety?.status==='FAIL'?'negative':'')}
      ${evidenceChip('Salida',gateLabel(signal.exitabilityGate?.status),signal.exitabilityGate?.status==='PASS'?'positive':signal.exitabilityGate?.status==='FAIL'?'negative':'')}
    </div>
    <p class="next-step"><b>Siguiente paso:</b> ${esc(decision.step)}</p>
    ${sourceBits.length?`<p class="source-line">${esc(sourceBits.join(' · '))}</p>`:''}
    <div class="market-row">
      <span>MC <b>${money(signal.currentMarketCap)}</b></span>
      <span>Liquidez <b>${money(signal.liquidityUsd)}</b></span>
      <span>Desde 1ª entrada <b>${esc(timing)}</b></span>
    </div>
    <details class="technical"><summary>Ver datos técnicos</summary>
      <p>Contrato <code>${esc(signal.tokenAddress)}</code></p>
      <p>Alpha económico ${esc(alpha)} · Descubrimiento social ${esc(signal.discovery??0)}/100 · Score de entrada ${esc(signal.score)} · Prioridad ${esc(signal.priorityScore??signal.score)}.</p>
      <p>Timing ${esc(signal.timing)} · Exitability ${esc(signal.exitability)} · impacto de venta ${esc(impact)}.</p>
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

function renderSignals(signals,actors){
  const actorsById=new Map((actors||[]).map(actor=>[actor.id,actor]));
  const actionable=signals.filter(signal=>signal.state!=='IGNORE').sort((a,b)=>{
    const stateDiff=statePriority(b.state)-statePriority(a.state);
    if(stateDiff)return stateDiff;
    return Number(b.priorityScore??b.score??0)-Number(a.priorityScore??a.score??0);
  });
  const ignored=signals.filter(signal=>signal.state==='IGNORE');
  $('#signalCount').textContent=actionable.length;
  $('#signals').innerHTML=actionable.length?actionable.map(signal=>signalCard(signal,actorsById)).join(''):
    '<div class="empty good-empty"><b>Sin acción ahora</b><span>El radar sigue observando money wallets y scouts sociales. No fuerza entradas cuando faltan confirmaciones.</span></div>';
  $('#observationsPanel').hidden=!ignored.length;
  $('#ignoredCount').textContent=ignored.length;
  $('#observations').innerHTML=ignored.map(observationCard).join('');
}

function renderCalibration(calibration){
  if(!calibration){$('#calibration').innerHTML='<div class="empty">Calibración todavía no disponible.</div>';return;}
  const dataset=calibration.dataset||{};
  const active=calibration.status==='CALIBRATION_ACTIVE';
  const socialText=dataset.socialScouts?` · ${dataset.socialScouts} descubrimientos sociales · ${dataset.socialConfirmed||0} confirmados por money`:'';
  const message=dataset.verifiedEntries
    ?`${dataset.verifiedEntries} compras verificadas · ${dataset.verifiedExits||0} salidas verificadas · ${dataset.completedH1||0} retornos H1 completos${socialText}.`
    :`${dataset.events||0} eventos observados · ${dataset.verifiedExits||0} salidas verificadas · todavía 0 compras económicas verificadas${socialText}. ACQUIRE, TRANSFER_OUT y SCOUT no se usan como performance de entrada.`;
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
    <div class="actor-score"><b>${esc(actor.adaptiveScore)}</b><span>prior provisional</span></div>
  </article>`;
}

function socialActorCard(actor,measured){
  const scouts=Number(measured?.scouts||0);
  const confirmed=Number(measured?.confirmed||0);
  const pending=Number(measured?.pending||0);
  const rate=measured?.confirmationRate;
  const lead=leadTime(measured?.medianLeadMinutes);
  const evidence=scouts
    ?`${scouts} descubierto${scouts===1?'':'s'} · ${confirmed} confirmado${confirmed===1?'':'s'} por money${pending?` · ${pending} pendiente${pending===1?'':'s'}`:''}${lead?` · ventaja mediana ${lead}`:''}`
    :'sin descubrimientos con CA exacta todavía';
  const measuredStatus=calibrationLabel(measured?.status||'NO_SCOUTS');
  return`<article class="actor muted-actor">
    <div class="actor-main">
      <b>${esc(actor.xHandle||actor.handle)}</b>
      <span>Social · ${esc(roleLabel(actor.role))} · ${esc(measuredStatus)} · feed público live</span>
      <small>${esc(evidence)}</small>
    </div>
    <div class="actor-score"><b>${rate!=null?`${Number(rate).toFixed(0)}%`:'—'}</b><span>${rate!=null?'confirmados':'muestra real'}</span></div>
  </article>`;
}

function renderActors(data){
  const calibrationByActor=new Map((data.calibration?.actors||[]).map(actor=>[actor.actorId,actor]));
  const socialByActor=new Map((data.calibration?.socialActors||[]).map(actor=>[actor.actorId,actor]));
  const moneyActors=data.actors.filter(actor=>actor.kind==='money');
  const socialActors=data.actors.filter(actor=>actor.kind==='social').sort((a,b)=>{
    const am=socialByActor.get(a.id),bm=socialByActor.get(b.id);
    const ar=am?.confirmationRate??-1,br=bm?.confirmationRate??-1;
    if(br!==ar)return br-ar;
    return Number(bm?.scouts||0)-Number(am?.scouts||0);
  });
  $('#moneyCount').textContent=moneyActors.length;
  $('#actors').innerHTML=moneyActors.map(actor=>actorCard(actor,calibrationByActor.get(actor.id))).join('');
  $('#socialPanel').hidden=!socialActors.length;
  $('#socialCount').textContent=socialActors.length;
  $('#socialActors').innerHTML=socialActors.map(actor=>socialActorCard(actor,socialByActor.get(actor.id))).join('');
}

function heroCopy(data){
  const signals=data.signals||[];
  const entries=signals.filter(signal=>['ENTRY_CANDIDATE','HIGH_CONFLUENCE'].includes(signal.state)).length;
  const distribution=signals.filter(signal=>signal.state==='DISTRIBUTION').length;
  const watching=signals.filter(signal=>signal.state==='WATCH').length;
  if(distribution)return{
    headline:`${distribution} alerta${distribution===1?'':'s'} de salida activa${distribution===1?'':'s'}`,
    note:'Las señales de distribución tienen prioridad sobre buscar nuevas entradas.'
  };
  if(entries)return{
    headline:`${entries} oportunidad${entries===1?'':'es'} de entrada para revisar`,
    note:'Hay confluencia suficiente para revisar una entrada. El radar no ejecuta ni recomienda perseguir precio.'
  };
  if(watching)return{
    headline:`Nada para entrar aún · ${watching} en vigilancia`,
    note:'Hay pistas tempranas, pero todavía falta una confirmación clave. Esto es exactamente lo que evita falsas entradas.'
  };
  return{
    headline:'Sin acción ahora',
    note:'El radar está activo y no ve una configuración que merezca convertir en entrada o salida.'
  };
}

async function load(){
  try{
    const response=await fetch('/api/dashboard',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    const live=!!data.sync?.lastScan?.providerReady&&!data.sync?.lastError;
    const dataset=data.calibration?.dataset||{};
    const watching=(data.signals||[]).filter(signal=>signal.state==='WATCH').length;
    const hero=heroCopy(data);
    $('#status').textContent=live?'LIVE':'MOTOR';
    document.body.classList.toggle('is-live',live);
    $('#money').textContent=data.summary.money;
    $('#verified').textContent=dataset.verifiedEntries||0;
    $('#entries').textContent=data.summary.entryCandidates;
    $('#watching').textContent=watching;
    $('#dist').textContent=data.summary.distribution;
    $('#fresh').textContent=providerText(data);
    $('#systemMeta').textContent=`${data.summary.resolved}/${data.summary.actors} identidades con wallet resuelta · ${data.summary.social||0} scouts sociales monitorizados · ${dataset.events||0} eventos observados`;
    $('#headline').textContent=hero.headline;
    $('#decisionNote').textContent=hero.note;
    $('#generated').textContent=`Actualizado ${ago(data.generatedAt)}`;
    renderSignals(data.signals||[],data.actors||[]);
    renderCalibration(data.calibration);
    renderActors(data);
  }catch(error){
    $('#status').textContent='ERROR';
    $('#fresh').textContent='Error al cargar el radar: '+error.message;
    $('#headline').textContent='No se pudo leer el estado actual';
    $('#decisionNote').textContent='El motor no ha podido devolver una lectura fiable.';
  }
}

load();
setInterval(load,30000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

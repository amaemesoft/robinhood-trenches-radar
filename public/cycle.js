'use strict';

(()=>{
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[char]));
  const stageLabel=value=>({DISCOVERED:'Descubierto',EMERGING:'Emergente',BREAKOUT:'Breakout',CULTURAL_CONTENDER:'Candidato cultural',CHAIN_ICON:'Icono de la chain',CYCLE_MEME:'Meme del ciclo'}[value]||value||'Descubierto');
  const stageIcon=value=>({DISCOVERED:'🌱',EMERGING:'👀',BREAKOUT:'🔥',CULTURAL_CONTENDER:'🎭',CHAIN_ICON:'👑',CYCLE_MEME:'🌍'}[value]||'🌱');
  const entryLabel=value=>({ENTRY_CANDIDATE:'REVISAR ENTRADA',HIGH_CONFLUENCE:'ALTA CONFLUENCIA',DO_NOT_CHASE:'NO PERSEGUIR',DISTRIBUTION:'SALIDA / DISTRIBUCIÓN',BLOCKED:'NO ENTRAR',WATCH:'VIGILAR',IGNORE:'SIN SEÑAL DE ENTRADA',NO_RECENT_SIGNAL:'SIN SEÑAL TÁCTICA RECIENTE'}[value]||value||'SIN SEÑAL TÁCTICA RECIENTE');
  const directionLabel=value=>({RISING_FAST:'SUBIENDO RÁPIDO',RISING:'SUBIENDO',STABLE:'ESTABLE',COOLING:'ENFRIANDO',FALLING_FAST:'CAYENDO RÁPIDO',BUILDING_HISTORY:'CREANDO HISTÓRICO'}[value]||value||'CREANDO HISTÓRICO');
  const lifecycleLabel=value=>({ACTIVE:'activo',WARM:'seguimiento',COOLING:'enfriando',DORMANT:'dormido',RESEARCH:'investigación'}[value]||value||'investigación');
  const reasonLabel=value=>String(value||'')
    .replace(/ established money wallets currently hold/,' money wallets establecidas mantienen saldo')
    .replace('1 established money wallet currently holds','1 money wallet establecida mantiene saldo')
    .replace(/ independent established money actors in cycle window/,' money wallets establecidas con actividad económica en la ventana')
    .replace(/ independent social scouts across cycle window/,' scouts sociales independientes en la ventana')
    .replace(/social propagation spans (\d+) source families/,'propagación social en $1 tipos de fuente')
    .replace('holder adoption/retention is strengthening','adopción y retención de holders mejorando')
    .replace('holders are expanding faster than price','holders creciendo más rápido que el precio')
    .replace('material drawdown was survived with recovery','sobrevivió un drawdown material y recuperó');
  const riskLabel=value=>String(value||'')
    .replace(/ provisional money wallets observed but not scored/,' money wallets provisionales observadas; no suman score')
    .replace('critical safety still unknown','Safety crítica todavía sin confirmar')
    .replace('critical safety failed','Safety crítica fallida')
    .replace('exitability still unknown','salida todavía sin confirmar')
    .replace('exitability failed','salida fallida')
    .replace('price is outrunning holder absorption','el precio corre más rápido que la adopción de holders')
    .replace('holder growth/distribution is weakening','holders/distribución debilitándose')
    .replace('material drawdown resilience has not been tested','todavía no ha demostrado supervivencia a un drawdown material')
    .replace('post-drawdown resilience is still being tested','resiliencia post-crash todavía en prueba')
    .replace('post-drawdown structure remains weak','estructura post-crash débil')
    .replace('Cycle score still has low evidence coverage','cobertura de evidencia todavía baja');
  const missingLabel=value=>({holder_growth:'crecimiento y retención de holders',long_horizon_resilience:'resiliencia tras drawdowns',holder_vs_price_absorption:'absorción de holders frente al precio',full_market_structure:'estructura completa de mercado',current_money_holdings:'holdings actuales de Money'}[value]||value);
  const gateReasonLabel=value=>String(value||'')
    .replaceAll('tokenControl','control del token')
    .replaceAll('upgradeAuthority','autoridad de actualización')
    .replaceAll('canonicalLp','pool canónico')
    .replaceAll('sellRestriction','restricciones de venta')
    .replaceAll('sell_quote_unavailable','cotización de venta no disponible')
    .replaceAll('invalid_sell_quote','cotización de venta inválida')
    .replaceAll('quote_failed','falló la cotización de venta')
    .replaceAll('sell_impact_gt_20pct','impacto de venta superior al 20%')
    .replaceAll('sell_impact_gt_10pct','impacto de venta superior al 10%');
  const toneForEntry=value=>value==='DISTRIBUTION'||value==='BLOCKED'?'negative':value==='HIGH_CONFLUENCE'||value==='ENTRY_CANDIDATE'?'positive':value==='DO_NOT_CHASE'?'warning':'neutral';
  const knownNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const fmt=value=>knownNumber(value)?Number(value).toLocaleString('es-ES',{maximumFractionDigits:1}):'—';
  const delta=value=>knownNumber(value)?`${Number(value)>=0?'+':''}${Number(value).toFixed(1)}`:'—';
  const pct=value=>knownNumber(value)?`${Math.round(Number(value)*100)}%`:'—';
  const percentValue=value=>knownNumber(value)?`${fmt(value)}%`:'No medido';
  const usd=value=>knownNumber(value)?Number(value).toLocaleString('es-ES',{style:'currency',currency:'USD',maximumFractionDigits:Number(value)<1?6:0}):'No medido';
  const dateLabel=value=>{
    const time=Date.parse(value||'');
    return Number.isFinite(time)?new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',timeStyle:'short'}).format(new Date(time)):'No medido';
  };
  const statusLabel=value=>({PASS:'PASS · confirmado',CAUTION:'PRECAUCIÓN',UNKNOWN:'UNKNOWN · no confirmado',FAIL:'FAIL · fallido'}[value]||value||'UNKNOWN · no confirmado');
  const componentMeta=[
    ['culture','Cultura',20,'Amplitud de scouts sociales independientes y diversidad de fuentes.'],
    ['holders','Holders + absorción',20,'Adopción y retención; si existe, incorpora si los holders crecen más rápido que el precio.'],
    ['money','Money',15,'Actividad o holdings de wallets establecidas; las provisionales no suman puntos.'],
    ['resilience','Resiliencia',15,'Supervivencia y recuperación después de drawdowns materiales.'],
    ['market','Mercado',10,'Liquidez, relación liquidez/market cap y capacidad estimada de salida.'],
    ['velocity','Atención',8,'Aceleración de eventos recientes frente a la ventana anterior.'],
    ['safety','Safety',7,'Estado de controles críticos; UNKNOWN conserva sólo un valor conservador y nunca abre gates.'],
    ['momentum','Momentum',5,'Posición del market cap frente a las primeras entradas observadas.']
  ];

  function analogueLine(analogues=[]){
    if(!analogues.length)return'';
    return`<div class="cycle-analogues"><small>PATRONES HISTÓRICOS</small>${analogues.map(a=>`<span><b>${esc(a.label)}</b> · ${esc(a.why)}${a.warning?` · ⚠ ${esc(a.warning)}`:''}</span>`).join('')}</div>`;
  }

  function list(items=[],empty='Sin evidencia adicional medida.'){
    return items.length?`<ul>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:`<p>${esc(empty)}</p>`;
  }

  function movement(signal){
    const windows=[['24 h',signal.cycleDelta24h],['6 h',signal.cycleDelta6h],['3 días',signal.cycleDelta3d]];
    const measured=windows.find(([,value])=>knownNumber(value));
    return measured?{window:measured[0],value:Number(measured[1])}:{window:null,value:null};
  }

  function topDrivers(signal){
    const components=signal.cycleComponents||{};
    return componentMeta
      .filter(([key])=>knownNumber(components[key]))
      .map(([key,label])=>({label,value:Number(components[key])}))
      .sort((a,b)=>b.value-a.value)
      .slice(0,2);
  }

  function executiveSummary(signal){
    const reasons=(signal.cycleReasons||[]).map(reasonLabel);
    const drivers=topDrivers(signal);
    const support=reasons[0]||drivers.length?`Sus apoyos más fuertes son ${drivers.map(row=>`${row.label.toLowerCase()} (${fmt(row.value)}/100)`).join(' y ')||reasons[0]}.`:'Todavía no existe una evidencia positiva dominante.';
    const caveat=(signal.cycleRisks||[]).map(riskLabel)[0];
    return `${support} ${caveat?`La principal limitación actual es ${caveat}.`:'El motor no ha detectado una limitación dominante nueva, pero eso no sustituye los gates de entrada.'}`;
  }

  function movementExplanation(signal){
    const move=movement(signal);
    if(!move.window)return'El motor todavía está construyendo histórico suficiente para atribuir el cambio a una ventana temporal concreta.';
    const threshold=signal.cycleDirection==='RISING_FAST'?'Supera el umbral de +8 puntos que activa SUBIENDO RÁPIDO.':signal.cycleDirection==='RISING'?'Supera el umbral de +3 puntos que activa SUBIENDO.':'La dirección se calcula con la mejor ventana histórica disponible.';
    return `Su Cycle Potential ha cambiado ${delta(move.value)} puntos en ${move.window}. ${threshold} Esta lista ordena el cambio del score, no el market cap ni el número bruto de menciones.`;
  }

  function tacticalExplanation(signal){
    const messages={
      ENTRY_CANDIDATE:'Existe una entrada para revisar, sujeta a la evidencia y al tamaño de salida mostrado aquí.',
      HIGH_CONFLUENCE:'La señal táctica tiene confluencia alta, pero sigue requiriendo validación humana.',
      DO_NOT_CHASE:'La tesis de ciclo puede ser fuerte, pero el precio o el timing hacen que perseguirla ahora sea mala idea.',
      DISTRIBUTION:'El radar detecta contexto de salida o distribución; el potencial cultural no lo anula.',
      BLOCKED:'Algún gate crítico bloquea la entrada aunque el token pueda seguir acumulando relevancia cultural.',
      WATCH:'Hay evidencia para vigilar, pero todavía no para tratarla como entrada.',
      IGNORE:'No existe una señal táctica accionable.',
      NO_RECENT_SIGNAL:'No existe señal táctica reciente; sólo se está evaluando la tesis de ciclo.'
    };
    return messages[signal.state]||'La lectura táctica no está disponible.';
  }

  function componentRows(signal){
    const components=signal.cycleComponents||{};
    return componentMeta.map(([key,label,weight,description])=>{
      const known=knownNumber(components[key]);
      return`<div class="cycle-component ${known?'':'is-unknown'}"><b>${esc(label)} · ${weight}%</b><strong>${known?`${esc(fmt(components[key]))}/100`:'UNKNOWN'}</strong><small>${esc(description)} ${known?'':'No suma puntos mientras no esté medido.'}</small></div>`;
    }).join('');
  }

  function evidenceStats(signal){
    const evidence=signal.cycleEvidence||{};
    const stats=[
      ['Money independientes',fmt(evidence.moneyActors),'Actores únicos; no wallets duplicadas.'],
      ['Money con eventos',fmt(evidence.moneyEventActors),'BUY / ADD / REENTRY / CALL en la ventana.'],
      ['Money que mantienen',fmt(evidence.currentQualifiedMoneyHolders),'Holdings actuales medidos de wallets establecidas.'],
      ['Scouts sociales',fmt(evidence.socialScouts),'Actores independientes, no menciones brutas.'],
      ['Familias de fuentes',fmt(evidence.socialSourceDiversity),'X, Telegram, on-chain u otras familias.'],
      ['Holders actuales',knownNumber(evidence.currentHolders)?fmt(evidence.currentHolders):'No medido','Último snapshot disponible.'],
      ['Crecimiento holders 24 h',percentValue(evidence.holderGrowth24h),'Cambio de adopción a corto plazo.'],
      ['Crecimiento holders 3 d',percentValue(evidence.holderGrowth3d),'Persistencia de adopción.'],
      ['Crecimiento holders 7 d',percentValue(evidence.holderGrowth7d),'Evidencia de horizonte largo.'],
      ['Concentración top 10',percentValue(evidence.top10Pct),'Menor concentración suele reducir fragilidad.'],
      ['Drawdown máximo',percentValue(evidence.maxDrawdownPct),'Caída material observada en el histórico.'],
      ['Recuperación del peak',percentValue(evidence.peakRecoveryPct),'Capacidad observada de recuperación.'],
      ['Market cap',usd(signal.marketCap),'Valor actual observado por el motor.'],
      ['Liquidez',usd(signal.liquidityUsd),'Liquidez disponible observada.'],
      ['Impacto de venta',percentValue(signal.sellImpactPct),knownNumber(signal.exitabilityTargetUsd)?`Para una salida objetivo de ${usd(signal.exitabilityTargetUsd)}.`:'Tamaño objetivo no medido.']
    ];
    return stats.map(([label,value,note])=>`<div class="cycle-detail-stat"><small>${esc(label.toUpperCase())}</small><b>${esc(value)}</b><em>${esc(note)}</em></div>`).join('');
  }

  function gateRows(signal){
    const gates=signal.cycleGates||{};
    const safety=signal.safety||{};
    const exit=signal.exitabilityGate||{};
    const rows=[
      ['Holders con confianza suficiente',gates.holderReady===true,gates.holderReady===false?'Pendiente':'Confirmado'],
      ['Resiliencia con confianza suficiente',gates.resilienceReady===true,gates.resilienceReady===false?'Pendiente':'Confirmado'],
      ['Datos maduros para stages superiores',gates.fullDataReady===true,gates.fullDataReady===false?'Pendiente':'Confirmado'],
      ['Safety crítica',safety.status==='PASS',statusLabel(safety.status)],
      ['Salida táctica',exit.status==='PASS',statusLabel(exit.status)],
      ['Gate de icono de la chain',gates.chainIconGate===true,gates.chainIconGate===false?'No superado':'Superado'],
      ['Gate de meme del ciclo',gates.cycleMemeGate===true,gates.cycleMemeGate===false?'No superado':'Superado']
    ];
    return rows.map(([label,pass,value])=>`<div class="cycle-gate ${pass?'pass':String(value).includes('FAIL')?'fail':'pending'}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
  }

  function detail(signal){
    const reasons=(signal.cycleReasons||[]).map(reasonLabel);
    const risks=(signal.cycleRisks||[]).map(riskLabel);
    const missing=(signal.cycleMissingData||[]).map(missingLabel);
    const evidence=signal.cycleEvidence||{};
    const safety=signal.safety||{};
    const exit=signal.exitabilityGate||{};
    const analogues=signal.cycleAnalogues||[];
    const provisional=Number(evidence.provisionalMoneyObserved||0);
    const riskItems=[...risks,...missing.map(item=>`${item}: todavía no medido; no aporta puntos ni se interpreta como aprobado.`)];
    if(!riskItems.length)riskItems.push('No hay una invalidación nueva registrada, pero una futura caída de score, Safety FAIL o salida inviable cambiarían la lectura.');
    return`<p id="cycleDetailIntro" class="cycle-cycle-lead">${esc(movementExplanation(signal))}</p>
      <div class="cycle-detail-badges"><span>${esc(stageIcon(signal.cycleStage))} ${esc(stageLabel(signal.cycleStage))}</span><span>${esc(directionLabel(signal.cycleDirection))}</span><span>Cycle ${esc(Math.round(Number(signal.cyclePotential||0)))}/100</span><span>Confianza ${esc(pct(signal.cycleConfidence))}</span></div>
      <section class="cycle-detail-section"><h4>LECTURA EJECUTIVA</h4><p>${esc(executiveSummary(signal))}</p><p class="cycle-cycle-warning"><b>Importante:</b> Cycle Potential no es una orden de compra. Mide potencial cultural/durabilidad; la entrada táctica se decide por separado.</p></section>
      <section class="cycle-detail-section"><h4>POR QUÉ ESTÁ SUBIENDO</h4><p>El histórico demuestra cuánto cambió el score. Como conserva el total y no una copia de todos los componentes en cada snapshot, no inventamos una atribución exacta del salto: debajo se muestran los factores que sostienen la lectura actual.</p>${list(reasons,'El aumento procede de la recomposición cuantitativa del score; todavía no hay un motivo cualitativo dominante generado por el motor.')}<div class="cycle-detail-grid"><div class="cycle-detail-stat"><small>CAMBIO 6 H</small><b>${esc(delta(signal.cycleDelta6h))}</b><em>Puntos de Cycle Potential.</em></div><div class="cycle-detail-stat"><small>CAMBIO 24 H</small><b>${esc(delta(signal.cycleDelta24h))}</b><em>Ventana principal si existe.</em></div><div class="cycle-detail-stat"><small>CAMBIO 3 DÍAS</small><b>${esc(delta(signal.cycleDelta3d))}</b><em>Tendencia más persistente.</em></div><div class="cycle-detail-stat"><small>ATENCIÓN RECIENTE</small><b>${esc(directionLabel(signal.attentionDirection))}</b><em>${esc(fmt(evidence.recentEvents6h))} eventos en 6 h vs ${esc(fmt(evidence.priorEvents18h))} en las 18 h previas.</em></div></div></section>
      <section class="cycle-detail-section"><h4>QUÉ MIDE EL SCORE</h4><p>El potencial bruto es ${esc(fmt(signal.cycleRawPotential))}/100. Tras penalizar cobertura (${esc(pct(signal.cycleCoverage))}) y confianza (${esc(pct(signal.cycleConfidence))}), queda en ${esc(Math.round(Number(signal.cyclePotential||0)))}/100. Los componentes no medidos no reciben crédito; Safety UNKNOWN conserva una penalización conservadora de 25/100 y no abre ningún gate.</p><div class="cycle-component-list">${componentRows(signal)}</div>${knownNumber(signal.cycleComponents?.organic)?`<p>Diagnóstico de absorción holders/precio: ${esc(fmt(signal.cycleComponents.organic))}/100; se integra dentro de la lectura de holders.</p>`:'<p>Absorción holders/precio: UNKNOWN; no se trata como positiva.</p>'}</section>
      <section class="cycle-detail-section"><h4>EVIDENCIA OBSERVADA</h4><div class="cycle-detail-grid">${evidenceStats(signal)}</div>${provisional?`<p>${esc(provisional)} wallet(s) Money provisionales observadas. Se muestran como contexto, pero no suman score.</p>`:''}</section>
      <section class="cycle-detail-section"><h4>GATES Y GRADO DE MADUREZ</h4><div class="cycle-gate-list">${gateRows(signal)}</div><p>Safety: ${esc(statusLabel(safety.status))}${safety.reason?` · ${esc(gateReasonLabel(safety.reason))}`:''}. Salida: ${esc(statusLabel(exit.status))}${exit.reason?` · ${esc(gateReasonLabel(exit.reason))}`:''}. UNKNOWN no se convierte en PASS.</p></section>
      <section class="cycle-detail-section"><h4>RIESGOS, FALTANTES E INVALIDACIÓN</h4>${list(riskItems)}<p>La tesis de “subiendo” se invalida si el delta cae por debajo de los umbrales, si se debilitan holders/absorción, si aparece distribución, si Safety pasa a FAIL o si la salida deja de ser viable.</p></section>
      <section class="cycle-detail-section"><h4>LECTURA DE ENTRADA</h4><div class="cycle-detail-badges"><span class="cycle-entry ${toneForEntry(signal.state)}">${esc(entryLabel(signal.state))}</span></div><p>${esc(tacticalExplanation(signal))}</p></section>
      ${analogues.length?`<section class="cycle-detail-section"><h4>PATRONES HISTÓRICOS COMPARABLES</h4>${list(analogues.map(item=>`${item.label}: ${item.why}${item.warning?` · Advertencia: ${item.warning}`:''}`))}<p>Son analogías de patrón, no predicciones de rentabilidad.</p></section>`:''}
      <section class="cycle-detail-section"><h4>TRAZABILIDAD</h4><div class="cycle-detail-grid"><div class="cycle-detail-stat"><small>PRIMERA EVIDENCIA</small><b>${esc(dateLabel(signal.cycleFirstSeenAt))}</b><em>Inicio del histórico disponible.</em></div><div class="cycle-detail-stat"><small>ÚLTIMA EVIDENCIA</small><b>${esc(dateLabel(signal.cycleLastEvidenceAt))}</b><em>Recencia de la lectura.</em></div><div class="cycle-detail-stat"><small>CICLO DE VIDA</small><b>${esc(lifecycleLabel(signal.cycleLifecycle))}</b><em>Persistencia del candidato.</em></div><div class="cycle-detail-stat"><small>MOTOR</small><b>Cycle V${esc(signal.cycleVersion||4)}</b><em>Contrato exacto, no ticker.</em></div></div><code class="cycle-detail-contract">${esc(signal.tokenAddress||'Contrato no disponible')}</code></section>`;
  }

  function card(signal,rankLabel){
    const reasons=(signal.cycleReasons||[]).map(reasonLabel);
    const risks=(signal.cycleRisks||[]).map(riskLabel);
    const evidence=signal.cycleEvidence||{};
    const missing=(signal.cycleMissingData||[]).map(v=>({holder_growth:'crecimiento/retención de holders',long_horizon_resilience:'resiliencia larga',holder_vs_price_absorption:'holders vs precio',full_market_structure:'estructura completa de mercado',current_money_holdings:'holdings actuales de Money'}[v]||v));
    const pinned=signal.cyclePinned?'<span class="cycle-pinned">SEGUIMIENTO FIJO</span>':'';
    return`<article class="cycle-card stage-${esc(String(signal.cycleStage||'DISCOVERED').toLowerCase())}">
      <div class="cycle-card-head">
        <div class="cycle-rank">${esc(rankLabel)}</div>
        <div class="cycle-token"><b>${esc(signal.symbol||'TOKEN')}</b><span>${esc(stageIcon(signal.cycleStage))} ${esc(stageLabel(signal.cycleStage))} · ${esc(lifecycleLabel(signal.cycleLifecycle))}</span>${pinned}</div>
        <div class="cycle-score"><b>${esc(Math.round(Number(signal.cyclePotential||0)))}</b><span>/100</span></div>
      </div>
      <div class="cycle-status-row">
        <span class="cycle-direction direction-${esc(String(signal.cycleDirection||'building_history').toLowerCase())}">${esc(directionLabel(signal.cycleDirection))}</span>
        <span class="cycle-entry ${toneForEntry(signal.state)}">Entrada: ${esc(entryLabel(signal.state))}</span>
      </div>
      <div class="cycle-summary">
        <span><small>CONSENSO</small><b>${esc(evidence.moneyActors??0)} money · ${esc(evidence.socialScouts??0)} social</b></span>
        <span><small>CONFIANZA</small><b>${esc(pct(signal.cycleConfidence))}</b></span>
        <span><small>CAMBIO 24H</small><b>${esc(delta(signal.cycleDelta24h))}</b></span>
      </div>
      <p class="cycle-primary-reason"><b>Por qué importa:</b> ${esc(reasons[0]||'Todavía está construyendo una tesis verificable.')}</p>
      ${risks[0]?`<p class="cycle-primary-risk"><b>Riesgo principal:</b> ${esc(risks[0])}</p>`:''}
      <details class="technical cycle-tech"><summary>Por qué, riesgos y datos</summary>
        <div class="cycle-thesis">
          <div><small>EVIDENCIA A FAVOR</small>${reasons.length?`<ul>${reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>Todavía no hay evidencia suficiente para una tesis fuerte.</p>'}</div>
          <div><small>RIESGOS / INVALIDACIÓN</small>${risks.length?`<ul>${risks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>Sin riesgos nuevos detectados por el motor.</p>'}</div>
        </div>
        ${analogueLine(signal.cycleAnalogues||[])}
        <p>Cycle Potential ${esc(Math.round(Number(signal.cyclePotential||0)))}/100 · potencial bruto ${esc(signal.cycleRawPotential??'—')} · cobertura ${esc(pct(signal.cycleCoverage))} · confianza ${esc(pct(signal.cycleConfidence))} · motor V${esc(signal.cycleVersion||4)}. Entry Score sigue siendo independiente.</p>
        <p>Cultura ${esc(signal.cycleComponents?.culture??0)} · Holders ${esc(signal.cycleComponents?.holders??'—')} · Money ${esc(signal.cycleComponents?.money??'—')} · Resiliencia ${esc(signal.cycleComponents?.resilience??'—')} · Mercado ${esc(signal.cycleComponents?.market??'—')} · Atención ${esc(signal.cycleComponents?.velocity??0)} · Absorción ${esc(signal.cycleComponents?.organic??'—')}.</p>
        <p>Holder 24h ${esc(evidence.holderGrowth24h??'—')}% · 3d ${esc(evidence.holderGrowth3d??'—')}% · 7d ${esc(evidence.holderGrowth7d??'—')}% · Drawdown máx. observado ${esc(evidence.maxDrawdownPct??'—')}% · recuperación del peak ${esc(evidence.peakRecoveryPct??'—')}%.</p>
        ${missing.length?`<p>Datos todavía insuficientes: ${esc(missing.join(' + '))}.</p>`:''}
        <p><code>${esc(signal.tokenAddress||'')}</code></p>
      </details>
    </article>`;
  }

  function risingRow(signal,index){
    const address=String(signal.tokenAddress||'').toLowerCase();
    const symbol=signal.symbol||'TOKEN';
    return`<button type="button" class="cycle-rising-row" data-cycle-address="${esc(address)}" aria-haspopup="dialog" aria-label="Abrir análisis completo de ${esc(symbol)}"><span>${index+1}</span><div><b>${esc(symbol)}</b><small>${esc(stageLabel(signal.cycleStage))}</small></div><strong>${esc(directionLabel(signal.cycleDirection))}</strong><em>24h ${esc(delta(signal.cycleDelta24h))}</em><i class="cycle-open-arrow" aria-hidden="true">›</i></button>`;
  }

  const cycleSignals=new Map();
  let lastTrigger=null;

  function openCycleDetail(address,trigger){
    const signal=cycleSignals.get(String(address||'').toLowerCase());
    const dialog=$('#cycleDetailDialog'),body=$('#cycleDetailBody'),title=$('#cycleDetailTitle');
    if(!signal||!dialog||!body||!title)return;
    lastTrigger=trigger||null;
    title.textContent=signal.symbol||'Detalle de moneda';
    body.innerHTML=detail(signal);
    if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();
    else dialog.setAttribute('open','');
    dialog.querySelector('[data-cycle-close]')?.focus();
  }

  function closeDetail(){
    const dialog=$('#cycleDetailDialog');
    if(!dialog)return;
    if(typeof dialog.close==='function'&&dialog.open)dialog.close();
    else dialog.removeAttribute('open');
  }

  function render(data){
    const signals=(data.cycleMemes||[]).filter(signal=>knownNumber(signal.cyclePotential)).sort((a,b)=>Number(b.cyclePotential||0)-Number(a.cyclePotential||0)||Number(b.cycleConfidence||0)-Number(a.cycleConfidence||0));
    cycleSignals.clear();
    signals.forEach(signal=>cycleSignals.set(String(signal.tokenAddress||'').toLowerCase(),signal));
    const ranked=signals.slice(0,10);
    const rankedAddresses=new Set(ranked.map(x=>x.tokenAddress));
    const pinnedOutside=signals.filter(x=>x.cyclePinned&&!rankedAddresses.has(x.tokenAddress));
    const visible=[...ranked,...pinnedOutside];
    const rising=[...signals]
      .filter(signal=>['RISING_FAST','RISING'].includes(signal.cycleDirection)&&Number(signal.cycleDelta24h??signal.cycleDelta6h)>0)
      .sort((a,b)=>Number(b.cycleDelta24h??b.cycleDelta6h??0)-Number(a.cycleDelta24h??a.cycleDelta6h??0))
      .slice(0,5);
    const count=$('#cycleCount'),grid=$('#cycleMemes'),risingBox=$('#cycleRising'),risingWrap=$('#cycleRisingWrap');
    if(count)count.textContent=signals.length;
    if(grid)grid.innerHTML=visible.length?visible.map(signal=>card(signal,rankedAddresses.has(signal.tokenAddress)?`#${signals.findIndex(x=>x.tokenAddress===signal.tokenAddress)+1}`:'★')).join(''):
      '<div class="empty cycle-empty"><b>Aún no hay candidatos calificables</b><span>El Cycle Radar conserva candidatos por contrato y acumula evidencia aunque no exista una entrada reciente.</span></div>';
    if(risingWrap)risingWrap.hidden=!rising.length;
    if(risingBox)risingBox.innerHTML=rising.map(risingRow).join('');
    const dialog=$('#cycleDetailDialog');
    if(dialog?.open){
      const active=cycleSignals.get(String(dialog.dataset.activeAddress||'').toLowerCase());
      if(active){
        $('#cycleDetailTitle').textContent=active.symbol||'Detalle de moneda';
        $('#cycleDetailBody').innerHTML=detail(active);
      }else closeDetail();
    }
  }

  async function loadCycle(){
    try{
      const response=await fetch('/api/cycle',{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    }catch(error){
      const grid=$('#cycleMemes');
      if(grid)grid.innerHTML=`<div class="empty"><b>Cycle Radar sin lectura fiable</b><span>${esc(error.message)}</span></div>`;
    }
  }

  let refreshTimer=null;
  function setActive(active){
    if(active&&!refreshTimer){loadCycle();refreshTimer=setInterval(loadCycle,30000);}
    if(!active&&refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
  }
  document.addEventListener('trenches:viewchange',event=>setActive(event.detail?.view==='discover'));
  const risingBox=$('#cycleRising');
  const dialog=$('#cycleDetailDialog');
  risingBox?.addEventListener('click',event=>{
    const button=event.target.closest('[data-cycle-address]');
    if(!button)return;
    if(dialog)dialog.dataset.activeAddress=button.dataset.cycleAddress||'';
    openCycleDetail(button.dataset.cycleAddress,button);
  });
  dialog?.addEventListener('click',event=>{
    if(event.target===dialog||event.target.closest('[data-cycle-close]'))closeDetail();
  });
  dialog?.addEventListener('close',()=>{
    delete dialog.dataset.activeAddress;
    lastTrigger?.focus();
    lastTrigger=null;
  });
  const discoverPanel=document.querySelector('[data-view-panel="discover"]');
  setActive(!discoverPanel||!discoverPanel.hidden);
})();

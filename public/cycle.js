'use strict';

(()=>{
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[char]));
  const stageLabel=value=>({
    DISCOVERED:'Descubierto',EMERGING:'Emergente',BREAKOUT:'Breakout',
    CULTURAL_CONTENDER:'Candidato cultural',CHAIN_ICON:'Icono de la chain',CYCLE_MEME:'Meme del ciclo'
  }[value]||value||'Descubierto');
  const stageIcon=value=>({
    DISCOVERED:'🌱',EMERGING:'👀',BREAKOUT:'🔥',CULTURAL_CONTENDER:'🎭',CHAIN_ICON:'👑',CYCLE_MEME:'🌍'
  }[value]||'🌱');
  const entryLabel=value=>({
    ENTRY_CANDIDATE:'REVISAR ENTRADA',HIGH_CONFLUENCE:'ALTA CONFLUENCIA',DO_NOT_CHASE:'NO PERSEGUIR',
    DISTRIBUTION:'SALIDA / DISTRIBUCIÓN',BLOCKED:'NO ENTRAR',WATCH:'VIGILAR',IGNORE:'SIN SEÑAL DE ENTRADA'
  }[value]||value||'SIN SEÑAL');
  const directionLabel=value=>({RISING_FAST:'SUBIENDO RÁPIDO',RISING:'SUBIENDO',STABLE:'ESTABLE',COOLING:'ENFRIANDO'}[value]||value||'—');
  const componentLabel=value=>({money:'Money',culture:'Cultura',velocity:'Velocidad',market:'Mercado',safety:'Safety',survival:'Resiliencia',momentum:'Momentum'}[value]||value);
  const reasonLabel=value=>String(value||'')
    .replace(/ independent money actors/,' money wallets independientes')
    .replace('first money actor confirmed','primera money wallet confirmada')
    .replace(/ independent social scouts/,' scouts sociales independientes')
    .replace('attention rising fast','atención acelerando fuerte')
    .replace('attention rising','atención acelerando')
    .replace('exitability verified','salida verificable')
    .replace('critical safety gates pass','Safety crítica verificada');
  const riskLabel=value=>({
    'independent distribution detected':'distribución independiente detectada',
    'critical safety still unknown':'Safety crítica todavía sin confirmar',
    'critical safety failed':'Safety crítica fallida',
    'exitability still unknown':'salida todavía sin confirmar',
    'exitability failed':'salida fallida',
    'money breadth not proven':'amplitud de Money todavía no probada',
    'cultural spread not proven':'propagación cultural todavía no probada'
  }[value]||value);
  const toneForEntry=value=>value==='DISTRIBUTION'||value==='BLOCKED'?'negative':
    value==='HIGH_CONFLUENCE'||value==='ENTRY_CANDIDATE'?'positive':
    value==='DO_NOT_CHASE'?'warning':'neutral';

  function componentChips(components={}){
    const keys=['money','culture','velocity','market','safety'];
    return keys.map(key=>{
      const value=Math.round(Number(components[key]||0));
      const tone=value>=75?'positive':value>=55?'info':value<35?'negative':'';
      return`<span class="cycle-chip ${tone}"><small>${esc(componentLabel(key))}</small><b>${esc(value)}</b></span>`;
    }).join('');
  }

  function card(signal,index){
    const reasons=(signal.cycleReasons||[]).map(reasonLabel);
    const risks=(signal.cycleRisks||[]).map(riskLabel);
    const evidence=signal.cycleEvidence||{};
    const missing=(signal.cycleMissingData||[]).map(v=>v==='holder_growth'?'crecimiento de holders':v==='long_horizon_resilience'?'resiliencia larga':v);
    return`<article class="cycle-card stage-${esc(String(signal.cycleStage||'DISCOVERED').toLowerCase())}">
      <div class="cycle-card-head">
        <div class="cycle-rank">#${index+1}</div>
        <div class="cycle-token"><b>${esc(signal.symbol||'TOKEN')}</b><span>${esc(stageIcon(signal.cycleStage))} ${esc(stageLabel(signal.cycleStage))}</span></div>
        <div class="cycle-score"><b>${esc(Math.round(Number(signal.cyclePotential||0)))}</b><span>/100</span></div>
      </div>
      <div class="cycle-status-row">
        <span class="cycle-direction direction-${esc(String(signal.cycleDirection||'stable').toLowerCase())}">${esc(directionLabel(signal.cycleDirection))}</span>
        <span class="cycle-entry ${toneForEntry(signal.state)}">Entrada: ${esc(entryLabel(signal.state))}</span>
      </div>
      <div class="cycle-components">${componentChips(signal.cycleComponents)}</div>
      <div class="cycle-thesis">
        <div><small>POR QUÉ SUBE</small>${reasons.length?`<ul>${reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>Todavía no hay evidencia suficiente para una tesis fuerte.</p>'}</div>
        <div><small>QUÉ PUEDE ROMPER LA TESIS</small>${risks.length?`<ul>${risks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>Sin riesgos nuevos detectados por el motor.</p>'}</div>
      </div>
      <div class="cycle-evidence-line">
        <span>Money <b>${esc(evidence.moneyActors||0)}</b></span>
        <span>Scouts <b>${esc(evidence.socialScouts||0)}</b></span>
        <span>Eventos 6h <b>${esc(evidence.recentEvents6h||0)}</b></span>
        <span>Velocidad <b>${esc(Math.round(Number(signal.cycleVelocity||0)))}</b></span>
      </div>
      <details class="technical cycle-tech"><summary>Ver score completo</summary>
        <p>Cycle Potential ${esc(Math.round(Number(signal.cyclePotential||0)))}/100 · versión ${esc(signal.cycleVersion||1)}.</p>
        <p>Money ${esc(signal.cycleComponents?.money??0)} · Cultura ${esc(signal.cycleComponents?.culture??0)} · Velocidad ${esc(signal.cycleComponents?.velocity??0)} · Mercado ${esc(signal.cycleComponents?.market??0)} · Safety ${esc(signal.cycleComponents?.safety??0)} · Resiliencia ${esc(signal.cycleComponents?.survival??0)} · Momentum ${esc(signal.cycleComponents?.momentum??0)}.</p>
        ${missing.length?`<p>Datos pendientes para categorías superiores: ${esc(missing.join(' + '))}.</p>`:''}
        <p><code>${esc(signal.tokenAddress||'')}</code></p>
      </details>
    </article>`;
  }

  function risingRow(signal,index){
    return`<div class="cycle-rising-row">
      <span>${index+1}</span>
      <div><b>${esc(signal.symbol||'TOKEN')}</b><small>${esc(stageLabel(signal.cycleStage))}</small></div>
      <strong>${esc(directionLabel(signal.cycleDirection))}</strong>
      <em>V${esc(Math.round(Number(signal.cycleVelocity||0)))}</em>
    </div>`;
  }

  function render(data){
    const signals=(data.signals||[])
      .filter(signal=>Number.isFinite(Number(signal.cyclePotential)))
      .sort((a,b)=>Number(b.cyclePotential||0)-Number(a.cyclePotential||0)||Number(b.cycleVelocity||0)-Number(a.cycleVelocity||0));
    const top=signals.slice(0,10);
    const rising=[...signals]
      .filter(signal=>['RISING_FAST','RISING'].includes(signal.cycleDirection))
      .sort((a,b)=>Number(b.cycleVelocity||0)-Number(a.cycleVelocity||0)||Number(b.cyclePotential||0)-Number(a.cyclePotential||0))
      .slice(0,5);
    const count=$('#cycleCount'),grid=$('#cycleMemes'),risingBox=$('#cycleRising'),risingWrap=$('#cycleRisingWrap');
    if(count)count.textContent=top.length;
    if(grid)grid.innerHTML=top.length?top.map(card).join(''):
      '<div class="empty cycle-empty"><b>Aún no hay candidatos calificables</b><span>El motor necesita contratos Robinhood válidos con evidencia social/on-chain para construir el ranking.</span></div>';
    if(risingWrap)risingWrap.hidden=!rising.length;
    if(risingBox)risingBox.innerHTML=rising.map(risingRow).join('');
  }

  async function loadCycle(){
    try{
      const response=await fetch('/api/dashboard',{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    }catch(error){
      const grid=$('#cycleMemes');
      if(grid)grid.innerHTML=`<div class="empty"><b>Cycle Radar sin lectura fiable</b><span>${esc(error.message)}</span></div>`;
    }
  }

  loadCycle();
  setInterval(loadCycle,30000);
})();

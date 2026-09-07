'use strict';

(()=>{
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const stageLabel=value=>({DISCOVERED:'Descubierto',EMERGING:'Emergente',BREAKOUT:'Breakout',CULTURAL_CONTENDER:'Candidato cultural',CHAIN_ICON:'Icono de la chain',CYCLE_MEME:'Meme del ciclo'}[value]||value||'Descubierto');
  const stageIcon=value=>({DISCOVERED:'🌱',EMERGING:'👀',BREAKOUT:'🔥',CULTURAL_CONTENDER:'🎭',CHAIN_ICON:'👑',CYCLE_MEME:'🌍'}[value]||'🌱');
  const entryLabel=value=>({ENTRY_CANDIDATE:'REVISAR ENTRADA',HIGH_CONFLUENCE:'ALTA CONFLUENCIA',DO_NOT_CHASE:'NO PERSEGUIR',DISTRIBUTION:'SALIDA / DISTRIBUCIÓN',BLOCKED:'NO ENTRAR',WATCH:'VIGILAR',IGNORE:'SIN SEÑAL DE ENTRADA',NO_RECENT_SIGNAL:'SIN SEÑAL TÁCTICA RECIENTE'}[value]||value||'SIN SEÑAL TÁCTICA RECIENTE');
  const directionLabel=value=>({RISING_FAST:'SUBIENDO RÁPIDO',RISING:'SUBIENDO',STABLE:'ESTABLE',COOLING:'ENFRIANDO',FALLING_FAST:'CAYENDO RÁPIDO',BUILDING_HISTORY:'CREANDO HISTÓRICO'}[value]||value||'CREANDO HISTÓRICO');
  const lifecycleLabel=value=>({ACTIVE:'activo',WARM:'seguimiento',COOLING:'enfriando',DORMANT:'dormido',RESEARCH:'investigación'}[value]||value||'investigación');
  const componentLabel=value=>({money:'Money',culture:'Cultura',holders:'Holders',resilience:'Resiliencia',velocity:'Atención',market:'Mercado',safety:'Safety',momentum:'Momentum',organic:'Absorción'}[value]||value);
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
    .replace('post-drawdown resilience is still being tested','resiliencia post-crash todavía en prueba')
    .replace('post-drawdown structure remains weak','estructura post-crash débil');
  const toneForEntry=value=>value==='DISTRIBUTION'||value==='BLOCKED'?'negative':value==='HIGH_CONFLUENCE'||value==='ENTRY_CANDIDATE'?'positive':value==='DO_NOT_CHASE'?'warning':'neutral';
  const fmt=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('es-ES',{maximumFractionDigits:1}):'—';
  const delta=value=>Number.isFinite(Number(value))?`${Number(value)>=0?'+':''}${Number(value).toFixed(1)}`:'—';

  function componentChips(components={}){
    const keys=['culture','holders','money','resilience','market'];
    return keys.map(key=>{
      const raw=components[key],known=raw!=null&&Number.isFinite(Number(raw));
      const value=known?Math.round(Number(raw)):'—';
      const tone=!known?'':value>=75?'positive':value>=55?'info':value<35?'negative':'';
      return`<span class="cycle-chip ${tone}"><small>${esc(componentLabel(key))}</small><b>${esc(value)}</b></span>`;
    }).join('');
  }

  function analogueLine(analogues=[]){
    if(!analogues.length)return'';
    return`<div class="cycle-analogues"><small>PATRONES HISTÓRICOS</small>${analogues.map(a=>`<span><b>${esc(a.label)}</b> · ${esc(a.why)}${a.warning?` · ⚠ ${esc(a.warning)}`:''}</span>`).join('')}</div>`;
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
      <div class="cycle-components">${componentChips(signal.cycleComponents)}</div>
      <div class="cycle-evidence-line">
        <span>Holders <b>${esc(fmt(evidence.currentHolders))}</b></span>
        <span>Money hold <b>${esc(evidence.currentQualifiedMoneyHolders??0)}</b></span>
        <span>Money ciclo <b>${esc(evidence.moneyActors??0)}</b></span>
        <span>Scouts <b>${esc(evidence.socialScouts??0)}</b></span>
      </div>
      <div class="cycle-evidence-line">
        <span>Δ score 6h <b>${esc(delta(signal.cycleDelta6h))}</b></span>
        <span>24h <b>${esc(delta(signal.cycleDelta24h))}</b></span>
        <span>3d <b>${esc(delta(signal.cycleDelta3d))}</b></span>
        <span>Top10 <b>${evidence.top10Pct==null?'—':esc(fmt(evidence.top10Pct))+'%'}</b></span>
      </div>
      <div class="cycle-thesis">
        <div><small>POR QUÉ PUEDE SUBIR DE CATEGORÍA</small>${reasons.length?`<ul>${reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>Todavía no hay evidencia suficiente para una tesis fuerte.</p>'}</div>
        <div><small>QUÉ PUEDE ROMPER LA TESIS</small>${risks.length?`<ul>${risks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>Sin riesgos nuevos detectados por el motor.</p>'}</div>
      </div>
      ${analogueLine(signal.cycleAnalogues||[])}
      <details class="technical cycle-tech"><summary>Ver evidencia completa</summary>
        <p>Cycle Potential ${esc(Math.round(Number(signal.cyclePotential||0)))}/100 · motor V${esc(signal.cycleVersion||3)}. Entry Score sigue siendo independiente.</p>
        <p>Cultura ${esc(signal.cycleComponents?.culture??0)} · Holders ${esc(signal.cycleComponents?.holders??'—')} · Money ${esc(signal.cycleComponents?.money??0)} · Resiliencia ${esc(signal.cycleComponents?.resilience??'—')} · Mercado ${esc(signal.cycleComponents?.market??0)} · Atención ${esc(signal.cycleComponents?.velocity??0)} · Absorción ${esc(signal.cycleComponents?.organic??'—')}.</p>
        <p>Holder 24h ${esc(evidence.holderGrowth24h??'—')}% · 3d ${esc(evidence.holderGrowth3d??'—')}% · 7d ${esc(evidence.holderGrowth7d??'—')}% · Drawdown máx. observado ${esc(evidence.maxDrawdownPct??'—')}% · recuperación del peak ${esc(evidence.peakRecoveryPct??'—')}%.</p>
        ${missing.length?`<p>Datos todavía insuficientes: ${esc(missing.join(' + '))}.</p>`:''}
        <p><code>${esc(signal.tokenAddress||'')}</code></p>
      </details>
    </article>`;
  }

  function risingRow(signal,index){
    return`<div class="cycle-rising-row"><span>${index+1}</span><div><b>${esc(signal.symbol||'TOKEN')}</b><small>${esc(stageLabel(signal.cycleStage))}</small></div><strong>${esc(directionLabel(signal.cycleDirection))}</strong><em>24h ${esc(delta(signal.cycleDelta24h))}</em></div>`;
  }

  function render(data){
    const signals=(data.cycleMemes||[]).filter(signal=>Number.isFinite(Number(signal.cyclePotential))).sort((a,b)=>Number(b.cyclePotential||0)-Number(a.cyclePotential||0));
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
    if(grid)grid.innerHTML=visible.length?visible.map((signal,i)=>card(signal,rankedAddresses.has(signal.tokenAddress)?`#${signals.findIndex(x=>x.tokenAddress===signal.tokenAddress)+1}`:'★')).join(''):
      '<div class="empty cycle-empty"><b>Aún no hay candidatos calificables</b><span>El Cycle Radar conserva candidatos por contrato y acumula evidencia aunque no exista una entrada reciente.</span></div>';
    if(risingWrap)risingWrap.hidden=!rising.length;
    if(risingBox)risingBox.innerHTML=rising.map(risingRow).join('');
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

  loadCycle();
  setInterval(loadCycle,30000);
})();
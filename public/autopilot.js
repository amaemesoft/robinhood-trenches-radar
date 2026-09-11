'use strict';
(()=>{
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd=v=>v!=null&&Number.isFinite(Number(v))?`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}`:'—';
  const pct=v=>v!=null&&Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(2)}%`:'—';
  const price=v=>{const n=Number(v);if(v==null||!Number.isFinite(n))return'—';return n>=1?`$${n.toFixed(4)}`:`$${n.toPrecision(5)}`;};
  const ago=v=>{const ms=Date.now()-Date.parse(v||'');if(!Number.isFinite(ms))return'—';const m=Math.max(0,Math.round(ms/60000));return m<2?'ahora':m<60?`${m}m`:`${Math.round(m/60)}h`;};
  const why=v=>({critical_safety_not_pass:'Safety sin validar',exit_quote_not_pass:'Sin cotización de salida',sell_impact_too_high:'Impacto de salida excesivo',stale_or_future_safety_quote:'Safety o cotización sin frescura válida',needs_two_verified_economic_actors:'Faltan dos compradores económicos independientes y verificados',stale_or_missing_market_state:'Precio ausente, antiguo o fecha inválida',missing_liquidity_or_quote_size:'Liquidez o tamaño de cotización desconocidos',no_active_setup:'Aún no hay un setup válido',no_pullback_yet:'Esperando retroceso',setup_too_new:'Esperando confirmación temporal',do_not_chase:'No perseguir el precio',do_not_chase_reference_multiple:'Precio demasiado alejado del setup',risk_stop:'Stop de riesgo',signal_distribution:'Distribución detectada',exit_unavailable_no_simulated_fill:'Salida pendiente: falta una cotización válida',all_gates_pass:'Todos los controles han pasado',required_gate_not_pass:'Espera a que pasen todos los controles',position_below_minimum:'Tamaño operable por debajo del mínimo',tactical_observation:'Observación del radar',cycle_and_tactical_observation:'Observación de Cycle y radar',no_valid_setup:'Falta un setup confirmado',paper_only:'Sólo capital ficticio',cannot_override_required_gates:'Registra la decisión sin saltarse controles',radar_ignore:'Sin evidencia suficiente de entrada',radar_watch:'En vigilancia',risk_budget_available:'Tamaño dentro del presupuesto de riesgo',setup_defined:'Setup e invalidación definidos',first_valid_pullback_band:'Retroceso válido confirmado',safety_and_exit_pass:'Safety y salida comprobadas',fresh_market_state:'Precio reciente y contrato confirmado',daily_loss_limit:'Límite de pérdida diaria alcanzado',max_open_positions:'Máximo de posiciones abiertas',vector_invalidation_hit:'Setup invalidado por precio',pullback_beyond_invalidation_band:'Retroceso fuera del rango permitido',critical_safety_fail:'Fallo crítico de seguridad',fuse_approved_after_pullback:'Controles aprobados tras retroceso'}[v]||v||'—');
  const cls=v=>String(v||'wait').toLowerCase().replace(/[^a-z0-9_-]/g,'-');

  const ordered=agents=>['ORBIT','SIGNAL','ATLAS','SENTINEL','VECTOR','PULSE','ANCHOR','FUSE','LEDGER','COMMANDER'].filter(n=>agents?.[n]).map(n=>[n,agents[n]]);
  const gateDefinitions=[
    ['SEÑAL',['ORBIT','SIGNAL']],
    ['MERCADO',['ATLAS']],
    ['SEGURIDAD',['SENTINEL']],
    ['TIMING',['VECTOR','PULSE']],
    ['RIESGO',['ANCHOR','FUSE','LEDGER','COMMANDER']]
  ];
  const statusWeight={BLOCK:6,INVALID:6,FAIL:6,WAIT:5,REVIEW:4,PENDING:4,CAUTION:3,OBSERVE:2,PASS:1,APPROVE:1,OPENED:1,CLOSED:1,READY:1};
  const statusLabel=v=>({PASS:'OK',APPROVE:'OK',OPENED:'OK',CLOSED:'OK',READY:'OK',OBSERVE:'OBSERVA',WAIT:'ESPERA',REVIEW:'REVISA',PENDING:'PENDIENTE',BLOCK:'BLOQUEO',INVALID:'INVÁLIDO',FAIL:'BLOQUEO'}[v]||v||'—');
  const groupedGates=agents=>gateDefinitions.map(([label,names])=>{
    const rows=names.filter(name=>agents?.[name]).map(name=>[name,agents[name]]);
    if(!rows.length)return{label,status:'PENDING',reason:'required_gate_not_pass',rows};
    const worst=[...rows].sort((a,b)=>(statusWeight[b[1].status]||2)-(statusWeight[a[1].status]||2))[0][1];
    return{label,status:worst.status,reason:worst.reason,rows};
  });
  const reason=d=>{const row=ordered(d.agents).find(([,a])=>['WAIT','BLOCK','REVIEW','INVALID'].includes(a.status));return d.decision==='ENTRY'?'Todos los controles han pasado':d.decision==='EXIT'?why(d.reason):row?why(row[1].reason):why(d.reason);};
  function renderPositions(rows){
    const el=$('autopilotPositions');if(!el)return;
    if(!rows?.length){el.innerHTML='<div class="autopilot-empty">Sin posiciones abiertas. El desk sólo entra cuando todos los gates pasan.</div>';return;}
    el.innerHTML=rows.map(p=>`<article class="autopilot-position">
      <div><b>${esc(p.symbol||p.tokenAddress?.slice(0,8))}</b><span>${esc(p.tokenAddress)}</span></div>
      <strong class="${Number(p.returnPct)>=0?'positive':'negative'}">${pct(p.returnPct)}</strong>
      <small>${p.pendingExitReason?'SALIDA PENDIENTE · '+esc(why(p.pendingExitReason))+' · ':''}Entrada ${price(p.entryPriceUsd)} · Ahora ${price(p.currentPriceUsd)} · Stop ${price(p.stopPriceUsd)} · ${usd(p.valueUsd)}</small>
    </article>`).join('');
  }

  function renderSetups(rows){
    const el=$('autopilotSetups');if(!el)return;
    if(!rows?.length){el.innerHTML='<div class="autopilot-empty">No hay setups esperando pullback.</div>';return;}
    el.innerHTML=rows.slice(0,8).map(s=>`<article class="autopilot-setup">
      <div><b>${esc(s.symbol||s.tokenAddress?.slice(0,8))}</b><span>${esc(s.status)}</span></div>
      <small>Referencia ${price(s.referencePriceUsd)} · invalidación ${price(s.invalidationPriceUsd)} · pullback ${esc(s.minPullbackPct)}–${esc(s.maxPullbackPct)}%</small>
    </article>`).join('');
  }

  function renderDecision(d){
    const el=$('autopilotDecision');if(!el)return;
    if(!d){el.innerHTML='<div class="autopilot-empty">Esperando la primera evaluación.</div>';return;}
    const gates=groupedGates(d.agents).map(gate=>`<span class="agent-gate ${cls(gate.status)}"><b>${esc(gate.label)}</b><i>${esc(statusLabel(gate.status))}</i><small>${esc(why(gate.reason))}</small></span>`).join('');
    const trace=ordered(d.agents).map(([name,a])=>`<p><b>${esc(name)} · ${esc(a.status)}</b> · ${esc(why(a.reason))}</p>`).join('');
    el.innerHTML=`<article class="autopilot-brief">
      <div class="autopilot-brief-top"><div><b>${esc(d.symbol||d.tokenAddress?.slice(0,8))}</b><span>${esc(d.signalState||'—')} · ${ago(d.at)}</span></div><strong>${price(d.marketPriceUsd)}</strong></div>
      <p><b>${esc(d.decision)}</b> · ${esc(reason(d))}</p><div class="agent-grid">${gates}</div><details><summary>Trazabilidad técnica</summary><code>${esc(d.tokenAddress)}</code><p>Mercado observado: ${esc(d.evidence?.observedAt||'desconocido')}</p><p>${esc(d.evidence?.events?.length||0)} eventos disponibles en ese momento.</p>${trace}<code>${esc(d.id)}</code></details>
    </article>`;
  }

  function renderTrades(rows){
    const el=$('autopilotTrades');if(!el)return;
    if(!rows?.length){el.innerHTML='<div class="autopilot-empty">Todavía no hay paper trades.</div>';return;}
    el.innerHTML=rows.slice(0,6).map(t=>`<div class="autopilot-trade"><b>${esc(t.side==='BUY_SHADOW'?'ENTRADA':'SALIDA')} · ${esc(t.symbol||t.tokenAddress?.slice(0,8))}</b><span>${usd(t.costUsd??t.proceedsUsd)} · ${esc(why(t.reason))} · ${ago(t.at)}</span>${t.pnlUsd!=null?`<strong class="${Number(t.pnlUsd)>=0?'positive':'negative'}">${usd(t.pnlUsd)}</strong>`:''}</div>`).join('');
  }

  async function load(){
    try{
      const r=await fetch('/api/autopilot',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const d=await r.json(),b=d.bankroll||{},risk=d.risk||{};
      $('autopilotInitial').textContent=usd(b.initialBalanceUsd);
      $('autopilotClosed').textContent=String(d.counters?.exits||0);
      $('autopilotBlocked').textContent=String(d.counters?.blocked||0);
      $('autopilotAuditor').textContent=`${d.auditor?.samples||0} observaciones recientes · ${d.auditor?.completed24h||0} con retorno a 24 h. ${d.auditor?.evidence==='INSUFFICIENT_SAMPLE'?'Muestra todavía insuficiente.':'Resultados observacionales; no demuestran causalidad.'} MFE/MAE usan precios muestreados.`;
      $('autopilotDecisions').innerHTML=(d.recentDecisions||[]).slice(1).map(x=>`<details><summary>${esc(x.symbol)} · ${esc(x.decision)} · ${ago(x.at)}</summary><p>${esc(reason(x))}</p><code>${esc(x.tokenAddress)}</code><details><summary>Trazabilidad interna</summary>${ordered(x.agents).map(([n,a])=>`<p><b>${esc(n)} · ${esc(a.status)}</b> · ${esc(why(a.reason))}</p>`).join('')}</details></details>`).join('');
      $('autopilotEquity').textContent=usd(b.equityUsd);
      $('autopilotPnl').textContent=`${usd(b.totalPnlUsd)} · ${pct(b.totalReturnPct)}`;
      $('autopilotCash').textContent=usd(b.cashUsd);
      $('autopilotOpen').textContent=String(d.positions?.length||0);
      $('autopilotWaiting').textContent=String(d.setups?.length||0);
      $('autopilotRisk').textContent=`SHADOW / PAPER_ONLY · ${d.runtime?.status==='RUNNING'?'En marcha':'Ciclo pendiente o degradado'} · Riesgo diario ${Number(risk.dailyLossPct||0).toFixed(2)} / ${Number(risk.maxDailyLossPct||0).toFixed(0)}% · ${d.execution==='PAPER_ONLY'?'sin dinero real':'—'} · ${d.lastRunAt?`último ciclo ${ago(d.lastRunAt)}`:'arrancando'}`;
      const pnlEl=$('autopilotPnl');pnlEl.classList.toggle('positive',Number(b.totalPnlUsd)>=0);pnlEl.classList.toggle('negative',Number(b.totalPnlUsd)<0);
      renderPositions(d.positions);renderSetups(d.setups);renderDecision(d.recentDecisions?.[0]);renderTrades(d.recentTrades);
    }catch(e){
      for(const id of ['autopilotEquity','autopilotPnl','autopilotCash','autopilotInitial'])if($(id))$(id).textContent='—';
      if($('autopilotRisk'))$('autopilotRisk').textContent=`Shadow Desk no disponible: ${e.message}`;
    }
  }
  let refreshTimer=null;
  function setActive(active){
    if(active&&!refreshTimer){load();refreshTimer=setInterval(load,45000);}
    if(!active&&refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
  }
  document.addEventListener('trenches:viewchange',event=>setActive(event.detail?.view==='desk'));
  const deskPanel=document.querySelector('[data-view-panel="desk"]');
  setActive(!deskPanel||!deskPanel.hidden);
})();

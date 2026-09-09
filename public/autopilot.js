'use strict';
(()=>{
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd=v=>Number.isFinite(Number(v))?`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}`:'—';
  const pct=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(2)}%`:'—';
  const price=v=>{const n=Number(v);if(!Number.isFinite(n))return'—';return n>=1?`$${n.toFixed(4)}`:`$${n.toPrecision(5)}`;};
  const ago=v=>{const ms=Date.now()-Date.parse(v||'');if(!Number.isFinite(ms))return'—';const m=Math.max(0,Math.round(ms/60000));return m<2?'ahora':m<60?`${m}m`:`${Math.round(m/60)}h`;};
  const why=v=>({critical_safety_not_pass:'Safety sin validar',exit_quote_not_pass:'Sin cotización de salida',sell_impact_too_high:'Impacto de salida excesivo',stale_or_future_safety_quote:'Safety o cotización sin frescura válida',needs_two_verified_economic_actors:'Faltan dos compradores económicos independientes y verificados',stale_or_missing_market_state:'Precio ausente, antiguo o fecha inválida',missing_liquidity_or_quote_size:'Liquidez o tamaño de cotización desconocidos',no_active_setup:'Aún no hay un setup válido',no_pullback_yet:'Esperando retroceso',setup_too_new:'Esperando confirmación temporal',do_not_chase:'No perseguir el precio',do_not_chase_reference_multiple:'Precio demasiado alejado del setup',risk_stop:'Stop de riesgo',signal_distribution:'Distribución detectada',exit_unavailable_no_simulated_fill:'Salida pendiente: falta una cotización válida',all_gates_pass:'Todos los controles han pasado'}[v]||v||'—');
  const cls=v=>String(v||'wait').toLowerCase().replace(/[^a-z0-9_-]/g,'-');

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
      <small>VECTOR · ref ${price(s.referencePriceUsd)} · invalidación ${price(s.invalidationPriceUsd)} · pullback ${esc(s.minPullbackPct)}–${esc(s.maxPullbackPct)}%</small>
    </article>`).join('');
  }

  function renderDecision(d){
    const el=$('autopilotDecision');if(!el)return;
    if(!d){el.innerHTML='<div class="autopilot-empty">Esperando la primera evaluación multiagente.</div>';return;}
    const agents=Object.entries(d.agents||{}).map(([name,a])=>`<span class="agent-gate ${cls(a.status)}"><b>${esc(name)}</b><i>${esc(a.status)}</i><small>${esc(why(a.reason))}</small></span>`).join('');
    el.innerHTML=`<article class="autopilot-brief">
      <div class="autopilot-brief-top"><div><b>${esc(d.symbol||d.tokenAddress?.slice(0,8))}</b><span>${esc(d.signalState||'—')} · ${ago(d.at)}</span></div><strong>${price(d.marketPriceUsd)}</strong></div>
      <p><b>${esc(d.decision)}</b> · ${esc(why(d.reason))}</p><div class="agent-grid">${agents}</div><details><summary>Contrato y evidencia</summary><code>${esc(d.tokenAddress)}</code><p>Mercado observado: ${esc(d.evidence?.observedAt||'desconocido')}</p><p>${esc(d.evidence?.events?.length||0)} eventos disponibles en ese momento.</p><code>${esc(d.id)}</code></details>
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
      $('autopilotAuditor').textContent=`${d.auditor?.samples||0} observaciones recientes · ${d.auditor?.completed24h||0} con retorno a 24 h. ${d.auditor?.evidence==='INSUFFICIENT_SAMPLE'?'Muestra insuficiente para atribuir valor a los agentes.':'Resultados observacionales; no demuestran causalidad.'} MFE/MAE basados en precios muestreados. No cambia los gates.`;
      $('autopilotDecisions').innerHTML=(d.recentDecisions||[]).slice(1).map(x=>`<details><summary>${esc(x.symbol)} · ${esc(x.decision)} · ${ago(x.at)}</summary><p>${esc(why(x.reason))}</p><code>${esc(x.tokenAddress)}</code>${Object.entries(x.agents||{}).map(([n,a])=>`<p><b>${esc(n)}: ${esc(a.status)}</b> · ${esc(why(a.reason))}</p>`).join('')}</details>`).join('');
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
  load();setInterval(load,45000);
})();

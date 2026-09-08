'use strict';
(()=>{
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd=v=>Number.isFinite(Number(v))?`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}`:'—';
  const pct=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(2)}%`:'—';
  const price=v=>{const n=Number(v);if(!Number.isFinite(n))return'—';return n>=1?`$${n.toFixed(4)}`:`$${n.toPrecision(5)}`;};
  const ago=v=>{const ms=Date.now()-Date.parse(v||'');if(!Number.isFinite(ms))return'—';const m=Math.max(0,Math.round(ms/60000));return m<2?'ahora':m<60?`${m}m`:`${Math.round(m/60)}h`;};
  const cls=v=>String(v||'wait').toLowerCase().replace(/[^a-z0-9_-]/g,'-');

  function renderPositions(rows){
    const el=$('autopilotPositions');if(!el)return;
    if(!rows?.length){el.innerHTML='<div class="autopilot-empty">Sin posiciones abiertas. El desk sólo entra cuando todos los gates pasan.</div>';return;}
    el.innerHTML=rows.map(p=>`<article class="autopilot-position">
      <div><b>${esc(p.symbol||p.tokenAddress?.slice(0,8))}</b><span>${esc(p.tokenAddress)}</span></div>
      <strong class="${Number(p.returnPct)>=0?'positive':'negative'}">${pct(p.returnPct)}</strong>
      <small>Entrada ${price(p.entryPriceUsd)} · Ahora ${price(p.currentPriceUsd)} · Stop ${price(p.stopPriceUsd)} · ${usd(p.valueUsd)}</small>
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
    const agents=Object.entries(d.agents||{}).map(([name,a])=>`<span class="agent-gate ${cls(a.status)}"><b>${esc(name)}</b><i>${esc(a.status)}</i></span>`).join('');
    el.innerHTML=`<article class="autopilot-brief">
      <div class="autopilot-brief-top"><div><b>${esc(d.symbol||d.tokenAddress?.slice(0,8))}</b><span>${esc(d.signalState||'—')} · ${ago(d.at)}</span></div><strong>${price(d.marketPriceUsd)}</strong></div>
      <div class="agent-grid">${agents}</div>
    </article>`;
  }

  function renderTrades(rows){
    const el=$('autopilotTrades');if(!el)return;
    if(!rows?.length){el.innerHTML='<div class="autopilot-empty">Todavía no hay paper trades.</div>';return;}
    el.innerHTML=rows.slice(0,6).map(t=>`<div class="autopilot-trade"><b>${esc(t.side==='BUY_SHADOW'?'ENTRADA':'SALIDA')} · ${esc(t.symbol||t.tokenAddress?.slice(0,8))}</b><span>${usd(t.costUsd??t.proceedsUsd)} · ${esc(t.reason)} · ${ago(t.at)}</span>${t.pnlUsd!=null?`<strong class="${Number(t.pnlUsd)>=0?'positive':'negative'}">${usd(t.pnlUsd)}</strong>`:''}</div>`).join('');
  }

  async function load(){
    try{
      const r=await fetch('/api/autopilot',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const d=await r.json(),b=d.bankroll||{},risk=d.risk||{};
      $('autopilotEquity').textContent=usd(b.equityUsd);
      $('autopilotPnl').textContent=`${usd(b.totalPnlUsd)} · ${pct(b.totalReturnPct)}`;
      $('autopilotCash').textContent=usd(b.cashUsd);
      $('autopilotOpen').textContent=String(d.positions?.length||0);
      $('autopilotWaiting').textContent=String(d.setups?.length||0);
      $('autopilotRisk').textContent=`Riesgo diario ${Number(risk.dailyLossPct||0).toFixed(2)} / ${Number(risk.maxDailyLossPct||0).toFixed(0)}% · ${d.execution==='PAPER_ONLY'?'sin dinero real':'—'} · ${d.lastRunAt?`último ciclo ${ago(d.lastRunAt)}`:'arrancando'}`;
      const pnlEl=$('autopilotPnl');pnlEl.classList.toggle('positive',Number(b.totalPnlUsd)>=0);pnlEl.classList.toggle('negative',Number(b.totalPnlUsd)<0);
      renderPositions(d.positions);renderSetups(d.setups);renderDecision(d.recentDecisions?.[0]);renderTrades(d.recentTrades);
    }catch(e){
      if($('autopilotRisk'))$('autopilotRisk').textContent=`Shadow Desk no disponible: ${e.message}`;
    }
  }
  load();setInterval(load,45000);
})();

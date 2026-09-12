'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function element(extra={}){
  const listeners={};
  return{
    hidden:false,open:false,dataset:{},textContent:'',innerHTML:'',
    addEventListener(type,listener){listeners[type]=listener;},
    querySelector(){return null;},
    setAttribute(name,value){this[name]=value;},
    removeAttribute(name){delete this[name];},
    focus(){this.focused=true;},
    listeners,
    ...extra
  };
}

test('tapping a rising coin renders its exact evidence and preserves UNKNOWN',async()=>{
  const address='0x6245e67affa44a23077f0ea7f981a8dc743a0c47';
  const closeButton=element();
  const dialog=element({
    querySelector(selector){return selector==='[data-cycle-close]'?closeButton:null;},
    showModal(){this.open=true;},
    close(){this.open=false;this.listeners.close?.();}
  });
  const nodes={
    '#cycleCount':element(),'#cycleMemes':element(),'#cycleRising':element(),'#cycleRisingWrap':element({hidden:true}),
    '#cycleDetailDialog':dialog,'#cycleDetailBody':element(),'#cycleDetailTitle':element(),
    '[data-view-panel="discover"]':element({hidden:true})
  };
  const documentListeners={};
  const document={
    querySelector(selector){return nodes[selector]||null;},
    addEventListener(type,listener){documentListeners[type]=listener;}
  };
  const payload={cycleMemes:[{
    tokenAddress:address,symbol:'frong ($FRONG)',cycleStage:'BREAKOUT',cycleLifecycle:'ACTIVE',cycleDirection:'RISING_FAST',
    cyclePotential:63,cycleRawPotential:79.4,cycleCoverage:.62,cycleConfidence:.71,cycleVersion:4,
    cycleDelta6h:4.2,cycleDelta24h:9.5,cycleDelta3d:14.1,attentionDirection:'RISING',state:'NO_RECENT_SIGNAL',
    cycleComponents:{culture:91,holders:null,money:74,resilience:null,market:68,velocity:76,safety:25,momentum:82,organic:null},
    cycleReasons:['2 independent established money actors in cycle window','3 independent social scouts across cycle window'],
    cycleRisks:['critical safety still unknown'],cycleMissingData:['holder_growth','long_horizon_resilience'],
    cycleEvidence:{moneyActors:2,moneyEventActors:2,currentQualifiedMoneyHolders:1,socialScouts:3,socialSourceDiversity:2,recentEvents6h:5,priorEvents18h:2},
    cycleGates:{holderReady:false,resilienceReady:false,fullDataReady:false,chainIconGate:false,cycleMemeGate:false},
    safety:{status:'UNKNOWN',reason:'tokenControl'},exitabilityGate:{status:'PASS',reason:null},
    marketCap:4200000,liquidityUsd:240000,sellImpactPct:2.3,exitabilityTargetUsd:250,
    cycleFirstSeenAt:'2026-09-01T00:00:00Z',cycleLastEvidenceAt:'2026-09-12T00:00:00Z'
  }]};
  const sandbox={
    document,fetch:async()=>({ok:true,json:async()=>payload}),
    setInterval:()=>1,clearInterval:()=>{},Intl,Date,Number,String,Math,Set,Map,console
  };
  const source=fs.readFileSync(path.join(__dirname,'..','public','cycle.js'),'utf8');
  vm.runInNewContext(source,sandbox);
  documentListeners['trenches:viewchange']({detail:{view:'discover'}});
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));

  assert.match(nodes['#cycleRising'].innerHTML,/data-cycle-address="0x6245/);
  const button=element({dataset:{cycleAddress:address}});
  nodes['#cycleRising'].listeners.click({target:{closest:()=>button}});

  assert.equal(dialog.open,true);
  assert.equal(nodes['#cycleDetailTitle'].textContent,'frong ($FRONG)');
  assert.match(nodes['#cycleDetailBody'].innerHTML,/\+9\.5 puntos en 24 h/);
  assert.match(nodes['#cycleDetailBody'].innerHTML,/MONEY INDEPENDIENTES<\/small><b>2/);
  assert.match(nodes['#cycleDetailBody'].innerHTML,/Holders \+ absorción · 20%<\/b><strong>UNKNOWN/);
  assert.match(nodes['#cycleDetailBody'].innerHTML,/Safety crítica todavía sin confirmar/);
  assert.match(nodes['#cycleDetailBody'].innerHTML,/0x6245e67affa44a23077f0ea7f981a8dc743a0c47/);
  assert.doesNotMatch(nodes['#cycleDetailBody'].innerHTML,/Holders \+ absorción · 20%<\/b><strong>0\/100/);
});

'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Performance=require('../lib/performance');

const TOKEN='0x1111111111111111111111111111111111111111';
const base=Date.parse('2026-09-06T00:00:00Z');
const at=minutes=>new Date(base+minutes*60*1000).toISOString();

test('computes forward returns and MAE/MFE from observed snapshots',()=>{
  const event={actorId:'alpha',action:'BUY',tokenAddress:TOKEN,at:at(0),referencePriceUsd:1,priceObservedAt:at(0)};
  const history=[
    {at:at(0),priceUsd:1},{at:at(3),priceUsd:0.9},{at:at(5),priceUsd:1.1},
    {at:at(60),priceUsd:1.5},{at:at(1440),priceUsd:1.2}
  ];
  const result=Performance.eventPerformance(event,history);
  assert.equal(result.returns.m5.pct,10);
  assert.equal(result.returns.h1.pct,50);
  assert.equal(result.returns.h24.pct,20);
  assert.equal(result.maePct,-10);
  assert.equal(result.mfePct,50);
});

test('does not invent performance without an entry-time price',()=>{
  const event={actorId:'alpha',action:'BUY',tokenAddress:TOKEN,at:at(0)};
  const result=Performance.eventPerformance(event,[{at:at(20),priceUsd:2}]);
  assert.equal(result.status,'WAITING_BASE_PRICE');
  assert.equal(result.basePriceUsd,null);
});

test('keeps wallets provisional when no economic entries were verified',()=>{
  const actors=[{id:'alpha',handle:'alpha',kind:'money',enabled:true,division:'PROVISIONAL'}];
  const events=[
    {actorId:'alpha',action:'ACQUIRE',tokenAddress:TOKEN,at:at(0)},
    {actorId:'alpha',action:'TRANSFER_OUT',tokenAddress:TOKEN,at:at(5)}
  ];
  const report=Performance.calibrationReport(actors,events,{});
  assert.equal(report.status,'INSUFFICIENT_VERIFIED_ENTRIES');
  assert.equal(report.dataset.verifiedEntries,0);
  assert.equal(report.actors[0].status,'NO_VERIFIED_ENTRIES');
  assert.equal(report.actors[0].acquires,1);
  assert.equal(report.actors[0].transfers,1);
});

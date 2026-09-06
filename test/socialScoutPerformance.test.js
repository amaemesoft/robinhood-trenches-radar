'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Performance=require('../lib/performance');

const actors=[
  {id:'scout',handle:'scout',kind:'social',enabled:true},
  {id:'money1',handle:'money1',kind:'money',enabled:true},
  {id:'money2',handle:'money2',kind:'money',enabled:true}
];
const token='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const t0=Date.parse('2026-09-01T00:00:00Z');

function at(minutes){return new Date(t0+minutes*60000).toISOString();}

test('counts a later money BUY as confirmed scout lead',()=>{
  const events=[
    {actorId:'scout',action:'SCOUT',tokenAddress:token,at:at(0),source:'fxtwitter-public'},
    {actorId:'scout',action:'SCOUT',tokenAddress:token,at:at(5),source:'telegram-public'},
    {actorId:'money1',action:'BUY',tokenAddress:token,at:at(30)}
  ];
  const row=Performance.socialScoutCalibration(actors[0],actors,events,t0+60*60000);
  assert.equal(row.scouts,1);
  assert.equal(row.confirmed,1);
  assert.equal(row.pending,0);
  assert.equal(row.confirmationRate,100);
  assert.equal(row.medianLeadMinutes,30);
  assert.equal(row.records[0].confirmationActorId,'money1');
});

test('does not count a BUY that happened before the scout',()=>{
  const events=[
    {actorId:'money1',action:'BUY',tokenAddress:token,at:at(0)},
    {actorId:'scout',action:'SCOUT',tokenAddress:token,at:at(10)}
  ];
  const row=Performance.socialScoutCalibration(actors[0],actors,events,t0+30*60000);
  assert.equal(row.confirmed,0);
  assert.equal(row.pending,1);
  assert.equal(row.confirmationRate,null);
});

test('separates pending scouts from matured unconfirmed scouts',()=>{
  const events=[
    {actorId:'scout',action:'SCOUT',tokenAddress:token,at:at(0)},
    {actorId:'scout',action:'SCOUT',tokenAddress:other,at:at(23*60)}
  ];
  const now=t0+25*60*60000;
  const row=Performance.socialScoutCalibration(actors[0],actors,events,now);
  assert.equal(row.scouts,2);
  assert.equal(row.unconfirmed,1);
  assert.equal(row.pending,1);
  assert.equal(row.resolved,1);
  assert.equal(row.confirmationRate,0);
});

test('calibration report exposes social dataset without treating SCOUT as economic entry',()=>{
  const events=[
    {actorId:'scout',action:'SCOUT',tokenAddress:token,at:at(0)},
    {actorId:'money1',action:'BUY',tokenAddress:token,at:at(15)}
  ];
  const report=Performance.calibrationReport(actors,events,{});
  assert.equal(report.dataset.socialScouts,1);
  assert.equal(report.dataset.socialConfirmed,1);
  assert.equal(report.dataset.verifiedEntries,1);
  assert.equal(report.socialActors[0].confirmed,1);
});

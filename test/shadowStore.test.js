'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Store=require('../lib/shadowStore'),Desk=require('../lib/shadowDesk');
test('restart restores identical ledger, revision and original bankroll despite changed defaults',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-test-')),filePath=path.join(dir,'shadow.json');
  try{
    const store=new Store({filePath}),desk=new Desk();await store.init();
    await store.transact(state=>desk.run({state,now:Date.parse('2026-09-09T00:00:00Z')}));
    const before=await store.evidence(),restarted=new Store({filePath});await restarted.init();
    const row=await restarted.read(),after=await restarted.evidence();assert.equal(before.ledgerHash,after.ledgerHash);assert.equal(after.revision,1);
    assert.equal(new Desk({initialBalanceUsd:5000}).snapshot(row.state).bankroll.initialBalanceUsd,1000);
    fs.writeFileSync(filePath,'broken');await assert.rejects(restarted.read());
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Postgres failure rolls back portfolio and journal and propagates error',async()=>{
  const calls=[];let released=false;
  const client={query:async(sql)=>{calls.push(sql);if(sql.startsWith('INSERT INTO shadow_journal'))throw new Error('disk full');return{rows:[]};},release:()=>{released=true;}};
  const store=new Store({pool:{connect:async()=>client}});
  await assert.rejects(store.transact(()=>({state:{cashUsd:999},journal:[{id:'d',kind:'decision',at:'2026-09-09T00:00:00Z'}]})),/disk full/);
  assert(calls.includes('ROLLBACK'));assert(!calls.includes('COMMIT'));assert(released);assert.equal(store.lastPersistedAt,null);
});
test('Postgres serializes concurrent instances with a transaction lock before state read',async()=>{
  const calls=[];const client={query:async(sql)=>{calls.push(sql);return{rows:[]};},release:()=>{}};
  const store=new Store({pool:{connect:async()=>client}});await store.transact(()=>({state:{mode:'SHADOW'},journal:[]}));
  assert(calls[1].includes('pg_advisory_xact_lock'));assert(calls[2].startsWith('SELECT state'));assert.equal(calls.at(-1),'COMMIT');
});

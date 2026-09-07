'use strict';

const {Pool}=require('pg');
const provisional=require('../lib/provisionalMoneyWallets');

const DATABASE_URL=process.env.DATABASE_URL||'';
if(!DATABASE_URL)throw new Error('DATABASE_URL is required');

const validAddress=a=>/^0x[a-fA-F0-9]{40}$/.test(a||'');
const uniqueMoneyAddresses=actors=>new Set((actors||[])
  .filter(a=>a.kind==='money'&&a.enabled!==false&&validAddress(a.evmAddress))
  .map(a=>a.evmAddress.toLowerCase()));

(async()=>{
  const pool=new Pool({connectionString:DATABASE_URL,ssl:DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const row=await client.query('SELECT state FROM radar_state WHERE id=1 FOR UPDATE');
    if(!row.rows.length)throw new Error('radar_state id=1 not found');
    const state=row.rows[0].state||{};
    const actors=Array.isArray(state.actors)?state.actors:[];
    const beforeMoney=uniqueMoneyAddresses(actors);
    const ids=new Set(actors.map(a=>a.id));
    const addresses=new Set(actors.map(a=>String(a.evmAddress||'').toLowerCase()).filter(Boolean));
    const added=[];
    for(const actor of provisional){
      if(ids.has(actor.id)||addresses.has(actor.evmAddress.toLowerCase()))continue;
      actors.push({...actor});
      ids.add(actor.id);addresses.add(actor.evmAddress.toLowerCase());added.push(actor.id);
    }
    const afterMoney=uniqueMoneyAddresses(actors);
    if(afterMoney.size!==25)throw new Error(`Expected exactly 25 unique enabled money addresses, got ${afterMoney.size}`);
    state.actors=actors;
    state.updatedAt=new Date().toISOString();
    await client.query('UPDATE radar_state SET state=$1::jsonb, updated_at=NOW() WHERE id=1',[JSON.stringify(state)]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ok:true,beforeMoney:beforeMoney.size,added:added.length,afterMoney:afterMoney.size,totalActors:actors.length}));
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    console.error(error.message);process.exitCode=1;
  }finally{
    client.release();await pool.end();
  }
})();

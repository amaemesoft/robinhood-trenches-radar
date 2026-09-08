'use strict';

const {Pool}=require('pg');

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
    const trackedWallets=uniqueMoneyAddresses(state.actors||[]).size;
    const previous=state.sync?.alchemyBackfill||{};
    const previousTracked=Number(previous.trackedWallets||0);
    let invalidated=false;

    if(previous.completedAt&&trackedWallets>previousTracked){
      state.sync=state.sync||{};
      state.sync.alchemyBackfill={
        ...previous,
        status:'pending',
        completedAt:null,
        error:null,
        invalidatedAt:new Date().toISOString(),
        invalidatedReason:`wallet_set_expanded_${previousTracked}_to_${trackedWallets}`
      };
      state.updatedAt=new Date().toISOString();
      await client.query('UPDATE radar_state SET state=$1::jsonb, updated_at=NOW() WHERE id=1',[JSON.stringify(state)]);
      invalidated=true;
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ok:true,trackedWallets,previousTracked,invalidated,status:invalidated?'BACKFILL_REOPENED':'NO_CHANGE'}));
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    console.error(error.message);process.exitCode=1;
  }finally{
    client.release();await pool.end();
  }
})();

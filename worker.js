'use strict';

const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/,'');
const INTERNAL_SYNC_TOKEN = process.env.INTERNAL_SYNC_TOKEN || '';
const POLL_SECONDS = Math.max(60, Number(process.env.POLL_SECONDS || 120));

if(!APP_BASE_URL){
  console.error('APP_BASE_URL is required, e.g. https://your-app.up.railway.app');
  process.exit(1);
}
if(!INTERNAL_SYNC_TOKEN){
  console.error('INTERNAL_SYNC_TOKEN is required');
  process.exit(1);
}

let running = false;
async function tick(){
  if(running) return;
  running = true;
  try{
    const r = await fetch(`${APP_BASE_URL}/api/internal/sync`, {
      method:'POST',
      headers:{'authorization':`Bearer ${INTERNAL_SYNC_TOKEN}`,'content-type':'application/json'},
      body:'{}'
    });
    const text = await r.text();
    if(!r.ok) throw new Error(`sync HTTP ${r.status}: ${text.slice(0,300)}`);
    console.log(`[worker] ${new Date().toISOString()} ${text}`);
  }catch(e){
    console.error(`[worker] ${new Date().toISOString()} ${e.message}`);
  }finally{
    running = false;
  }
}

console.log(`[worker] polling ${APP_BASE_URL} every ${POLL_SECONDS}s`);
tick();
setInterval(tick, POLL_SECONDS * 1000);

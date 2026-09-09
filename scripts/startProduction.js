'use strict';
// One API/state writer; supervised workers talk to it through authenticated HTTP.
const {spawn,spawnSync}=require('node:child_process');
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw new Error('PostgreSQL is required in production');
for(const file of ['expandMoneyWallets25.js','invalidateAlchemyBackfillOnWalletChange.js']){
  const r=spawnSync(process.execPath,[require('node:path').join(__dirname,file)],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);
}
const children=[];let stopping=false;
function stop(code){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),3000).unref();}
for(const file of ['server.js','worker.js','scripts/liveMoney25.js']){
  const child=spawn(process.execPath,[file],{stdio:'inherit',env:{...process.env,APP_BASE_URL:`http://127.0.0.1:${process.env.PORT||8787}`}});children.push(child);
  child.on('error',()=>stop(1));child.on('exit',(code,signal)=>{if(!stopping){console.error(`[supervisor] ${file} stopped (${code??signal}); restarting service`);stop(1);}});
}
process.on('SIGTERM',()=>stop(0));process.on('SIGINT',()=>stop(0));

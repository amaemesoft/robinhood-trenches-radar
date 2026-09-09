'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const digest=s=>crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function decisionFingerprint(item){
  if(item?.kind!=='decision')return null;
  const agents=Object.fromEntries(Object.entries(item.agents||{}).map(([name,value])=>[name,{...value,ageSeconds:undefined}]));
  return digest(canonical({decision:item.decision,setupId:item.setupId||null,tokenAddress:item.tokenAddress,evidence:item.evidence||{},agents}));
}
class ShadowStore{
  constructor({pool,filePath}){this.pool=pool;this.filePath=filePath;this.lastPersistedAt=null;this.lastMaintenanceAt=0;}
  async init(){
    if(this.pool)await this.pool.query(`CREATE TABLE IF NOT EXISTS shadow_portfolio(id SMALLINT PRIMARY KEY CHECK(id=1),state JSONB NOT NULL,revision BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS shadow_journal(id TEXT PRIMARY KEY,kind TEXT NOT NULL,at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,fingerprint TEXT);
      ALTER TABLE shadow_journal ADD COLUMN IF NOT EXISTS fingerprint TEXT;
      CREATE INDEX IF NOT EXISTS shadow_journal_time ON shadow_journal(at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS shadow_journal_decision_fingerprint ON shadow_journal(fingerprint) WHERE kind='decision' AND fingerprint IS NOT NULL;
      CREATE TABLE IF NOT EXISTS shadow_audits(id TEXT PRIMARY KEY,at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL);`);
  }
  async read(){
    if(this.pool){const r=await this.pool.query('SELECT state,revision,updated_at FROM shadow_portfolio WHERE id=1');return r.rows[0]||null;}
    try{return JSON.parse(fs.readFileSync(this.filePath,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async transact(fn,legacy){
    if(!this.pool){const previous=await this.read(),result=fn(previous?.state||legacy),row={state:result.state,revision:Number(previous?.revision||0)+1,updated_at:new Date().toISOString()};
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});fs.writeFileSync(this.filePath+'.tmp',JSON.stringify(row));fs.renameSync(this.filePath+'.tmp',this.filePath);this.lastPersistedAt=row.updated_at;return result;}
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(4663,910)');
      const prior=await client.query('SELECT state FROM shadow_portfolio WHERE id=1');
      const result=fn(prior.rows[0]?.state||legacy);
      for(const item of result.journal||[]){
        const fingerprint=decisionFingerprint(item);
        await client.query('INSERT INTO shadow_journal(id,kind,at,payload,fingerprint) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING',[item.id,item.kind,item.at,JSON.stringify(item),fingerprint]);
      }
      for(const item of result.auditUpdates||[])await client.query('INSERT INTO shadow_audits(id,at,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[item.id,item.at,JSON.stringify(item)]);
      await client.query('INSERT INTO shadow_portfolio(id,state,revision) VALUES(1,$1::jsonb,1) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,revision=shadow_portfolio.revision+1,updated_at=NOW()',[JSON.stringify(result.state)]);
      if(Date.now()-this.lastMaintenanceAt>3600000){
        // Position marks are high-frequency telemetry, not decision evidence. Trades,
        // setups, decisions and audits remain durable; detailed marks are retained 14d.
        await client.query("DELETE FROM shadow_journal WHERE kind='position_mark' AND at < NOW()-INTERVAL '14 days'");
        this.lastMaintenanceAt=Date.now();
      }
      await client.query('COMMIT');this.lastPersistedAt=new Date().toISOString();return result;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async evidence(){
    const row=await this.read();
    let counts={journal:null,audits:null},bytes={portfolio:null,journal:null,audits:null};
    if(this.pool){
      counts=(await this.pool.query("SELECT (SELECT count(*) FROM shadow_journal) AS journal,(SELECT count(*) FROM shadow_audits) AS audits")).rows[0];
      try{bytes=(await this.pool.query("SELECT pg_total_relation_size('shadow_portfolio')::bigint AS portfolio,pg_total_relation_size('shadow_journal')::bigint AS journal,pg_total_relation_size('shadow_audits')::bigint AS audits")).rows[0];}catch{}
    }
    return{backend:this.pool?'postgres':'file',revision:Number(row?.revision||0),persistedAt:row?.updated_at||null,stateHash:row?digest(row.state):null,ledgerHash:row?digest({createdAt:row.state.createdAt,cashUsd:row.state.cashUsd,positions:row.state.positions,trades:row.state.trades}):null,counts,bytes};
  }
  async history(kind,limit=50,offset=0){
    if(!this.pool)return[];
    const table=kind==='audit'?'shadow_audits':'shadow_journal';
    return(await this.pool.query(`SELECT payload FROM ${table} ORDER BY at DESC,id DESC LIMIT $1 OFFSET $2`,[limit,offset])).rows.map(x=>x.payload);
  }
}
ShadowStore.decisionFingerprint=decisionFingerprint;
module.exports=ShadowStore;

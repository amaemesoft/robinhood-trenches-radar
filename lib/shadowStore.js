'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const digest=s=>crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
class ShadowStore{
  constructor({pool,filePath}){this.pool=pool;this.filePath=filePath;this.lastPersistedAt=null;}
  async init(){
    if(this.pool)await this.pool.query(`CREATE TABLE IF NOT EXISTS shadow_portfolio(id SMALLINT PRIMARY KEY CHECK(id=1),state JSONB NOT NULL,revision BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS shadow_journal(id TEXT PRIMARY KEY,kind TEXT NOT NULL,at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL);
      CREATE INDEX IF NOT EXISTS shadow_journal_time ON shadow_journal(at DESC);
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
      for(const item of result.journal||[])await client.query('INSERT INTO shadow_journal(id,kind,at,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING',[item.id,item.kind,item.at,JSON.stringify(item)]);
      for(const item of result.auditUpdates||[])await client.query('INSERT INTO shadow_audits(id,at,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[item.id,item.at,JSON.stringify(item)]);
      await client.query('INSERT INTO shadow_portfolio(id,state,revision) VALUES(1,$1::jsonb,1) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,revision=shadow_portfolio.revision+1,updated_at=NOW()',[JSON.stringify(result.state)]);
      await client.query('COMMIT');this.lastPersistedAt=new Date().toISOString();return result;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async evidence(){
    const row=await this.read();
    const counts=this.pool?(await this.pool.query("SELECT (SELECT count(*) FROM shadow_journal) AS journal,(SELECT count(*) FROM shadow_audits) AS audits")).rows[0]:{journal:null,audits:null};
    return{backend:this.pool?'postgres':'file',revision:Number(row?.revision||0),persistedAt:row?.updated_at||null,stateHash:row?digest(row.state):null,ledgerHash:row?digest({createdAt:row.state.createdAt,cashUsd:row.state.cashUsd,positions:row.state.positions,trades:row.state.trades}):null,counts};
  }
  async history(kind,limit=50,offset=0){
    if(!this.pool)return[];
    const table=kind==='audit'?'shadow_audits':'shadow_journal';
    return(await this.pool.query(`SELECT payload FROM ${table} ORDER BY at DESC,id DESC LIMIT $1 OFFSET $2`,[limit,offset])).rows.map(x=>x.payload);
  }
}
module.exports=ShadowStore;

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function contentHash(state){
  const stable={...(state||{})};
  // updatedAt is a heartbeat, not business state. Ignoring it prevents a save() call
  // with no other change from rewriting the full JSONB row and generating WAL.
  delete stable.updatedAt;
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

class Storage {
  constructor({filePath, databaseUrl}){
    this.filePath = filePath;
    this.databaseUrl = databaseUrl || '';
    this.pool = null;
    this.writeQueue = Promise.resolve();
    this.lastPersistedHash = null;
  }

  async init(initialState, migrate){
    if(this.databaseUrl){
      let Pool;
      try { ({ Pool } = require('pg')); }
      catch { throw new Error('DATABASE_URL is set but dependency "pg" is not installed. Run npm install.'); }
      this.pool = new Pool({ connectionString: this.databaseUrl, ssl: this.databaseUrl.includes('localhost') ? false : { rejectUnauthorized:false } });
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS radar_state (
          id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const r = await this.pool.query('SELECT state FROM radar_state WHERE id=1');
      if(r.rows.length){
        const raw=r.rows[0].state;
        this.lastPersistedHash=contentHash(raw);
        await this._logFootprint();
        return migrate ? migrate(raw) : raw;
      }
      const state = clone(initialState);
      await this._writePostgres(state);
      this.lastPersistedHash=contentHash(state);
      await this._logFootprint();
      return state;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      return migrate ? migrate(raw) : raw;
    } catch {
      const state = clone(initialState);
      this._writeFile(state);
      return state;
    }
  }

  save(state){
    state.updatedAt = new Date().toISOString();
    const snapshot = clone(state);
    if(this.pool){
      const hash=contentHash(snapshot);
      this.writeQueue = this.writeQueue
        .catch(()=>{}).then(async()=>{
          if(hash===this.lastPersistedHash)return;
          await this._writePostgres(snapshot);
          this.lastPersistedHash=hash;
        });
      this.writeQueue.catch(err=>console.error('[storage] persist failed:',err.message));
    } else {
      this._writeFile(snapshot);
    }
  }

  async flush(){ await this.writeQueue; }

  async close(){
    await this.flush();
    if(this.pool) await this.pool.end();
  }

  _writeFile(state){
    fs.mkdirSync(path.dirname(this.filePath), { recursive:true });
    fs.writeFileSync(this.filePath, JSON.stringify(state,null,2));
  }

  async _writePostgres(state){
    await this.pool.query(
      `INSERT INTO radar_state (id,state,updated_at) VALUES (1,$1::jsonb,NOW())
       ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, updated_at=NOW()`,
      [JSON.stringify(state)]
    );
  }

  async _logFootprint(){
    if(!this.pool)return;
    try{
      const db=(await this.pool.query('SELECT pg_database_size(current_database())::bigint AS bytes')).rows[0]?.bytes??null;
      let wal=null;
      try{wal=(await this.pool.query('SELECT COALESCE(SUM(size),0)::bigint AS bytes FROM pg_ls_waldir()')).rows[0]?.bytes??null;}catch{}
      let top=[];
      try{
        top=(await this.pool.query(`SELECT relname,pg_total_relation_size(relid)::bigint AS bytes,n_live_tup,n_dead_tup
          FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`)).rows||[];
      }catch{}
      console.log(`[storage] footprint databaseBytes=${db??'unknown'} walBytes=${wal??'unavailable'} topRelations=${top.map(r=>`${r.relname}:${r.bytes}:live=${r.n_live_tup}:dead=${r.n_dead_tup}`).join(',')||'unavailable'}`);
    }catch(error){
      console.warn(`[storage] footprint unavailable: ${error.message}`);
    }
  }
}

Storage.contentHash=contentHash;
module.exports = Storage;

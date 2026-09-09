'use strict';
const fs = require('fs');
const path = require('path');

function clone(v){ return JSON.parse(JSON.stringify(v)); }

class Storage {
  constructor({filePath, databaseUrl}){
    this.filePath = filePath;
    this.databaseUrl = databaseUrl || '';
    this.pool = null;
    this.writeQueue = Promise.resolve();
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
        return migrate ? migrate(r.rows[0].state) : r.rows[0].state;
      }
      const state = clone(initialState);
      await this._writePostgres(state);
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
      this.writeQueue = this.writeQueue
        .catch(()=>{}).then(()=>this._writePostgres(snapshot));
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
}

module.exports = Storage;

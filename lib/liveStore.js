'use strict';

const fs=require('node:fs');
const path=require('node:path');

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const iso=()=>new Date().toISOString();

function defaultState(){
  return{
    version:1,architecture:'DEDICATED_SMART_ACCOUNT',ownerAddress:null,accountAddress:null,accountId:null,
    sessionPublicKey:null,pendingSession:null,pendingReclaim:null,permissionContext:null,sessionExpiresAt:null,
    state:'UNCONFIGURED',fundingTxHash:null,sessionTested:false,roundTripValidated:false,
    armed:false,killSwitch:false,lastError:null,lastTickAt:null,createdAt:iso(),updatedAt:iso()
  };
}

class LiveStore{
  constructor({pool,filePath}={}){
    this.pool=pool||null;
    this.filePath=filePath||path.join(__dirname,'../data/live-execution.json');
  }

  async init(){
    if(!this.pool){
      if(!fs.existsSync(this.filePath))this.writeFile({state:defaultState(),orders:[],positions:{}});
      return;
    }
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS live_execution_state(
        id SMALLINT PRIMARY KEY CHECK(id=1),
        state JSONB NOT NULL,
        revision BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS live_orders(
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        side TEXT NOT NULL,
        token_address TEXT NOT NULL,
        status TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(decision_id,side)
      );
      CREATE INDEX IF NOT EXISTS live_orders_time ON live_orders(at DESC);
      CREATE INDEX IF NOT EXISTS live_orders_status ON live_orders(status,updated_at DESC);
      CREATE TABLE IF NOT EXISTS live_positions(
        token_address TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query('INSERT INTO live_execution_state(id,state,revision) VALUES(1,$1::jsonb,0) ON CONFLICT DO NOTHING',[JSON.stringify(defaultState())]);
  }

  readFile(){
    try{return JSON.parse(fs.readFileSync(this.filePath,'utf8'));}
    catch(error){if(error.code==='ENOENT')return{state:defaultState(),orders:[],positions:{}};throw error;}
  }

  writeFile(value){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    const temp=`${this.filePath}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(value));
    fs.renameSync(temp,this.filePath);
  }

  async state(){
    if(!this.pool)return clone(this.readFile().state||defaultState());
    const result=await this.pool.query('SELECT state FROM live_execution_state WHERE id=1');
    return clone(result.rows[0]?.state||defaultState());
  }

  async transactState(fn){
    if(!this.pool){
      const all=this.readFile(),next=await fn(clone(all.state||defaultState()));
      next.updatedAt=iso();all.state=next;this.writeFile(all);return clone(next);
    }
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(4663,920)');
      const result=await client.query('SELECT state FROM live_execution_state WHERE id=1 FOR UPDATE');
      const next=await fn(clone(result.rows[0]?.state||defaultState()));
      next.updatedAt=iso();
      await client.query('UPDATE live_execution_state SET state=$1::jsonb,revision=revision+1,updated_at=NOW() WHERE id=1',[JSON.stringify(next)]);
      await client.query('COMMIT');
      return clone(next);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async patchState(patch){return this.transactState(state=>({...state,...clone(patch)}));}

  async createOrder(order){
    const row={...clone(order),at:order.at||iso(),updatedAt:iso()};
    if(!this.pool){
      const all=this.readFile();all.orders=all.orders||[];
      const existing=all.orders.find(x=>x.id===row.id||(x.decisionId===row.decisionId&&x.side===row.side));
      if(existing)return clone(existing);
      all.orders.unshift(row);all.orders=all.orders.slice(0,1000);this.writeFile(all);return clone(row);
    }
    const result=await this.pool.query(`INSERT INTO live_orders(id,decision_id,side,token_address,status,at,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING payload`,
      [row.id,row.decisionId,row.side,row.tokenAddress,row.status,row.at,JSON.stringify(row)]);
    if(result.rows[0])return result.rows[0].payload;
    return this.orderForDecision(row.decisionId,row.side);
  }

  async updateOrder(id,patch){
    if(!this.pool){
      const all=this.readFile(),index=(all.orders||[]).findIndex(x=>x.id===id);
      if(index<0)return null;
      all.orders[index]={...all.orders[index],...clone(patch),updatedAt:iso()};this.writeFile(all);return clone(all.orders[index]);
    }
    const current=await this.pool.query('SELECT payload FROM live_orders WHERE id=$1',[id]);
    if(!current.rows[0])return null;
    const next={...current.rows[0].payload,...clone(patch),updatedAt:iso()};
    await this.pool.query('UPDATE live_orders SET status=$2,payload=$3::jsonb,updated_at=NOW() WHERE id=$1',[id,next.status,JSON.stringify(next)]);
    return next;
  }

  async orderForDecision(decisionId,side){
    if(!this.pool)return clone((this.readFile().orders||[]).find(x=>x.decisionId===decisionId&&x.side===side)||null);
    const result=await this.pool.query('SELECT payload FROM live_orders WHERE decision_id=$1 AND side=$2',[decisionId,side]);
    return clone(result.rows[0]?.payload||null);
  }

  async recentOrders(limit=50){
    const safe=Math.max(1,Math.min(200,Number(limit)||50));
    if(!this.pool)return clone((this.readFile().orders||[]).slice(0,safe));
    return(await this.pool.query('SELECT payload FROM live_orders ORDER BY at DESC,id DESC LIMIT $1',[safe])).rows.map(row=>row.payload);
  }

  async pendingOrders(){
    const pending=new Set(['QUOTED','SUBMITTING','SUBMITTED']);
    return(await this.recentOrders(200)).filter(order=>pending.has(order.status));
  }

  async positions(){
    if(!this.pool)return clone(Object.values(this.readFile().positions||{}));
    return(await this.pool.query('SELECT payload FROM live_positions ORDER BY updated_at DESC')).rows.map(row=>row.payload);
  }

  async savePosition(position){
    const row={...clone(position),updatedAt:iso()};
    if(!this.pool){const all=this.readFile();all.positions=all.positions||{};all.positions[row.tokenAddress]=row;this.writeFile(all);return clone(row);}
    await this.pool.query(`INSERT INTO live_positions(token_address,payload) VALUES($1,$2::jsonb)
      ON CONFLICT(token_address) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[row.tokenAddress,JSON.stringify(row)]);
    return row;
  }

  async deletePosition(tokenAddress){
    if(!this.pool){const all=this.readFile();all.positions=all.positions||{};delete all.positions[tokenAddress];this.writeFile(all);return;}
    await this.pool.query('DELETE FROM live_positions WHERE token_address=$1',[tokenAddress]);
  }

  async realizedPnlSince(startIso){
    const orders=(await this.recentOrders(200)).filter(order=>order.side.endsWith('SELL')&&order.status==='CONFIRMED'&&Date.parse(order.confirmedAt||order.at)>=Date.parse(startIso));
    return orders.reduce((sum,order)=>sum+BigInt(order.pnlWei||0),0n);
  }
}

module.exports={LiveStore,defaultState};

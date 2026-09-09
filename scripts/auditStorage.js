'use strict';
const {Pool}=require('pg');
const url=process.env.DATABASE_URL||'';
if(!url){console.error('DATABASE_URL is required');process.exit(1);}
const pool=new Pool({connectionString:url,ssl:url.includes('localhost')?false:{rejectUnauthorized:false}});
const num=v=>v==null?null:Number(v);
const mb=v=>v==null?null:Number((Number(v)/1024/1024).toFixed(2));
(async()=>{
  try{
    const db=(await pool.query(`SELECT current_database() AS database,
      pg_database_size(current_database())::bigint AS database_bytes,
      current_setting('max_wal_size',true) AS max_wal_size,
      current_setting('min_wal_size',true) AS min_wal_size,
      current_setting('checkpoint_timeout',true) AS checkpoint_timeout`)).rows[0];
    let wal={wal_bytes:null,files:null};
    try{wal=(await pool.query(`SELECT COALESCE(SUM(size),0)::bigint AS wal_bytes,COUNT(*)::bigint AS files FROM pg_ls_waldir()`)).rows[0];}catch(error){wal.error=error.message;}
    const relations=(await pool.query(`SELECT relname,
      pg_relation_size(relid)::bigint AS heap_bytes,
      pg_indexes_size(relid)::bigint AS index_bytes,
      pg_total_relation_size(relid)::bigint AS total_bytes,
      n_live_tup,n_dead_tup,last_vacuum,last_autovacuum,last_analyze,last_autoanalyze
      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`)).rows;
    let kinds=[];
    try{kinds=(await pool.query(`SELECT kind,COUNT(*)::bigint AS rows,COALESCE(SUM(pg_column_size(payload)),0)::bigint AS payload_bytes
      FROM shadow_journal GROUP BY kind ORDER BY payload_bytes DESC`)).rows;}catch(error){kinds=[{kind:'__error__',rows:0,payload_bytes:0,error:error.message}];}
    console.log(JSON.stringify({
      database:db.database,databaseMB:mb(db.database_bytes),walMB:mb(wal.wal_bytes),walFiles:num(wal.files),walError:wal.error||null,
      settings:{maxWalSize:db.max_wal_size,minWalSize:db.min_wal_size,checkpointTimeout:db.checkpoint_timeout},
      relations:relations.map(r=>({name:r.relname,totalMB:mb(r.total_bytes),heapMB:mb(r.heap_bytes),indexMB:mb(r.index_bytes),liveRows:num(r.n_live_tup),deadRows:num(r.n_dead_tup),lastVacuum:r.last_vacuum,lastAutovacuum:r.last_autovacuum})),
      shadowKinds:Array.isArray(kinds)?kinds.map(r=>({kind:r.kind,rows:num(r.rows),payloadMB:mb(r.payload_bytes),error:r.error||null})):[]
    },null,2));
  }finally{await pool.end();}
})().catch(error=>{console.error(error.stack||error.message);process.exit(1);});

import pg from "pg";
const DDL=`CREATE TABLE IF NOT EXISTS music_facts (id text primary key, source text not null, external_id text not null, type text not null, occurred_at timestamptz not null, quantity bigint not null, amount_minor bigint not null, currency char(3) not null, artist text not null, release_title text not null, track text not null, channel text not null, territory text not null, metadata jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());CREATE INDEX IF NOT EXISTS music_facts_occurred_at ON music_facts(occurred_at);`;
export async function openStore(connectionString) {
 if(!connectionString)throw Error("DATABASE_URL required; production data is never silently stored in memory");
 const pool=new pg.Pool({connectionString,ssl:connectionString.includes("sslmode=require")?{rejectUnauthorized:true}:undefined,max:5});
 await pool.query(DDL);
 return {
  async upsert(facts){const client=await pool.connect();try{await client.query("BEGIN");for(const f of facts){await client.query(`INSERT INTO music_facts(id,source,external_id,type,occurred_at,quantity,amount_minor,currency,artist,release_title,track,channel,territory,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET type=EXCLUDED.type,occurred_at=EXCLUDED.occurred_at,quantity=EXCLUDED.quantity,amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,artist=EXCLUDED.artist,release_title=EXCLUDED.release_title,track=EXCLUDED.track,channel=EXCLUDED.channel,territory=EXCLUDED.territory,metadata=EXCLUDED.metadata,updated_at=now()`,[f.id,f.source,f.externalId,f.type,f.occurredAt,f.quantity,f.amountMinor,f.currency,f.artist,f.release,f.track,f.channel,f.territory,JSON.stringify(f.metadata)]);}await client.query("COMMIT");return facts.length;}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}},
  async list({from,to,limit=10000}={}){const q=await pool.query(`SELECT id,source,external_id AS "externalId",type,occurred_at AS "occurredAt",quantity::int,amount_minor::int AS "amountMinor",currency,artist,release_title AS release,track,channel,territory,metadata FROM music_facts WHERE ($1::timestamptz IS NULL OR occurred_at >= $1) AND ($2::timestamptz IS NULL OR occurred_at < $2) ORDER BY occurred_at DESC LIMIT $3`,[from||null,to||null,Math.min(Math.max(1,limit),10000)]);return q.rows.map(r=>({...r,occurredAt:new Date(r.occurredAt).toISOString()}))},
  async sources(){const r=await pool.query("SELECT source,COUNT(*)::int AS records,MAX(updated_at) AS last_ingested_at,MAX(occurred_at) AS latest_event_at FROM music_facts GROUP BY source ORDER BY source");return r.rows},
  async health(){await pool.query("SELECT 1");return true},
  async close(){await pool.end()}
 };
}

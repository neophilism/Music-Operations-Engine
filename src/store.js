import pg from 'pg';
import {migrate} from './migrations.js';
import {normalizeLabel,normalizeFamily,normalizeCatalog} from './catalog.js';
import {ApiError,requireThat} from './errors.js';
import {exact} from './validation.js';

const fields=`id,label_id AS "labelId",source,external_id AS "externalId",type,occurred_at AS "occurredAt",
quantity::text,amount_minor::text AS "amountMinor",currency,artist,release_title AS release,track,channel,territory,
artist_id AS "artistId",release_id AS "releaseId",track_id AS "trackId",metadata`;
const catalogFields=`id,label_id AS "labelId",kind,name,artist_id AS "artistId",release_id AS "releaseId",isrc,upc`;
function factRow(r) { return {...r,quantity:exact(r.quantity),amountMinor:exact(r.amountMinor),occurredAt:new Date(r.occurredAt).toISOString()}; }
async function audit(client,actor,action,labelIds,details={}) {
  await client.query('INSERT INTO music_audit(actor,action,label_ids,details) VALUES($1,$2,$3,$4)',[actor,action,labelIds,JSON.stringify(details)]);
}
export async function openStore(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL required');
  const pool=new pg.Pool({connectionString,max:5});
  try { return await createStore(pool); } catch(e) { await pool.end(); throw e; }
}
export async function createStore(pool) {
  await migrate(pool);
  async function transaction(work) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const result=await work(client);
      await client.query('COMMIT');
      return result;
    } catch(error) {
      await client.query('ROLLBACK');
      if (error.code === '23503') throw new ApiError(422,'Unknown label, family, or catalog reference');
      if (error.code === '23505') throw new ApiError(409,'Catalog identity or external mapping conflicts with an existing record');
      throw error;
    } finally { client.release(); }
  }
  async function insertFacts(client,facts) {
    const cache=new Map();
    async function item(labelId,id,kind) {
      const key=labelId+':'+id;
      if (!cache.has(key)) cache.set(key,(await client.query('SELECT '+catalogFields+' FROM music_catalog WHERE label_id=$1 AND id=$2',[labelId,id])).rows[0]);
      const found=cache.get(key);
      requireThat(found && found.kind === kind,'Unknown '+kind+' reference in the fact label');
      return found;
    }
    for (const f of facts) {
      if (f.artistId) await item(f.labelId,f.artistId,'artist');
      if (f.releaseId) {
        const release=await item(f.labelId,f.releaseId,'release');
        requireThat(!f.artistId || release.artistId === f.artistId,'Release artist attribution does not match');
      }
      if (f.trackId) {
        const track=await item(f.labelId,f.trackId,'track');
        requireThat((!f.releaseId || track.releaseId === f.releaseId) && (!f.artistId || track.artistId === f.artistId),'Track attribution does not match its catalog');
      }
      await client.query(`INSERT INTO music_facts(id,label_id,source,external_id,type,occurred_at,quantity,amount_minor,currency,artist,release_title,track,channel,territory,artist_id,release_id,track_id,metadata)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
ON CONFLICT(label_id,source,external_id) DO UPDATE SET type=EXCLUDED.type,occurred_at=EXCLUDED.occurred_at,
quantity=EXCLUDED.quantity,amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,artist=EXCLUDED.artist,
release_title=EXCLUDED.release_title,track=EXCLUDED.track,channel=EXCLUDED.channel,territory=EXCLUDED.territory,
artist_id=EXCLUDED.artist_id,release_id=EXCLUDED.release_id,track_id=EXCLUDED.track_id,metadata=EXCLUDED.metadata,updated_at=now()`,
[f.id,f.labelId,f.source,f.externalId,f.type,f.occurredAt,String(f.quantity),String(f.amountMinor),f.currency,f.artist,f.release,f.track,f.channel,f.territory,f.artistId,f.releaseId,f.trackId,JSON.stringify(f.metadata)]);
    }
  }
  return {
    async putFamily(raw,actor='system') {
      const f=normalizeFamily(raw);
      await transaction(async c=>{await c.query('INSERT INTO music_label_families(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',[f.id,f.name]);await audit(c,actor,'family.put',[],{id:f.id});});
      return f;
    },
    async putLabel(raw,actor='system') {
      const label=normalizeLabel(raw);
      await transaction(async c=>{
        await c.query('INSERT INTO music_labels(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',[label.id,label.name]);
        await c.query('DELETE FROM music_label_memberships WHERE label_id=$1',[label.id]);
        for (const family of label.familyIds) await c.query('INSERT INTO music_label_memberships(label_id,family_id) VALUES($1,$2)',[label.id,family]);
        await audit(c,actor,'label.put',[label.id]);
      });
      return label;
    },
    async scopes(labelIds) {
      const labels=(await pool.query(`SELECT l.id,l.name,COALESCE(array_agg(m.family_id ORDER BY m.family_id) FILTER(WHERE m.family_id IS NOT NULL),'{}') AS "familyIds"
FROM music_labels l LEFT JOIN music_label_memberships m ON l.id=m.label_id WHERE ($1::text[] IS NULL OR l.id=ANY($1))
GROUP BY l.id,l.name ORDER BY l.name,l.id`,[labelIds])).rows;
      const familyIds=[...new Set(labels.flatMap(l=>l.familyIds))];
      const families=(await pool.query('SELECT id,name FROM music_label_families WHERE id=ANY($1::text[]) ORDER BY name,id',[familyIds])).rows
        .map(f=>({...f,labelIds:labels.filter(l=>l.familyIds.includes(f.id)).map(l=>l.id)}));
      return {labels,families,all:{id:'all',name:'All accessible labels',labelIds:labels.map(l=>l.id)}};
    },
    async putCatalog(raw,actor='system') {
      const item=normalizeCatalog(raw);
      await transaction(async c=>{
        if (item.artistId) {
          const artist=(await c.query('SELECT kind FROM music_catalog WHERE label_id=$1 AND id=$2',[item.labelId,item.artistId])).rows[0];
          requireThat(artist?.kind === 'artist','artistId must reference an artist in the same label');
        }
        if (item.releaseId) {
          const release=(await c.query('SELECT kind,artist_id FROM music_catalog WHERE label_id=$1 AND id=$2',[item.labelId,item.releaseId])).rows[0];
          requireThat(release?.kind === 'release' && release.artist_id === item.artistId,'releaseId must reference this primary artist’s release in the same label');
        }
        const result=await c.query(`INSERT INTO music_catalog(label_id,id,kind,name,artist_id,release_id,isrc,upc) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT(label_id,id) DO UPDATE SET name=EXCLUDED.name,artist_id=EXCLUDED.artist_id,release_id=EXCLUDED.release_id,isrc=EXCLUDED.isrc,upc=EXCLUDED.upc
WHERE music_catalog.kind=EXCLUDED.kind RETURNING id`,[item.labelId,item.id,item.kind,item.name,item.artistId,item.releaseId,item.isrc,item.upc]);
        requireThat(result.rows.length,'Catalog identity cannot change kind',409);
        for (const m of item.externalIds) {
          const mapped=await c.query(`INSERT INTO music_external_ids(label_id,source,kind,external_id,catalog_id) VALUES($1,$2,$3,$4,$5)
ON CONFLICT(label_id,source,kind,external_id) DO UPDATE SET catalog_id=EXCLUDED.catalog_id
WHERE music_external_ids.catalog_id=EXCLUDED.catalog_id RETURNING catalog_id`,[item.labelId,m.source,item.kind,m.externalId,item.id]);
          requireThat(mapped.rows.length,'External identity is already mapped to another catalog item',409);
        }
        await audit(c,actor,'catalog.put',[item.labelId],{id:item.id,kind:item.kind});
      });
      return item;
    },
    async catalog({labelIds}) {
      return (await pool.query('SELECT '+catalogFields+' FROM music_catalog WHERE label_id=ANY($1::text[]) ORDER BY label_id,kind,name,id',[labelIds])).rows;
    },
    async resolveCatalog(labelId,source,kind,externalId) {
      const result=await pool.query(`SELECT ${catalogFields.split(',').map(x=>'c.'+x).join(',')} FROM music_catalog c
JOIN music_external_ids e ON e.label_id=c.label_id AND e.catalog_id=c.id
WHERE e.label_id=$1 AND e.source=$2 AND e.kind=$3 AND e.external_id=$4`,[labelId,source,kind,externalId]);
      return result.rows[0] || null;
    },
    async upsert(facts,actor='system') {
      await transaction(async c=>{await insertFacts(c,facts);await audit(c,actor,'facts.upsert',[...new Set(facts.map(f=>f.labelId))],{records:facts.length});});
      return facts.length;
    },
    async *iterate({labelIds,sources=null,from=null,to=null,batchSize=1000}) {
      requireThat(Array.isArray(labelIds),'Reporting requires an explicit label scope');
      const client=await pool.connect();
      let cursorTime=null,cursorId=null;
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        for (;;) {
          const result=await client.query(`SELECT ${fields} FROM music_facts WHERE label_id=ANY($1::text[])
AND ($2::text[] IS NULL OR source=ANY($2)) AND ($3::timestamptz IS NULL OR occurred_at >= $3)
AND ($4::timestamptz IS NULL OR occurred_at < $4)
AND ($5::timestamptz IS NULL OR (occurred_at,id) > ($5::timestamptz,$6::text))
ORDER BY occurred_at,id LIMIT $7`,[labelIds,sources,from,to,cursorTime,cursorId,batchSize]);
          for (const row of result.rows) yield factRow(row);
          if (result.rows.length < batchSize) break;
          const last=result.rows.at(-1);cursorTime=last.occurredAt;cursorId=last.id;
        }
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK');throw error; }
      finally { client.release(); }
    },
    async sources({labelIds,sources=null,from=null,to=null}) {
      const result=await pool.query(`SELECT source,COUNT(*)::text AS records,MAX(updated_at) AS "lastIngestedAt",MAX(occurred_at) AS "latestEventAt"
FROM music_facts WHERE label_id=ANY($1::text[]) AND ($2::text[] IS NULL OR source=ANY($2))
AND ($3::timestamptz IS NULL OR occurred_at >= $3) AND ($4::timestamptz IS NULL OR occurred_at < $4)
GROUP BY source ORDER BY source`,[labelIds,sources,from,to]);
      return result.rows.map(r=>({...r,records:exact(r.records),lastIngestedAt:new Date(r.lastIngestedAt).toISOString(),latestEventAt:new Date(r.latestEventAt).toISOString()}));
    },
    async audit({limit=100}={}) {
      return (await pool.query('SELECT id::text,actor,action,label_ids AS "labelIds",details,created_at AS "createdAt" FROM music_audit ORDER BY id DESC LIMIT $1',[limit])).rows;
    },
    transaction,insertFacts,
    async health() { await pool.query('SELECT 1');return true; },
    async close() { await pool.end(); }
  };
}


import pg from 'pg';
import {migrate} from './migrations.js';
import {normalizeLabel,normalizeFamily,normalizeCatalog} from './catalog.js';
import {ApiError,requireThat} from './errors.js';
import {exact} from './validation.js';
import {issueBearer,normalizeAccount,passwordDigest,passwordMatches,principalFromAccount,tokenDigest} from './accounts.js';
import {randomUUID} from 'node:crypto';
import {jobLeaseMs,normalizeJob,normalizeFailure} from './jobs.js';
import {decryptConnectorCredential,encryptConnectorCredential,normalizeBackfillCursor,normalizeConnector} from './connectors.js';

const fields=`id,label_id AS "labelId",source,external_id AS "externalId",type,occurred_at AS "occurredAt",
quantity::text,amount_minor::text AS "amountMinor",currency,artist,release_title AS release,track,channel,territory,
artist_id AS "artistId",release_id AS "releaseId",track_id AS "trackId",metadata`;
const catalogFields=`id,label_id AS "labelId",kind,name,artist_id AS "artistId",release_id AS "releaseId",isrc,upc`;
function factRow(r) { return {...r,quantity:exact(r.quantity),amountMinor:exact(r.amountMinor),occurredAt:new Date(r.occurredAt).toISOString()}; }
async function audit(client,actor,action,labelIds,details={}) {
  await client.query('INSERT INTO music_audit(actor,action,label_ids,details) VALUES($1,$2,$3,$4)',[actor,action,labelIds,JSON.stringify(details)]);
}
export async function openStore(connectionString,options={}) {
  if (!connectionString) throw new Error('DATABASE_URL required');
  const pool=new pg.Pool({connectionString,max:5});
  try { return await createStore(pool,options); } catch(e) { await pool.end(); throw e; }
}
export async function createStore(pool,{connectorKey}={}) {
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
      const key=JSON.stringify([labelId,id]);
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
    async putConnector(raw,actor='system') {
      const connector=normalizeConnector(raw);
      return transaction(async c=>{
        await c.query(`INSERT INTO music_connectors(label_id,source,display_name,adapter_version,capabilities,field_mapping,backfill_cursor)
VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT(label_id,source) DO UPDATE SET display_name=EXCLUDED.display_name,adapter_version=EXCLUDED.adapter_version,
capabilities=EXCLUDED.capabilities,field_mapping=EXCLUDED.field_mapping,backfill_cursor=EXCLUDED.backfill_cursor,updated_at=now()`,
          [connector.labelId,connector.source,connector.displayName,connector.adapterVersion,connector.capabilities,JSON.stringify(connector.fieldMapping),connector.backfillCursor]);
        let hasCredential=(await c.query('SELECT 1 FROM music_connector_credentials WHERE label_id=$1 AND source=$2',[connector.labelId,connector.source])).rows.length>0;
        if (Object.hasOwn(raw,'credential')) {
          const envelope=encryptConnectorCredential(raw.credential,connectorKey);
          await c.query(`INSERT INTO music_connector_credentials(label_id,source,ciphertext,iv,auth_tag,key_version)
VALUES($1,$2,$3,$4,$5,$6)
ON CONFLICT(label_id,source) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,
auth_tag=EXCLUDED.auth_tag,key_version=EXCLUDED.key_version,updated_at=now()`,
            [connector.labelId,connector.source,envelope.ciphertext,envelope.iv,envelope.authTag,envelope.keyVersion]);
          hasCredential=true;
        }
        await audit(c,actor,'connector.put',[connector.labelId],{source:connector.source,adapterVersion:connector.adapterVersion,hasCredential});
        return {...connector,hasCredential};
      });
    },
    async connectors({labelIds}) {
      requireThat(Array.isArray(labelIds) && labelIds.length>0,'Connector listing requires an explicit label scope');
      return (await pool.query(`SELECT c.label_id AS "labelId",c.source,c.display_name AS "displayName",
c.adapter_version AS "adapterVersion",c.capabilities,c.field_mapping AS "fieldMapping",
c.backfill_cursor AS "backfillCursor",c.updated_at AS "updatedAt",
EXISTS(SELECT 1 FROM music_connector_credentials k WHERE k.label_id=c.label_id AND k.source=c.source) AS "hasCredential"
FROM music_connectors c WHERE c.label_id=ANY($1::text[]) ORDER BY c.source,c.label_id`,[labelIds])).rows;
    },
    async connectorCredential(labelId,source,actor='system') {
      const normalized=normalizeConnector({labelId,source,displayName:source,adapterVersion:'read',capabilities:['poll'],fieldMapping:{}});      
      return transaction(async c=>{
        const result=await c.query(`SELECT ciphertext,iv,auth_tag AS "authTag" FROM music_connector_credentials
WHERE label_id=$1 AND source=$2`,[normalized.labelId,normalized.source]);
        requireThat(result.rows.length,'Connector credential not found',404);
        const secret=decryptConnectorCredential(result.rows[0],connectorKey);
        await audit(c,actor,'connector.credential.read',[normalized.labelId],{source:normalized.source});
        return secret;
      });
    },
    async updateConnectorCursor(labelId,source,value,actor='system') {
      const backfillCursor=normalizeBackfillCursor(value);
      return transaction(async c=>{
        const result=await c.query(`UPDATE music_connectors SET backfill_cursor=$3,updated_at=now()
WHERE label_id=$1 AND source=$2 RETURNING label_id AS "labelId",source,backfill_cursor AS "backfillCursor"`,
          [labelId,source,backfillCursor]);
        requireThat(result.rows.length,'Connector not found',404);
        await audit(c,actor,'connector.cursor.updated',[labelId],{source,backfillCursor});
        return result.rows[0];
      });
    },
    async enqueueJob(raw,actor='system',now=new Date()) {
      const job=normalizeJob(raw,now);
      await transaction(async c=>{
        await c.query(`INSERT INTO music_jobs(id,kind,source,label_id,payload,status,max_attempts,available_at,created_at,updated_at)
VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8,$8)`,[job.id,job.kind,job.source,job.labelId,JSON.stringify(job.payload),job.maxAttempts,job.availableAt,now]);
        await audit(c,actor,'job.enqueued',[job.labelId],{jobId:job.id,kind:job.kind,source:job.source});
      });
      return {...job,status:'queued',attempts:0};
    },
    async claimJobs({source,labelIds=null,limit=10,workerId,now=new Date()}) {
      requireThat(Number.isInteger(limit) && limit>=1 && limit<=100,'limit must be 1–100',400);
      requireThat(typeof workerId==='string' && workerId.length>0,'workerId is required',400);
      return transaction(async c=>{
        const staleBefore=new Date(now.getTime()-jobLeaseMs);
        await c.query(`UPDATE music_jobs SET
status=CASE WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'retry' END,
available_at=$1,locked_by=NULL,locked_at=NULL,last_error_code='lease_expired',updated_at=$1
WHERE status='running' AND locked_at<$2 AND source=$3 AND ($4::text[] IS NULL OR label_id=ANY($4))`,[now,staleBefore,source,labelIds]);
        const result=await c.query(`WITH candidates AS (
  SELECT id FROM music_jobs WHERE status IN ('queued','retry') AND available_at<=$1
    AND source=$2 AND ($3::text[] IS NULL OR label_id=ANY($3))
  ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $4
)
UPDATE music_jobs j SET status='running',attempts=j.attempts+1,locked_by=$5,locked_at=$1,updated_at=$1
FROM candidates c WHERE j.id=c.id
RETURNING j.id,j.kind,j.source,j.label_id AS "labelId",j.payload,j.status,j.attempts,j.max_attempts AS "maxAttempts",j.available_at AS "availableAt",j.locked_at AS "lockedAt"`,[now,source,labelIds,limit,workerId]);
        return result.rows;
      });
    },
    async completeJob(jobId,workerId,now=new Date()) {
      return transaction(async c=>{
        const result=await c.query(`UPDATE music_jobs SET status='succeeded',locked_by=NULL,locked_at=NULL,completed_at=$3,updated_at=$3
WHERE id=$1 AND locked_by=$2 AND status='running' RETURNING label_id AS "labelId",source`,[jobId,workerId,now]);
        requireThat(result.rows.length,'Running job lease not found',409);
        const job=result.rows[0];await audit(c,workerId,'job.succeeded',[job.labelId],{jobId,source:job.source});
        return {id:jobId,status:'succeeded'};
      });
    },
    async failJob(jobId,workerId,raw,now=new Date()) {
      const failure=normalizeFailure(raw,now);
      return transaction(async c=>{
        const result=await c.query('SELECT label_id AS "labelId",source,attempts,max_attempts AS "maxAttempts" FROM music_jobs WHERE id=$1 AND locked_by=$2 AND status=\'running\' FOR UPDATE',[jobId,workerId]);
        requireThat(result.rows.length,'Running job lease not found',409);
        const job=result.rows[0],status=job.attempts>=job.maxAttempts ? 'dead_letter' : 'retry';
        await c.query(`UPDATE music_jobs SET status=$3,available_at=$4,locked_by=NULL,locked_at=NULL,last_error_code=$5,updated_at=$6
WHERE id=$1 AND locked_by=$2 AND status='running'`,[jobId,workerId,status,failure.retryAt,failure.errorCode,now]);
        await audit(c,workerId,status==='dead_letter' ? 'job.dead_lettered' : 'job.retry_scheduled',[job.labelId],{jobId,source:job.source,errorCode:failure.errorCode,attempts:job.attempts});
        return {id:jobId,status,attempts:job.attempts,maxAttempts:job.maxAttempts,availableAt:failure.retryAt};
      });
    },
    async jobs({labelIds=null,source=null,limit=100}={}) {
      requireThat(Number.isInteger(limit) && limit>=1 && limit<=1000,'limit must be 1–1000',400);
      const result=await pool.query(`SELECT id,kind,source,label_id AS "labelId",status,attempts,max_attempts AS "maxAttempts",
available_at AS "availableAt",locked_at AS "lockedAt",last_error_code AS "lastErrorCode",created_at AS "createdAt",updated_at AS "updatedAt",completed_at AS "completedAt"
FROM music_jobs WHERE ($1::text[] IS NULL OR label_id=ANY($1)) AND ($2::text IS NULL OR source=$2)
ORDER BY created_at DESC,id DESC LIMIT $3`,[labelIds,source,limit]);
      return result.rows;
    },
    async sourceHealth({labelIds,sources=null}) {
      const result=await pool.query(`SELECT source,
COUNT(*) FILTER(WHERE status IN ('queued','retry'))::integer AS "backlog",
COUNT(*) FILTER(WHERE status='running')::integer AS "running",
COUNT(*) FILTER(WHERE status='dead_letter')::integer AS "deadLetter",
MAX(updated_at) AS "lastJobAt",MAX(completed_at) AS "lastSucceededAt"
FROM music_jobs WHERE label_id=ANY($1::text[]) AND ($2::text[] IS NULL OR source=ANY($2))
GROUP BY source ORDER BY source`,[labelIds,sources]);
      return result.rows;
    },
    async putAccount(raw,actor='system') {
      const account=normalizeAccount(raw),digest=await passwordDigest(account.password),id=randomUUID();
      try {
        await transaction(async c=>{
          if (!account.labelIds.includes('*')) {
            const labels=await c.query('SELECT id FROM music_labels WHERE id=ANY($1::text[])',[account.labelIds]);
            requireThat(labels.rows.length===account.labelIds.length,'Account label scope contains an unknown label',422);
          }
          await c.query(`INSERT INTO music_accounts(id,email,password_salt,password_hash,role,label_ids)
VALUES($1,$2,$3,$4,$5,$6)`,[id,account.email,digest.salt,digest.hash,account.role,account.labelIds]);
          await audit(c,actor,'account.created',account.labelIds,{accountId:id,role:account.role});
        });
      } catch(error) {
        if (error instanceof ApiError && error.status===409) throw new ApiError(409,'Account already exists');
        throw error;
      }
      return {id,email:account.email,role:account.role,labelIds:account.labelIds,permissions:account.permissions};
    },
    async issueSession(email,password,{now=new Date(),lifetimeMs}={}) {
      const normalized=String(email || '').trim().toLowerCase();
      const result=await pool.query(`SELECT id,email,password_salt AS "passwordSalt",password_hash AS "passwordHash",role,label_ids AS "labelIds"
FROM music_accounts WHERE email=$1 AND disabled_at IS NULL`,[normalized]);
      const account=result.rows[0];
      const passwordValid=await passwordMatches(
        typeof password==='string' ? password : '',
        account?.passwordSalt || '0'.repeat(32),
        account?.passwordHash || '0'.repeat(128)
      );
      if (!account || !passwordValid) {
        throw new ApiError(401,'Unauthorized');
      }
      const session=issueBearer(now,lifetimeMs);
      await transaction(async c=>{
        const active=await c.query('SELECT 1 FROM music_accounts WHERE id=$1 AND disabled_at IS NULL FOR SHARE',[account.id]);
        requireThat(active.rows.length,'Unauthorized',401);
        await c.query(`INSERT INTO music_account_sessions(id,account_id,token_hash,created_at,expires_at,last_seen_at)
VALUES($1,$2,$3,$4,$5,$4)`,[session.id,account.id,session.tokenHash,session.createdAt,session.expiresAt]);
        await audit(c,account.id,'session.issued',account.labelIds,{sessionId:session.id,expiresAt:session.expiresAt.toISOString()});
      });
      return {token:session.token,expiresAt:session.expiresAt.toISOString(),principal:principalFromAccount(account,session.id)};
    },
    async authenticateSession(token,now=new Date()) {
      if (typeof token!=='string' || token.length!==43) return null;
      const result=await pool.query(`SELECT a.id,a.role,a.label_ids AS "labelIds",s.id AS "sessionId"
FROM music_account_sessions s JOIN music_accounts a ON a.id=s.account_id
WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2 AND a.disabled_at IS NULL`,[tokenDigest(token),now]);
      const row=result.rows[0];
      if (!row) return null;
      await pool.query('UPDATE music_account_sessions SET last_seen_at=$2 WHERE id=$1',[row.sessionId,now]);
      return principalFromAccount(row,row.sessionId);
    },
    async revokeSession(sessionId,actor) {
      return transaction(async c=>{
        const result=await c.query('UPDATE music_account_sessions SET revoked_at=now() WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL RETURNING id',[sessionId,actor]);
        requireThat(result.rows.length,'Session not found',404);
        await audit(c,actor,'session.revoked',[],{sessionId});
        return true;
      });
    },
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
WHERE music_catalog.kind=EXCLUDED.kind AND music_catalog.artist_id IS NOT DISTINCT FROM EXCLUDED.artist_id
AND music_catalog.release_id IS NOT DISTINCT FROM EXCLUDED.release_id RETURNING id`,[item.labelId,item.id,item.kind,item.name,item.artistId,item.releaseId,item.isrc,item.upc]);
        requireThat(result.rows.length,'Catalog kind and parent identity cannot change',409);
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
    async catalogItem(labelId,id) {
      return (await pool.query('SELECT '+catalogFields+' FROM music_catalog WHERE label_id=$1 AND id=$2',[labelId,id])).rows[0] || null;
    },
    async ingestDelivery(batch,contentHash,actor) {
      return transaction(async client=>{
        const {labelId,platform,deliveryId}=batch;
        const reservation=await client.query(`INSERT INTO music_deliveries(label_id,platform,delivery_id,content_hash) VALUES($1,$2,$3,$4)
ON CONFLICT DO NOTHING RETURNING delivery_id`,[labelId,platform,deliveryId,contentHash]);
        if (!reservation.rows.length) {
          const previous=(await client.query('SELECT content_hash FROM music_deliveries WHERE label_id=$1 AND platform=$2 AND delivery_id=$3',[labelId,platform,deliveryId])).rows[0];
          requireThat(previous?.content_hash === contentHash,'Delivery id was reused with different content',409);
          return {accepted:0,duplicates:batch.events.length,duplicateDelivery:true};
        }
        const fresh=[];
        for (const event of batch.events) {
          const saved=await client.query(`INSERT INTO music_platform_events(label_id,platform,external_id,content_hash) VALUES($1,$2,$3,$4)
ON CONFLICT DO NOTHING RETURNING external_id`,[labelId,platform,event.id,event.contentHash]);
          if (!saved.rows.length) {
            const previous=(await client.query('SELECT content_hash FROM music_platform_events WHERE label_id=$1 AND platform=$2 AND external_id=$3',[labelId,platform,event.id])).rows[0];
            requireThat(previous?.content_hash === event.contentHash,'Platform event id was reused with different content',409);
            continue;
          }
          const fact=event.fact;
          if (fact.metadata.logicalActivityId) {
            const metrics=fact.metadata.scene || (fact.metadata.trackzero ? {...fact.metadata.trackzero,trackId:fact.trackId} : {});
            const shared=await client.query(`INSERT INTO music_shared_measurements(source,activity_id,type,quantity,metrics) VALUES($1,$2,$3,$4,$5)
ON CONFLICT(source,activity_id) DO UPDATE SET type=EXCLUDED.type
WHERE music_shared_measurements.type=EXCLUDED.type AND music_shared_measurements.quantity=EXCLUDED.quantity AND music_shared_measurements.metrics=EXCLUDED.metrics RETURNING activity_id`,
              [platform,fact.metadata.logicalActivityId,fact.type,String(fact.quantity),JSON.stringify(metrics)]);
            requireThat(shared.rows.length,'Shared physical report has conflicting measurements',409);
          }
          fresh.push(fact);
        }
        await insertFacts(client,fresh);
        await client.query('UPDATE music_deliveries SET accepted=$4 WHERE label_id=$1 AND platform=$2 AND delivery_id=$3',[labelId,platform,deliveryId,fresh.length]);
        await audit(client,actor,'delivery.accepted',[labelId],{platform,deliveryId,accepted:fresh.length});
        return {accepted:fresh.length,duplicates:batch.events.length-fresh.length,duplicateDelivery:false};
      });
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

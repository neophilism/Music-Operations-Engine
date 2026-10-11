import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,labels,serve,secrets} from './helpers.js';

test('durable jobs retry with a bound and expose scoped source health',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  const first=new Date('2026-10-11T01:00:00Z');
  const job=await f.store.enqueueJob({kind:'ingest',source:'trackzero',labelId:'alpha',payload:{deliveryId:'one'},maxAttempts:2},'admin',first);
  assert.equal(job.status,'queued');

  const claimed=await f.store.claimJobs({source:'trackzero',labelIds:['alpha'],workerId:'worker',now:first});
  assert.equal(claimed.length,1);assert.equal(claimed[0].attempts,1);assert.deepEqual(claimed[0].payload,{deliveryId:'one'});
  assert.deepEqual(await f.store.claimJobs({source:'trackzero',labelIds:['beta'],workerId:'other',now:first}),[]);

  const retryAt='2026-10-11T01:02:00.000Z';
  const retry=await f.store.failJob(job.id,'worker',{errorCode:'provider_timeout',retryAt},new Date('2026-10-11T01:01:00Z'));
  assert.equal(retry.status,'retry');
  assert.deepEqual(await f.store.claimJobs({source:'trackzero',labelIds:['alpha'],workerId:'worker',now:new Date('2026-10-11T01:01:59Z')}),[]);
  const second=await f.store.claimJobs({source:'trackzero',labelIds:['alpha'],workerId:'worker',now:new Date(retryAt)});
  assert.equal(second[0].attempts,2);
  const dead=await f.store.failJob(job.id,'worker',{errorCode:'invalid_payload'},new Date('2026-10-11T01:02:01Z'));
  assert.equal(dead.status,'dead_letter');

  const health=await f.store.sourceHealth({labelIds:['alpha']});
  assert.equal(health[0].source,'trackzero');assert.equal(health[0].deadLetter,1);
  const records=await f.store.audit();
  assert.ok(records.some(record=>record.action==='job.dead_lettered' && record.details.jobId===job.id));
});

test('expired leases recover and successful work records completion',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  const start=new Date('2026-10-11T02:00:00Z');
  const job=await f.store.enqueueJob({kind:'resync',source:'manual',labelId:'alpha',maxAttempts:2},'admin',start);
  await f.store.claimJobs({source:'manual',labelIds:['alpha'],workerId:'stalled',now:start});
  const recovered=await f.store.claimJobs({source:'manual',labelIds:['alpha'],workerId:'replacement',now:new Date('2026-10-11T02:05:01Z')});
  assert.equal(recovered[0].id,job.id);assert.equal(recovered[0].attempts,2);
  assert.deepEqual(await f.store.completeJob(job.id,'replacement',new Date('2026-10-11T02:06:00Z')),{id:job.id,status:'succeeded'});
  const listed=await f.store.jobs({labelIds:['alpha'],source:'manual'});
  assert.equal(listed[0].status,'succeeded');assert.ok(listed[0].completedAt);
});

test('job HTTP routes enforce label and source scope',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  const api=await serve(f.store);t.after(()=>api.close());
  assert.equal((await api.request('/v1/jobs',{key:secrets.alpha,body:{kind:'ingest',source:'manual',labelId:'beta'}})).status,403);
  assert.equal((await api.request('/v1/jobs',{key:secrets.track,body:{kind:'ingest',source:'scenesignal',labelId:'alpha'}})).status,403);
  const queued=await api.request('/v1/jobs',{key:secrets.track,body:{kind:'ingest',source:'trackzero',labelId:'alpha',payload:{cursor:'next'}}});
  assert.equal(queued.status,202);
  const claim=await api.request('/v1/jobs/claim',{key:secrets.track,body:{source:'trackzero',limit:1}});
  assert.equal(claim.status,200);assert.equal(claim.body.jobs[0].id,queued.body.job.id);
  assert.equal((await api.request('/v1/jobs/'+queued.body.job.id+'/complete',{key:secrets.alpha,body:{}})).status,409);
  assert.equal((await api.request('/v1/jobs/'+queued.body.job.id+'/complete',{key:secrets.track,body:{}})).status,200);
  const health=await api.request('/v1/source-health?labelId=alpha&source=trackzero',{key:secrets.reader});
  assert.equal(health.status,200);assert.equal(health.body.sources[0].lastSucceededAt!==null,true);
  assert.equal((await api.request('/v1/jobs?labelId=hidden',{key:secrets.reader})).status,403);
});

test('invalid retry schedules and payload limits fail closed',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await assert.rejects(f.store.enqueueJob({kind:'ingest',source:'manual',labelId:'alpha',payload:{value:'x'.repeat(65537)}}),error=>error.status===413);
  const now=new Date('2026-10-11T03:00:00Z');
  const job=await f.store.enqueueJob({kind:'ingest',source:'manual',labelId:'alpha'},'admin',now);
  await f.store.claimJobs({source:'manual',labelIds:['alpha'],workerId:'worker',now});
  await assert.rejects(f.store.failJob(job.id,'worker',{errorCode:'timeout',retryAt:'2026-10-12T03:00:01Z'},now),error=>error.status===400);
});

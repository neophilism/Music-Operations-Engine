import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFact,summarize} from '../src/core.js';
import {loadCredentials} from '../src/auth.js';
import {timestamp} from '../src/validation.js';
import {fixture,labels,catalog,serve,secrets} from './helpers.js';

const fact=(labelId,externalId,more={})=>normalizeFact({labelId,externalId,type:'stream',date:'2026-10-09',artist:'Artist',release:'Same Album',...more},'manual');
test('Label identity, release identity, exact totals, and dates',()=>{
  const a=fact('alpha','same',{quantity:'9007199254740993'}),b=fact('beta','same');
  assert.notEqual(a.id,b.id);
  const result=summarize([a,b]);
  assert.equal(result.counts.streams,'9007199254740994');
  assert.equal(Object.keys(result.byRelease).length,2);
  assert.equal(result.byLabel.alpha.counts.streams,'9007199254740993');
  assert.equal(timestamp('2026-10-09T23:00:00-04:00'),'2026-10-10T03:00:00.000Z');
  assert.throws(()=>timestamp('2026-02-30'));
  assert.throws(()=>loadCredentials({ENGINE_API_KEY:'short'}));
});
test('Postgres label menus, access isolation, period filters, and source restrictions',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.upsert([fact('alpha','a'),fact('beta','b'),fact('hidden','h')]);
  const api=await serve(f.store);t.after(()=>api.close());
  const menu=await api.request('/v1/scopes',{key:secrets.alpha});
  assert.equal(menu.status,200);assert.deepEqual(menu.body.labels.map(l=>l.id),['alpha']);
  assert.deepEqual(menu.body.families.find(g=>g.id==='family').labelIds,['alpha']);
  const family=await api.request('/v1/summary?familyId=family',{key:secrets.reader});
  assert.equal(family.body.counts.streams,2);assert.equal(family.body.factCount,2);
  assert.deepEqual(family.body.scope.labelIds,['alpha','beta']);
  for(const path of ['/v1/summary?labelId=hidden','/v1/sources?labelId=hidden','/v1/catalog?labelId=hidden']) assert.equal((await api.request(path,{key:secrets.reader})).status,403);
  assert.equal((await api.request('/v1/summary?source=manual',{key:secrets.track})).status,403);
  assert.equal((await api.request('/v1/summary?labelId=alpha&labelId=beta')).status,400);
  assert.equal((await api.request('/v1/summary?labelId=alpha&familyId=family')).status,400);
  const empty=await api.request('/v1/summary?from=2026-10-10',{key:secrets.reader});assert.equal(empty.body.factCount,0);
  assert.equal((await api.request('/v1/sources',{key:secrets.alpha})).body.sources[0].records,1);
  assert.equal((await api.request('/v1/summary',{key:'wrong'})).status,401);
  assert.equal((await api.request('/v1/ingest',{key:secrets.reader,body:{source:'manual',facts:[]}})).status,403);
  const denied=await api.request('/v1/ingest',{key:secrets.alpha,body:{source:'manual',facts:[{labelId:'alpha',externalId:'new-a',type:'stream',date:'2026-10-09'},{labelId:'hidden',externalId:'new-h',type:'stream',date:'2026-10-09'}]}});
  assert.equal(denied.status,403);assert.equal((await api.request('/v1/summary?labelId=alpha')).body.factCount,1);
  assert.equal((await api.request('/v1/labels',{key:secrets.alpha,body:{id:'extra',name:'Extra'}})).status,403);
});
test('Catalog mappings stay label-scoped and reject conflicting identity atomically',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);await catalog(f.store);await catalog(f.store,'beta');
  assert.equal((await f.store.resolveCatalog('alpha','trackzero','track','tz-track')).labelId,'alpha');
  assert.equal((await f.store.resolveCatalog('beta','trackzero','track','tz-track')).labelId,'beta');
  await assert.rejects(f.store.putCatalog({labelId:'alpha',id:'wrong',kind:'track',name:'Wrong',artistId:'missing',releaseId:'album'}));
  await assert.rejects(f.store.putCatalog({labelId:'alpha',id:'other',kind:'release',name:'Other',artistId:'artist',externalIds:[{source:'trackzero',externalId:'tz-album'}]}),e=>e.status===409);
  assert.equal((await f.store.catalog({labelIds:['alpha']})).length,3);
  await assert.rejects(f.store.upsert([fact('alpha','bad',{trackId:'track',artistId:'wrong'})]));
  const records=await f.store.audit();assert.ok(records.some(r=>r.action==='catalog.put'));
});
test('Reports exceed the former 10k ceiling without bigint truncation',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.pool.query(`INSERT INTO music_facts(id,label_id,source,external_id,type,occurred_at,quantity,amount_minor,currency,artist,release_title,track,channel,territory)
SELECT 'test-'||n,'alpha','manual','test-'||n,'stream','2026-10-09',2147483648,0,'USD','Artist','Album','Track','','' FROM generate_series(1,10001) n`);
  const api=await serve(f.store);t.after(()=>api.close());
  const result=await api.request('/v1/summary?labelId=alpha');
  assert.equal(result.status,200);assert.equal(result.body.factCount,10001);assert.equal(result.body.partial,false);
  assert.equal(result.body.counts.streams,10001*2147483648);
});
test('Legacy rows migrate to an explicit unassigned label and reimports do not double count',async t=>{
  const f=await fixture(async p=>{
    await p.query(`CREATE TABLE music_facts (id text PRIMARY KEY,source text NOT NULL,external_id text NOT NULL,type text NOT NULL,occurred_at timestamptz NOT NULL,quantity bigint NOT NULL,amount_minor bigint NOT NULL,currency char(3) NOT NULL,artist text NOT NULL,release_title text NOT NULL,track text NOT NULL,channel text NOT NULL,territory text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO music_facts VALUES ('old-hash','manual','old','sale','2026-10-09',1,500,'USD','Artist','Album','','','','{}',now());`);
  });t.after(()=>f.close());
  await f.store.upsert([normalizeFact({type:'sale',externalId:'old',date:'2026-10-09',amountMinor:600})]);
  const rows=[];for await(const r of f.store.iterate({labelIds:['default']})) rows.push(r);
  assert.equal(rows.length,1);assert.equal(rows[0].id,'old-hash');assert.equal(rows[0].amountMinor,600);
});

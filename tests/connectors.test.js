import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {fixture,labels} from './helpers.js';
import {decryptConnectorCredential,encryptConnectorCredential,normalizeConnector} from '../src/connectors.js';

const key=randomBytes(32).toString('base64');
const otherKey=randomBytes(32).toString('base64');
const manifest={
  labelId:'alpha',
  source:'example-provider',
  displayName:'Example provider',
  adapterVersion:'v1',
  capabilities:['poll','incremental_backfill','poll'],
  fieldMapping:{reported_at:'occurredAt',recording_isrc:'isrc'},
  backfillCursor:'page-10'
};

test('connector manifests normalize deterministic mappings and reject unsupported contracts',()=>{
  assert.deepEqual(normalizeConnector(manifest).capabilities,['incremental_backfill','poll']);
  assert.deepEqual(Object.keys(normalizeConnector(manifest).fieldMapping),['recording_isrc','reported_at']);
  assert.throws(()=>normalizeConnector({...manifest,capabilities:['shell']}));
  assert.throws(()=>normalizeConnector({...manifest,fieldMapping:{'bad field':'isrc'}}));
  assert.throws(()=>normalizeConnector({...manifest,backfillCursor:'x'.repeat(513)}));
});

test('credential envelopes authenticate ciphertext and never decrypt under another key',()=>{
  const envelope=encryptConnectorCredential('provider-secret',key);
  assert.equal(decryptConnectorCredential(envelope,key),'provider-secret');
  assert.notEqual(envelope.ciphertext,'provider-secret');
  assert.throws(()=>decryptConnectorCredential(envelope,otherKey));
  assert.throws(()=>encryptConnectorCredential('provider-secret','not-a-key'));
});

test('store persists scoped manifests, encrypted credentials and resumable backfill state',async t=>{
  const f=await fixture(undefined,{connectorKey:key});t.after(()=>f.close());await labels(f.store);
  const saved=await f.store.putConnector({...manifest,credential:'provider-secret'},'admin');
  assert.equal(saved.hasCredential,true);
  assert.equal('credential' in saved,false);
  assert.deepEqual(saved.capabilities,['incremental_backfill','poll']);

  const visible=await f.store.connectors({labelIds:['alpha']});
  assert.equal(visible.length,1);
  assert.equal(visible[0].backfillCursor,'page-10');
  assert.equal('ciphertext' in visible[0],false);
  assert.deepEqual(await f.store.connectors({labelIds:['beta']}),[]);

  const raw=(await f.pool.query('SELECT ciphertext,iv,auth_tag AS "authTag" FROM music_connector_credentials')).rows[0];
  assert.ok(raw.ciphertext.length>0);
  assert.equal(JSON.stringify(raw).includes('provider-secret'),false);
  assert.equal(await f.store.connectorCredential('alpha','example-provider','worker-1'),'provider-secret');

  await f.store.updateConnectorCursor('alpha','example-provider','page-11','worker-1');
  assert.equal((await f.store.connectors({labelIds:['alpha']}))[0].backfillCursor,'page-11');

  await f.store.putConnector({...manifest,displayName:'Renamed',backfillCursor:'page-11'},'admin');
  const updated=(await f.store.connectors({labelIds:['alpha']}))[0];
  assert.equal(updated.displayName,'Renamed');
  assert.equal(updated.hasCredential,true);
  assert.equal(await f.store.connectorCredential('alpha','example-provider','worker-2'),'provider-secret');

  const actions=(await f.store.audit()).map(entry=>entry.action);
  assert.ok(actions.includes('connector.put'));
  assert.ok(actions.includes('connector.credential.read'));
  assert.ok(actions.includes('connector.cursor.updated'));
});

test('connector storage rejects unknown labels and missing deployment keys',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await assert.rejects(()=>f.store.putConnector({...manifest,labelId:'missing'}));
  await assert.rejects(()=>f.store.putConnector({...manifest,credential:'secret'},'admin'),/CONNECTOR_MASTER_KEY/);
  await f.store.putConnector(manifest,'admin');
  const envelope=encryptConnectorCredential('stored-secret',key);
  await f.pool.query(`INSERT INTO music_connector_credentials(label_id,source,ciphertext,iv,auth_tag,key_version)
VALUES($1,$2,$3,$4,$5,$6)`,['alpha','example-provider',envelope.ciphertext,envelope.iv,envelope.authTag,envelope.keyVersion]);
  await assert.rejects(()=>f.store.connectorCredential('alpha','example-provider','worker'),/CONNECTOR_MASTER_KEY/);
});

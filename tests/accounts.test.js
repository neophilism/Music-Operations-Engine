import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,labels,serve,secrets} from './helpers.js';

const password='correct horse battery staple';

test('administrator provisions a scoped interactive account without returning password material',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  const api=await serve(f.store);t.after(()=>api.close());
  const created=await api.request('/v1/accounts',{key:secrets.admin,body:{
    email:' Operator@Example.com ',password,role:'label_manager',labelIds:['alpha']
  }});
  assert.equal(created.status,201);
  assert.deepEqual(created.body.account.permissions,['read','ingest']);
  assert.equal(created.body.account.email,'operator@example.com');
  assert.equal(JSON.stringify(created.body).includes('password'),false);

  const login=await api.request('/v1/auth/token',{key:'',body:{email:'operator@example.com',password}});
  assert.equal(login.status,200);assert.equal(login.body.tokenType,'Bearer');
  assert.equal(typeof login.body.token,'string');assert.equal(login.body.token.length,43);
  const allowed=await api.request('/v1/scopes',{key:login.body.token});
  assert.equal(allowed.status,200);assert.deepEqual(allowed.body.labels.map(x=>x.id),['alpha']);
  assert.equal((await api.request('/v1/summary?labelId=hidden',{key:login.body.token})).status,403);

  assert.equal((await api.request('/v1/auth/revoke',{key:login.body.token,body:{}})).status,200);
  assert.equal((await api.request('/v1/scopes',{key:login.body.token})).status,401);
});

test('role policy, password checks, expiry and audit fail closed',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await assert.rejects(
    f.store.putAccount({email:'bad@example.com',password,role:'team_member',labelIds:['hidden-label']}),
    error=>error.status===422
  );
  await assert.rejects(
    f.store.putAccount({email:'admin@example.com',password,role:'tenant_admin',labelIds:['alpha']}),
    error=>error.status===400
  );
  const account=await f.store.putAccount({email:'artist@example.com',password,role:'artist',labelIds:['alpha']},'admin');
  assert.deepEqual(account.permissions,['read']);
  await assert.rejects(
    f.store.putAccount({email:'artist@example.com',password,role:'artist',labelIds:['alpha']},'admin'),
    error=>error.status===409
  );
  await assert.rejects(f.store.issueSession(account.email,'wrong password'),error=>error.status===401);

  const issuedAt=new Date('2026-10-11T00:00:00Z');
  const session=await f.store.issueSession(account.email,password,{now:issuedAt});
  assert.ok(await f.store.authenticateSession(session.token,new Date('2026-10-11T00:14:59Z')));
  assert.equal(await f.store.authenticateSession(session.token,new Date('2026-10-11T00:15:00Z')),null);
  const records=await f.store.audit();
  assert.ok(records.some(record=>record.action==='account.created' && record.details.accountId===account.id));
  assert.ok(records.some(record=>record.action==='session.issued'));
});

test('interactive roles cannot exceed their derived write scope',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putAccount({email:'team@example.com',password,role:'team_member',labelIds:['alpha']},'admin');
  const session=await f.store.issueSession('team@example.com',password);
  const api=await serve(f.store);t.after(()=>api.close());
  assert.equal((await api.request('/v1/scopes',{key:session.token})).status,200);
  assert.equal((await api.request('/v1/ingest',{key:session.token,body:{source:'manual',facts:[]}})).status,403);
  assert.equal((await api.request('/v1/accounts',{key:session.token,body:{email:'x@example.com',password,role:'artist',labelIds:['alpha']}})).status,403);
});

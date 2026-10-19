import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDistributorStatement} from '../src/distributor.js';
const mapping={externalId:'Transaction',occurredAt:'Date',isrc:'ISRC',currency:'Currency',gross:'Gross',fees:'Fees',net:'Net',payoutStatus:'Status',settlementId:'Settlement'};
const csv=(status='pending',net='1.15',settlement='')=>'Transaction,Date,ISRC,Currency,Gross,Fees,Net,Status,Settlement\na1,2026-10-01,USABC1234567,USD,1.25,0.10,'+net+','+status+','+settlement+'\n';
const parse=s=>parseDistributorStatement(s,{labelId:'label_one',source:'toolost_export',mapping});
test('CSV import uses exact minor units and does not assert live or settled',()=>{
 const [row]=parse(csv());assert.equal(row.netMinor,'115');assert.equal(row.grossMinor,'125');assert.equal(row.payoutStatus,'pending');assert.equal(row.isLive,false);assert.equal(row.provenance,'imported_csv');
});
test('settlement requires reconciliation reference',()=>{
 assert.throws(()=>parse(csv('settled')));assert.equal(parse(csv('settled','1.15','settlement_4'))[0].settlementId,'settlement_4');
});
test('reconciliation fails closed for inconsistent statement totals',()=>assert.throws(()=>parse(csv('pending','1.16'))));
test('invalid dates and duplicate transaction IDs rejected',()=>{
 assert.throws(()=>parse(csv().replace('2026-10-01','2026-02-30')));
 assert.throws(()=>parse(csv()+csv().split('\n')[1]+'\n'));
});
test('currencies without an implemented two-decimal minor unit fail closed',()=>{
 for(const currency of ['JPY','KWD','XYZ'])
  assert.throws(()=>parse(csv().replace(',USD,',','+currency+',')),/unsupported currency minor-unit exponent/);
 for(const currency of ['EUR','GBP'])
  assert.equal(parse(csv().replace(',USD,',','+currency+','))[0].currency,currency);
});
test('invalid money precision rejected',()=>assert.throws(()=>parse(csv().replace('1.25','1.256'))));
test('no silent assumed column mapping',()=>assert.throws(()=>parseDistributorStatement(csv(),{labelId:'label_one'})));

import {fixture,labels,serve,secrets} from './helpers.js';

test('statement import persists atomically with label-scoped catalog identity and replay protection',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putCatalog({labelId:'alpha',id:'artist',kind:'artist',name:'Artist'});
  await f.store.putCatalog({labelId:'alpha',id:'release',kind:'release',name:'Release',artistId:'artist'});
  await f.store.putCatalog({labelId:'alpha',id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'release',isrc:'USABC1234567'});
  const api=await serve(f.store);t.after(()=>api.close());
  const body={labelId:'alpha',source:'toolost_export',statementId:'october',csv:csv(),mapping};
  const first=await api.request('/v1/distributor/statements',{key:secrets.alpha,body});
  assert.equal(first.status,200);assert.equal(first.body.import.accepted,1);
  const rows=await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha});
  assert.equal(rows.status,200);assert.equal(rows.body.rows.length,1);
  assert.equal(rows.body.rows[0].trackId,'track');
  assert.equal(rows.body.rows[0].netMinor,'115');
  assert.equal(rows.body.rows[0].providerStatus,'pending');
  assert.equal((await api.request('/v1/distributor/rows?labelId=beta',{key:secrets.alpha})).status,403);
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.reader,body})).status,403);
  const replay=await api.request('/v1/distributor/statements',{key:secrets.alpha,body});
  assert.equal(replay.body.import.duplicateStatement,true);
  assert.equal(replay.body.import.accepted,0);
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:{...body,csv:csv('settled','1.15','bank-claim')}})).status,409);
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:{...body,statementId:'new-export',csv:csv('settled','1.15','bank-claim')}})).status,409);
  assert.equal((await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha})).body.rows.length,1);
});
test('unmapped ISRC rolls back whole statement, including any preceding valid row',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putCatalog({labelId:'alpha',id:'artist',kind:'artist',name:'Artist'});
  await f.store.putCatalog({labelId:'alpha',id:'release',kind:'release',name:'Release',artistId:'artist'});
  await f.store.putCatalog({labelId:'alpha',id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'release',isrc:'USABC1234567'});
  const api=await serve(f.store);t.after(()=>api.close());
  const bad=csv()+csv().split('\n')[1].replace('a1,','a2,').replace('USABC1234567','USDEF1234567')+'\n';
  const body={labelId:'alpha',source:'toolost_export',statementId:'with-unknown',csv:bad,mapping};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body})).status,422);
  assert.equal((await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha})).body.rows.length,0);
  assert.equal((await f.pool.query('SELECT count(*)::integer AS count FROM music_distributor_statements')).rows[0].count,0);
});
test('amount outside persisted bigint range fails before any write',()=>{
  assert.throws(()=>parse(csv().replace('1.25','92233720368547758.08')),/64-bit/);
});

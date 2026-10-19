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
test('currency minor-unit exponents are exact and unknown codes fail closed',()=>{
 assert.throws(()=>parse(csv().replace(',USD,',',XYZ,')),/unsupported currency minor-unit exponent/);
 for(const currency of ['EUR','GBP'])
  assert.equal(parse(csv().replace(',USD,',','+currency+','))[0].currency,currency);
 const yen=csv().replace(',USD,1.25,0.10,1.15',',JPY,125,10,115');
 assert.equal(parse(yen)[0].netMinor,'115');
 assert.throws(()=>parse(yen.replace(',JPY,125',',JPY,125.0')),/precision/);
 const dinar=csv().replace(',USD,1.25,0.10,1.15',',KWD,1.250,0.100,1.150');
 assert.equal(parse(dinar)[0].netMinor,'1150');
 assert.throws(()=>parse(dinar.replace('1.250','1.2500')),/precision/);
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

test('operator-recorded settlement amount match stays separate from bank verification',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putCatalog({labelId:'alpha',id:'artist',kind:'artist',name:'Artist'});
  await f.store.putCatalog({labelId:'alpha',id:'release',kind:'release',name:'Release',artistId:'artist'});
  await f.store.putCatalog({labelId:'alpha',id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'release',isrc:'USABC1234567'});
  const api=await serve(f.store);t.after(()=>api.close());
  const statement={labelId:'alpha',source:'toolost_export',statementId:'first',csv:csv('settled','1.15','settle_1'),mapping};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:statement})).status,200);
  const match={labelId:'alpha',source:'toolost_export',settlementId:'settle_1',invoiceId:'invoice_1',
    invoiceMinor:'115',bankTransactionId:'bank_1',bankMinor:'115'};
  assert.equal((await api.request('/v1/distributor/reconciliations',{key:secrets.alpha,body:match})).status,403);
  assert.equal((await api.request('/v1/distributor/reconciliations',{body:{...match,invoiceMinor:'114'}})).status,422);
  const recorded=await api.request('/v1/distributor/reconciliations',{body:match});
  assert.equal(recorded.status,200);
  assert.equal(recorded.body.reconciliation.evidenceStatus,'operator_recorded_amount_match');
  assert.equal(recorded.body.reconciliation.providerMinor,'115');
  assert.equal((await api.request('/v1/distributor/reconciliations',{body:match})).body.reconciliation.duplicate,true);
  assert.equal((await api.request('/v1/distributor/reconciliations',{body:{...match,invoiceId:'different'}})).status,409);
  const listed=await api.request('/v1/distributor/reconciliations?labelId=alpha',{key:secrets.alpha});
  assert.equal(listed.status,200);assert.equal(listed.body.reconciliations[0].currentSourceMatch,true);
  assert.equal((await api.request('/v1/distributor/reconciliations?labelId=beta',{key:secrets.alpha})).status,403);
  const second={...statement,statementId:'second',csv:csv('settled','1.15','settle_2').replace('a1,','a2,')};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:second})).status,200);
  assert.equal((await api.request('/v1/distributor/reconciliations',{body:{...match,settlementId:'settle_2',invoiceId:'invoice_2'}})).status,409);
});

test('reversal links one exact prior transaction and invalidates recorded amount match',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putCatalog({labelId:'alpha',id:'artist',kind:'artist',name:'Artist'});
  await f.store.putCatalog({labelId:'alpha',id:'release',kind:'release',name:'Release',artistId:'artist'});
  await f.store.putCatalog({labelId:'alpha',id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'release',isrc:'USABC1234567'});
  const api=await serve(f.store);t.after(()=>api.close());
  const original={labelId:'alpha',source:'toolost_export',statementId:'original',csv:csv('settled','1.15','settle_1'),mapping};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:original})).status,200);
  const match={labelId:'alpha',source:'toolost_export',settlementId:'settle_1',invoiceId:'invoice_1',
    invoiceMinor:'115',bankTransactionId:'bank_1',bankMinor:'115'};
  assert.equal((await api.request('/v1/distributor/reconciliations',{body:match})).status,200);
  const reversalCsv='Transaction,Date,ISRC,Currency,Gross,Fees,Net,Status,Settlement,Reverses\n'
    +'rev1,2026-10-02,USABC1234567,USD,-1.25,-0.10,-1.15,reversed,,a1\n';
  const reversal={...original,statementId:'reversal',csv:reversalCsv,mapping:{...mapping,reversesExternalId:'Reverses'}};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:reversal})).status,200);
  const listed=await api.request('/v1/distributor/reconciliations?labelId=alpha',{key:secrets.alpha});
  assert.equal(listed.body.reconciliations[0].currentSourceMatch,false);
  const rows=await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha});
  assert.ok(rows.body.rows.some(r=>r.reversesExternalId==='a1'));
  const duplicate={...reversal,statementId:'duplicate',csv:reversalCsv.replace('rev1,','rev2,')};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:duplicate})).status,409);
  const missing={...reversal,statementId:'missing',csv:reversalCsv.replace('a1\n','absent\n').replace('rev1,','rev3,')};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:missing})).status,422);
});

test('non-reversal money signs and external evidence flags fail closed',async t=>{
  assert.throws(()=>parse(csv().replace('1.25','-1.25').replace('0.10','-0.10').replace('1.15','-1.15')),/nonnegative/);
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putCatalog({labelId:'alpha',id:'artist',kind:'artist',name:'Artist'});
  await f.store.putCatalog({labelId:'alpha',id:'release',kind:'release',name:'Release',artistId:'artist'});
  await f.store.putCatalog({labelId:'alpha',id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'release',isrc:'USABC1234567'});
  const api=await serve(f.store);t.after(()=>api.close());
  const body={labelId:'alpha',source:'toolost_export',statementId:'flags',csv:csv('settled','1.15','settle_1'),mapping};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body})).status,200);
  const row=(await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha})).body.rows[0];
  assert.equal(row.provenance,'imported_csv');assert.equal(row.isLive,false);assert.equal(row.bankVerified,false);
  const match={labelId:'alpha',source:'toolost_export',settlementId:'settle_1',invoiceId:'invoice_1',
    invoiceMinor:'115',bankTransactionId:'bank_1',bankMinor:'115'};
  assert.equal((await api.request('/v1/distributor/reconciliations',{body:match})).status,200);
  const record=(await api.request('/v1/distributor/reconciliations?labelId=alpha',{key:secrets.alpha})).body.reconciliations[0];
  assert.equal(record.bankVerified,false);assert.equal(record.evidenceStatus,'operator_recorded_amount_match');
});

test('out-of-order original and reversal in one statement link after atomic insertion',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putCatalog({labelId:'alpha',id:'artist',kind:'artist',name:'Artist'});
  await f.store.putCatalog({labelId:'alpha',id:'release',kind:'release',name:'Release',artistId:'artist'});
  await f.store.putCatalog({labelId:'alpha',id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'release',isrc:'USABC1234567'});
  const api=await serve(f.store);t.after(()=>api.close());
  const body={labelId:'alpha',source:'toolost_export',statementId:'out-of-order',
    csv:'Transaction,Date,ISRC,Currency,Gross,Fees,Net,Status,Settlement,Reverses\n'
      +'rev1,2026-10-02,USABC1234567,USD,-1.25,-0.10,-1.15,reversed,,a1\n'
      +'a1,2026-10-01,USABC1234567,USD,1.25,0.10,1.15,reported,,\n',
    mapping:{...mapping,reversesExternalId:'Reverses'}};
  const imported=await api.request('/v1/distributor/statements',{key:secrets.alpha,body});
  assert.equal(imported.status,200);assert.equal(imported.body.import.accepted,2);
  assert.equal((await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha})).body.rows.length,2);
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:{...body,statementId:'invalid',csv:42}})).status,400);
});

test('optional provider UPC must match the release linked to the ISRC',async t=>{
  const f=await fixture();t.after(()=>f.close());await labels(f.store);
  await f.store.putCatalog({labelId:'alpha',id:'artist',kind:'artist',name:'Artist'});
  await f.store.putCatalog({labelId:'alpha',id:'release',kind:'release',name:'Release',artistId:'artist',upc:'012345678901'});
  await f.store.putCatalog({labelId:'alpha',id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'release',isrc:'USABC1234567'});
  const api=await serve(f.store);t.after(()=>api.close());
  const body={labelId:'alpha',source:'toolost_export',statementId:'with-upc',mapping:{...mapping,upc:'UPC'},
    csv:'Transaction,Date,ISRC,Currency,Gross,Fees,Net,Status,Settlement,UPC\n'
      +'a1,2026-10-01,USABC1234567,USD,1.25,0.10,1.15,pending,,012345678901\n'};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body})).status,200);
  const row=(await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha})).body.rows[0];
  assert.equal(row.upc,'012345678901');assert.equal(row.releaseId,'release');
  const mismatch={...body,statementId:'bad-upc',csv:body.csv.replace('a1,','a2,').replace('012345678901','999999999999')};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:mismatch})).status,422);
  const malformed={...body,statementId:'malformed-upc',csv:body.csv.replace('a1,','a3,').replace('012345678901','123')};
  assert.equal((await api.request('/v1/distributor/statements',{key:secrets.alpha,body:malformed})).status,422);
  assert.equal((await api.request('/v1/distributor/rows?labelId=alpha',{key:secrets.alpha})).body.rows.length,1);
});

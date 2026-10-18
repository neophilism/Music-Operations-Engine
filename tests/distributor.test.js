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
test('invalid money precision rejected',()=>assert.throws(()=>parse(csv().replace('1.25','1.256'))));
test('no silent assumed column mapping',()=>assert.throws(()=>parseDistributorStatement(csv(),{labelId:'label_one'})));

import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOfflineAttendance} from '../src/event-attendance.js';
const input=()=>({labelId:'label_one',eventId:'event_one',sessionId:'session_one',
  sourceReceiptId:'receipt_one',occurredAt:'2026-10-01T12:00:00Z',attendeeCount:'9007199254740993'});
const prepare=x=>prepareOfflineAttendance(x,{labelId:'label_one',asOf:'2026-10-02T00:00:00Z'});
test('exact large aggregate, stable identity and explicit manual provenance',()=>{
  const a=prepare(input()),b=prepare(input());
  assert.equal(a.attendeeCount,'9007199254740993');assert.equal(a.id,b.id);
  assert.equal(a.contentHash,b.contentHash);assert.equal(a.providerVerified,false);
  assert.equal(a.isLive,false);assert.equal(Object.isFrozen(a),true);
});
test('wrong label and future report fail closed',()=>{
  assert.throws(()=>prepare({...input(),labelId:'label_other'}));
  assert.throws(()=>prepare({...input(),occurredAt:'2026-10-03T00:00:00Z'}));
});
test('raw QR, personal fields, hidden properties and getters fail closed',()=>{
  for(const field of ['rawQr','ticketCode','email','customerName'])
    assert.throws(()=>prepare({...input(),[field]:'private'}));
  const hidden=input();Object.defineProperty(hidden,'email',{value:'private'});
  assert.throws(()=>prepare(hidden));
  const getter=input();Object.defineProperty(getter,'attendeeCount',{get(){throw Error('executed')}});
  assert.throws(()=>prepare(getter),/aggregate fields/);
});
test('invalid counts and changed report content fail closed or change content hash',()=>{
  for(const count of [0,-1,'1.5',Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>prepare({...input(),attendeeCount:count}));
  const changed=prepare({...input(),attendeeCount:'2'}),original=prepare(input());
  assert.equal(changed.id,original.id);assert.notEqual(changed.contentHash,original.contentHash);
});

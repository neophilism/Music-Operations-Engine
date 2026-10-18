import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlatformBatch} from '../src/platforms.js';
const store={resolveCatalog:async()=>null,catalogItem:async()=>null};
const event=quantity=>({id:'attendance-one',type:'session.attendance',occurredAt:'2026-10-09T12:00:00Z',
  sessionId:'session-one',quantity,reportingMode:'delta',authorizationStatus:'organizer_attested',
  authorizationValidUntil:'2026-10-10T00:00:00Z'});
const batch=quantity=>({schemaVersion:1,deliveryId:'delivery-one',labelId:'label-one',events:[event(quantity)]});
test('SceneSignal attendance delta is positive and exact',async()=>{
  for(const value of [0,'0','-1'])
    await assert.rejects(normalizePlatformBatch(batch(value),'scenesignal',store),/positive|range/);
  const report=await normalizePlatformBatch(batch('9007199254740993'),'scenesignal',store);
  assert.equal(report.events[0].fact.quantity,'9007199254740993');
  assert.equal(report.events[0].fact.metadata.scene.sessionId,'session-one');
});

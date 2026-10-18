import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlatformBatch} from '../src/platforms.js';
const store={resolveCatalog:async (_label,_platform,kind,id)=>kind==='artist'&&id==='artist-one'?{id:'artist-one',name:'Artist One'}:null,
  catalogItem:async()=>null};
const envelope=points=>({schemaVersion:1,deliveryId:'delivery-one',labelId:'label-one',events:[
  {id:'reward-one',type:'reward.redeemed',occurredAt:'2026-10-09T12:00:00Z',externalArtistId:'artist-one',pointsMicrounits:points,rewardId:'reward-one'}]});
test('TrackZero redemption needs positive exact point spend',async()=>{
  for(const value of ['0',0,'-1'])
    await assert.rejects(normalizePlatformBatch(envelope(value),'trackzero',store),/positive|range/);
  const report=await normalizePlatformBatch(envelope('9007199254740993000'),'trackzero',store);
  assert.equal(report.events[0].fact.metadata.trackzero.pointsSpentMicrounits,'9007199254740993000');
});

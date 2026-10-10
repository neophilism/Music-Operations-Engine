import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture,labels,catalog,serve,secrets} from './helpers.js';
import {normalizePlatformBatch} from '../src/platforms.js';
import {verifyWebhook} from '../src/webhooks.js';

const webhookSecrets={trackzero:'trackzero-webhook-secret-'.repeat(2),scenesignal:'scenesignal-webhook-secret-'.repeat(2)};
const occurredAt='2026-10-09T12:00:00Z';
const event=(id,type,fields={})=>({id,type,occurredAt,...fields});
const listen=(id='listen')=>event(id,'radio.listen_completed',{externalTrackId:'tz-track',durationMs:60000,broadcastOccurrenceId:'broadcast-1'});
const points=(id='points')=>event(id,'speaker.points_vested',{externalTrackId:'tz-track',externalArtistId:'tz-artist',broadcastOccurrenceId:'broadcast-1',verificationReceiptId:'receipt-1',policyVersion:'policy-1',durationMs:60000,verifiedOutputMs:120000,outputCount:2,pointsMicrounits:'9007199254740993000',route:'bluetooth_speaker',measurementStatus:'verified',completionStatus:'closed'});
const sceneFields={sessionId:'session-1',authorizationStatus:'organizer_attested',authorizationValidUntil:'2026-10-10T00:00:00Z'};
function envelope(events,deliveryId='delivery-1',labelId='alpha') {return {schemaVersion:1,deliveryId,labelId,events};}
function signature(platform,body,seconds=Math.floor(Date.now()/1000)) {
  const timestamp=String(seconds),raw=Buffer.from(JSON.stringify(body));
  return {'x-music-timestamp':timestamp,'x-music-signature':'sha256='+createHmac('sha256',webhookSecrets[platform]).update(timestamp+'.').update(raw).digest('hex')};
}
async function setup(t) {
  const f=await fixture();t.after(()=>f.close());await labels(f.store);await catalog(f.store);await catalog(f.store,'beta');
  await f.store.putCatalog({labelId:'alpha',id:'bonus',kind:'track',name:'Alternate Take',artistId:'artist',releaseId:'album',externalIds:[{source:'trackzero',externalId:'tz-bonus'}]});
  const api=await serve(f.store,{webhookSecrets});t.after(()=>api.close());
  const send=(platform,body,options={})=>api.request('/v1/platforms/'+platform+'/events',{body,headers:signature(platform,body),...options});
  return {...f,api,send};
}
test('TrackZero reports listening, vested speaker points, rewards, Grooves and separate currencies',async t=>{
  const {api,send}=await setup(t);
  const events=[listen(),points(),event('reward','reward.redeemed',{externalArtistId:'tz-artist',pointsMicrounits:'5000000',rewardId:'reward-1'}),
    event('groove','groove.granted',{externalTrackId:'tz-bonus',opportunityId:'opportunity-1'}),
    event('sale','album.sale',{externalReleaseId:'tz-album',quantity:2,amountMinor:999,currency:'USD',productKind:'album'}),
    event('refund','album.refund',{externalReleaseId:'tz-album',quantity:1,amountMinor:499,currency:'USD',productKind:'album'}),
    event('eur-sale','album.sale',{externalReleaseId:'tz-album',quantity:1,amountMinor:600,currency:'EUR',productKind:'album'})];
  assert.equal((await send('trackzero',envelope(events))).body.accepted,7);
  const report=await api.request('/v1/platforms/trackzero/summary?labelId=alpha');
  assert.equal(report.status,200);
  const p=report.body.platforms.trackzero;
  assert.equal(p.completedListens,1);assert.equal(p.listeningMs,60000);assert.equal(p.speakerPlays,2);assert.equal(p.verifiedOutputMs,120000);
  assert.equal(p.pointsEarnedMicrounits,'9007199254740993000');assert.equal(p.pointsSpentMicrounits,'5000000');
  assert.equal(p.rewardsRedeemed,1);assert.equal(p.groovesGranted,1);assert.equal(p.albumsSold,3);assert.equal(p.albumsRefunded,1);
  assert.equal(p.currencies.USD.salesMinor,999);assert.equal(p.currencies.EUR.salesMinor,600);
  assert.equal(report.body.counts.plays,2);assert.equal(report.body.byLabel.alpha.platforms.trackzero.groovesGranted,1);
  assert.equal(report.body.artists[0].platforms.trackzero.pointsEarnedMicrounits,'9007199254740993000');
  assert.equal((await api.request('/v1/sources?labelId=alpha')).body.sources[0].records,7);
  const manifests=(await api.request('/v1/platforms?labelId=alpha',{key:secrets.track})).body.platforms;
  assert.equal(manifests.length,1);assert.equal(manifests[0].id,'trackzero');assert.equal(manifests[0].status,'data-received');
});
test('Shared SceneSignal sessions, attendees, and speaker contributions count once across label families',async t=>{
  const {api,send}=await setup(t);
  const events=[event('created','session.created',sceneFields),
    event('played','session.music_played',{...sceneFields,externalTrackId:'ss-track',durationMs:60000}),
    event('crowd','session.attendance',{...sceneFields,quantity:25,reportingMode:'delta'}),
    event('speakers','session.speaker_contribution',{...sceneFields,durationMs:60000,verifiedOutputMs:180000,outputCount:3,measurementStatus:'verified'})];
  assert.equal((await send('scenesignal',envelope(events,'alpha-scene','alpha'))).body.accepted,4);
  assert.equal((await send('scenesignal',envelope(events,'beta-scene','beta'))).body.accepted,4);
  const family=await api.request('/v1/summary?familyId=family',{key:secrets.reader});
  assert.equal(family.body.factCount,8);assert.equal(family.body.counts.events,1);assert.equal(family.body.counts.attendees,25);assert.equal(family.body.counts.plays,2);
  assert.equal(family.body.platforms.scenesignal.sessions,1);assert.equal(family.body.platforms.scenesignal.contributedSpeakers,3);assert.equal(family.body.platforms.scenesignal.verifiedOutputMs,180000);
  assert.equal(family.body.byLabel.alpha.counts.attendees,25);assert.equal(family.body.byLabel.beta.counts.events,1);
  assert.equal((await api.request('/v1/platforms/scenesignal/summary?labelId=alpha')).body.platforms.scenesignal.musicMs,60000);
  const changed=[{...events[2],quantity:30}];
  const conflict=await send('scenesignal',envelope(changed,'hidden-conflict','hidden'));
  assert.equal(conflict.status,409);assert.equal((await api.request('/v1/summary?labelId=hidden')).body.factCount,0);
});
test('SceneSignal commerce and session rewards remain distinct from radio points and aggregate money by currency',async t=>{
  const {send,api}=await setup(t);
  assert.equal((await send('scenesignal',envelope([
    event('sale','album.sale',{sessionId:'session-1',externalReleaseId:'ss-album',quantity:1,amountMinor:500,currency:'USD',productKind:'album'}),
    event('reward','session.reward_redeemed',{...sceneFields,externalArtistId:'ss-artist',rewardId:'session-reward'})
  ],'scene-commerce'))).body.accepted,2);
  assert.equal((await send('trackzero',envelope([event('sale','album.sale',{externalReleaseId:'tz-album',quantity:1,amountMinor:1000,currency:'USD',productKind:'album'})],'radio-commerce'))).body.accepted,1);
  const report=(await api.request('/v1/summary?labelId=alpha')).body;
  assert.equal(report.currencies.USD.salesMinor,1500);assert.equal(report.counts.sales,2);
  assert.equal(report.platforms.scenesignal.currencies.USD.salesMinor,500);assert.equal(report.platforms.trackzero.currencies.USD.salesMinor,1000);
  assert.equal(report.platforms.scenesignal.rewardsRedeemed,1);assert.equal(report.platforms.trackzero.pointsEarnedMicrounits,'0');
});
test('Signed delivery retries, immutable event ids, receipts, and concurrent retries are idempotent',async t=>{
  const {api,send}=await setup(t);
  const body=envelope([points()]);assert.equal((await send('trackzero',body)).body.accepted,1);
  const retry=await send('trackzero',body);assert.equal(retry.body.accepted,0);assert.equal(retry.body.duplicateDelivery,true);
  const repeated=await send('trackzero',envelope([points()],'new-delivery'));assert.equal(repeated.body.accepted,0);assert.equal(repeated.body.duplicates,1);
  const conflict=await send('trackzero',envelope([listen('new'),{...points(),outputCount:3}],'conflict'));assert.equal(conflict.status,409);
  assert.equal((await api.request('/v1/summary?labelId=alpha')).body.factCount,1);
  const changedDelivery=await send('trackzero',envelope([listen()],'delivery-1'));assert.equal(changedDelivery.status,409);
  const receiptReplay=await send('trackzero',envelope([points('receipt-replay')],'receipt-replay-delivery'));assert.equal(receiptReplay.status,200);
  assert.equal((await api.request('/v1/summary?labelId=alpha')).body.platforms.trackzero.speakerPlays,2);
  const concurrent=envelope([listen('parallel')],'parallel');
  const results=await Promise.all([send('trackzero',concurrent),send('trackzero',concurrent)]);
  assert.deepEqual(results.map(r=>r.body.accepted).sort(),[0,1]);
  assert.equal((await api.request('/v1/summary?labelId=alpha')).body.counts.streams,1);
});
test('Platform endpoints reject unsigned, tampered, stale, unauthorized and private payloads',async t=>{
  const {api,send}=await setup(t);const body=envelope([listen()]);
  assert.equal((await api.request('/v1/platforms/trackzero/events',{body})).status,401);
  assert.equal((await api.request('/v1/platforms/trackzero/events',{body,headers:signature('trackzero',body,Math.floor(Date.now()/1000)-301)})).status,401);
  assert.equal((await api.request('/v1/platforms/trackzero/events',{body:{...body,deliveryId:'tampered'},headers:signature('trackzero',body)})).status,401);
  assert.equal((await send('trackzero',body,{key:secrets.reader})).status,403);
  assert.equal((await send('trackzero',envelope([listen()],'other-label','beta'),{key:secrets.track})).status,403);
  assert.equal((await send('scenesignal',envelope([event('scene','session.created',sceneFields)]),{key:secrets.track})).status,403);
  assert.equal((await send('trackzero',envelope([{...listen(),preciseLocation:{lat:1,lon:2}}]))).status,422);
  assert.equal((await api.request('/v1/ingest',{body:{source:'trackzero',labelId:'alpha',facts:[]}})).status,422);
  assert.equal((await api.request('/v1/ingest',{body:{source:'manual',labelId:'alpha',facts:[{type:'stream',date:'2026-10-09',externalId:'fake',metadata:{trackzero:{pointsEarnedMicrounits:'999'}}}]}})).status,422);
  assert.equal((await api.request('/v1/platforms/trackzero/summary?source=scenesignal')).status,400);
  assert.equal((await api.request('/v1/summary?labelId=alpha')).body.factCount,0);
  const disabled=await serve((await setup(t)).store,{webhookSecrets:{}});t.after(()=>disabled.close());
  assert.equal((await disabled.request('/v1/platforms/trackzero/events',{body,headers:signature('trackzero',body)})).status,503);
});
test('Headphone listening and Groove grants never turn into speaker points; provisional or interrupted points fail',async t=>{
  const {api,send}=await setup(t);
  const invalid=[{...points(),route:'headphones'},{...points(),completionStatus:'interrupted'},{...points(),measurementStatus:'unverified'},
    {...points(),type:'speaker.points_provisional'},{...points(),verifiedOutputMs:999999},{...points(),pointsMicrounits:9007199254740992},
    event('invalid','__proto__')];
  for(const [i,p] of invalid.entries()) assert.equal((await send('trackzero',envelope([p],'invalid-'+i))).status,422);
  assert.equal((await send('trackzero',envelope([listen(),event('groove','groove.granted',{externalTrackId:'tz-bonus',opportunityId:'opportunity'})],'ordinary'))).status,200);
  const result=(await api.request('/v1/summary?labelId=alpha')).body;
  assert.equal(result.platforms.trackzero.completedListens,1);assert.equal(result.platforms.trackzero.groovesGranted,1);assert.equal(result.platforms.trackzero.pointsEarnedMicrounits,'0');
});
test('Scene authorization and attendance contracts are checked without ingesting permits or locations',async t=>{
  const {send,api}=await setup(t);
  const invalid=[event('expiry','session.music_played',{...sceneFields,externalTrackId:'ss-track',durationMs:60000,authorizationValidUntil:occurredAt}),
    event('snapshot','session.attendance',{...sceneFields,quantity:30,reportingMode:'cumulative'}),
    event('private','session.created',{...sceneFields,permitContents:'private'}),event('missing','session.created',{sessionId:'session'})];
  for(const [i,e] of invalid.entries()) assert.equal((await send('scenesignal',envelope([e],'invalid-scene-'+i))).status,422);
  assert.equal((await api.request('/v1/summary?labelId=alpha')).body.factCount,0);
});
test('Unknown recording mappings cannot be inferred from a title and a rejected delivery can be retried after repair',async t=>{
  const {send,store}=await setup(t);const body=envelope([{...listen(),externalTrackId:'unmapped'}]);
  assert.equal((await send('trackzero',body)).status,422);
  await store.putCatalog({labelId:'alpha',id:'repaired',kind:'track',name:'Repaired Track',artistId:'artist',releaseId:'album',externalIds:[{source:'trackzero',externalId:'unmapped'}]});
  assert.equal((await send('trackzero',body)).body.accepted,1);
  assert.equal((await normalizePlatformBatch(body,'trackzero',store)).events[0].fact.trackId,'repaired');
});
test('Webhook signatures bind bytes and timestamps using an independently computed HMAC',()=>{
  const body=envelope([listen()]),raw=Buffer.from(JSON.stringify(body)),headers=signature('trackzero',body);
  assert.match(verifyWebhook(headers,raw,webhookSecrets.trackzero),/^[a-f0-9]{64}$/);
  assert.throws(()=>verifyWebhook(headers,Buffer.from(JSON.stringify({...body,labelId:'beta'})),webhookSecrets.trackzero));
});

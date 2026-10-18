import {normalizeFact} from './core.js';
import {requireThat} from './errors.js';
import {identifier,integer,exact,timestamp} from './validation.js';
import {canonicalHash} from './webhooks.js';

export const PLATFORMS=['trackzero','scenesignal'];
const common=['id','type','occurredAt'];
const definitions={
  trackzero:{
    'radio.listen_completed':['externalTrackId','durationMs','broadcastOccurrenceId'],
    'speaker.points_vested':['externalTrackId','externalArtistId','broadcastOccurrenceId','verificationReceiptId','policyVersion','durationMs','verifiedOutputMs','outputCount','pointsMicrounits','route','measurementStatus','completionStatus'],
    'reward.redeemed':['externalArtistId','pointsMicrounits','rewardId'],
    'groove.granted':['externalTrackId','opportunityId'],
    'album.sale':['externalReleaseId','quantity','amountMinor','currency','productKind'],
    'album.refund':['externalReleaseId','quantity','amountMinor','currency','productKind']
  },
  scenesignal:{
    'session.created':['sessionId','authorizationStatus','authorizationValidUntil'],
    'session.music_played':['sessionId','externalTrackId','durationMs','authorizationStatus','authorizationValidUntil'],
    'session.attendance':['sessionId','quantity','reportingMode','authorizationStatus','authorizationValidUntil'],
    'session.speaker_contribution':['sessionId','durationMs','verifiedOutputMs','outputCount','measurementStatus','authorizationStatus','authorizationValidUntil'],
    'session.reward_redeemed':['sessionId','rewardId','externalArtistId','authorizationStatus','authorizationValidUntil'],
    'album.sale':['sessionId','externalReleaseId','quantity','amountMinor','currency','productKind'],
    'album.refund':['sessionId','externalReleaseId','quantity','amountMinor','currency','productKind']
  }
};
function onlyFields(raw,fields) { requireThat(Object.keys(raw).every(k=>fields.includes(k)),'Unexpected fields: platform contracts accept aggregate business metadata only'); }
function duration(value,name='durationMs') {
  const n=integer(value,name,{max:86400000n});requireThat(n > 0n,`${name} must be positive`);return n;
}
function reference(value,name) { requireThat(typeof value === 'string' && value.length > 0 && value.length <= 128,`${name} is required (max 128 characters)`);return value; }
export async function normalizePlatformBatch(data,platform,store) {
  requireThat(PLATFORMS.includes(platform),'Unknown platform',404);
  onlyFields(data,['schemaVersion','deliveryId','labelId','events']);
  requireThat(data.schemaVersion === 1,'Unsupported platform schemaVersion');
  const labelId=identifier(data.labelId,'labelId'),deliveryId=identifier(data.deliveryId,'deliveryId');
  requireThat(Array.isArray(data.events) && data.events.length > 0 && data.events.length <= 1000,'Provide 1–1000 platform events');
  const seen=new Set(),cache=new Map();
  async function mapped(kind,externalId) {
    reference(externalId,'external'+kind+'Id');const key=kind+':'+externalId;
    if(!cache.has(key)) cache.set(key,await store.resolveCatalog(labelId,platform,kind,externalId));
    const item=cache.get(key);requireThat(item,`Unmapped ${platform} ${kind} identity for this label`);return item;
  }
  async function named(id) {
    const key='canonical:'+id;
    if(!cache.has(key)) cache.set(key,await store.catalogItem(labelId,id));
    const item=cache.get(key);requireThat(item,'Missing canonical catalog parent');return item;
  }
  const events=[];
  for (const raw of data.events) {
    requireThat(raw && typeof raw === 'object' && !Array.isArray(raw),'Platform event must be an object');
    const id=identifier(raw.id,'event id');requireThat(!seen.has(id),'Repeated event id within delivery');seen.add(id);
    const fields=Object.hasOwn(definitions[platform],raw.type) ? definitions[platform][raw.type] : null;requireThat(fields,'Unsupported platform event type');onlyFields(raw,[...common,...fields]);
    const occurredAt=timestamp(raw.occurredAt);
    const event={id,type:raw.type,occurredAt};
    const fact={labelId,externalId:id,type:'play',occurredAt,quantity:1,metadata:{schemaVersion:1,providerEventId:id,providerEventType:raw.type}};
    if (raw.externalTrackId !== undefined) {
      const track=await mapped('track',raw.externalTrackId),artist=await named(track.artistId),release=await named(track.releaseId);
      Object.assign(fact,{artistId:artist.id,artist:artist.name,releaseId:release.id,release:release.name,trackId:track.id,track:track.name});
    }
    if (raw.externalReleaseId !== undefined) {
      const release=await mapped('release',raw.externalReleaseId),artist=await named(release.artistId);
      Object.assign(fact,{artistId:artist.id,artist:artist.name,releaseId:release.id,release:release.name});
    }
    if (raw.externalArtistId !== undefined) {
      const artist=await mapped('artist',raw.externalArtistId);
      requireThat(!fact.artistId || fact.artistId === artist.id,'Point beneficiary must match this recording’s mapped primary artist');
      Object.assign(fact,{artistId:artist.id,artist:artist.name});
    }
    if (raw.type.startsWith('album.')) {
      requireThat(raw.productKind === 'album','Music sales must identify complete albums');
      requireThat(Boolean(fact.releaseId),'Album identity required');
      fact.type=raw.type.endsWith('sale') ? 'sale' : 'refund';
      fact.quantity=exact(integer(raw.quantity,'quantity'));
      fact.amountMinor=exact(integer(raw.amountMinor,'amountMinor'));fact.currency=raw.currency;
      requireThat(fact.quantity > 0 && typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency),'Positive album quantity and currency required');
      fact.metadata.financialStatus='reported';
    }
    if (platform === 'trackzero') {
      const metrics={};fact.metadata.trackzero=metrics;
      if (raw.type === 'radio.listen_completed') {
        requireThat(Boolean(fact.trackId),'Recording identity required');identifier(raw.broadcastOccurrenceId,'broadcastOccurrenceId');
        fact.type='stream';metrics.listeningMs=duration(raw.durationMs).toString();
      }
      if (raw.type === 'speaker.points_vested') {
        requireThat(Boolean(fact.trackId) && raw.externalArtistId,'Vested points require a recording and beneficiary artist');
        requireThat(raw.route === 'bluetooth_speaker' && raw.measurementStatus === 'verified' && raw.completionStatus === 'closed','Only closed, producer-verified external Bluetooth-speaker contributions qualify');
        const durationMs=duration(raw.durationMs),outputs=integer(raw.outputCount,'outputCount',{max:2147483647n});
        const outputMs=integer(raw.verifiedOutputMs,'verifiedOutputMs');
        requireThat(outputs > 0n && outputMs > 0n && outputMs <= durationMs*outputs,'Verified output time exceeds the declared distinct speaker contribution');
        const points=integer(raw.pointsMicrounits,'pointsMicrounits',{max:10n**255n});requireThat(points > 0n,'Vested points must be positive');
        for(const k of ['broadcastOccurrenceId','verificationReceiptId','policyVersion']) identifier(raw[k],k);
        fact.quantity=exact(outputs);Object.assign(metrics,{verifiedOutputMs:outputMs.toString(),pointsEarnedMicrounits:points.toString()});
        Object.assign(fact.metadata,{verification:'producer-attested',broadcastOccurrenceId:raw.broadcastOccurrenceId,verificationReceiptId:raw.verificationReceiptId,policyVersion:raw.policyVersion});
        fact.metadata.logicalActivityId='vesting:'+labelId+':'+fact.artistId+':'+raw.broadcastOccurrenceId+':'+raw.verificationReceiptId;
      }
      if (raw.type === 'reward.redeemed') {
        requireThat(Boolean(fact.artistId),'Reward beneficiary artist required');identifier(raw.rewardId,'rewardId');
        fact.type='reward';metrics.pointsSpentMicrounits=integer(raw.pointsMicrounits,'pointsMicrounits',{max:10n**255n}).toString();
      }
      if (raw.type === 'groove.granted') {
        requireThat(Boolean(fact.trackId),'Groove recording required');identifier(raw.opportunityId,'opportunityId');fact.type='groove';
      }
    } else {
      const sessionId=identifier(raw.sessionId,'sessionId');fact.metadata.scene={sessionId};
      if (!raw.type.startsWith('album.')) {
        requireThat(['permit_verified','organizer_attested'].includes(raw.authorizationStatus),'Scene session requires producer-confirmed authorization');
        const validUntil=timestamp(raw.authorizationValidUntil,'authorizationValidUntil');
        requireThat(validUntil > occurredAt,'Scene authorization expired at event time');
        fact.metadata.authorizationStatus=raw.authorizationStatus;
      }
      if (raw.type === 'session.created') {fact.type='event';fact.metadata.logicalActivityId='session:'+sessionId;}
      if (raw.type === 'session.music_played') {requireThat(Boolean(fact.trackId),'Recording identity required');fact.metadata.scene.musicMs=duration(raw.durationMs).toString();}
      if (raw.type === 'session.attendance') {
        requireThat(raw.reportingMode === 'delta','Attendance must be a delta report, not a cumulative snapshot');
        const entries=integer(raw.quantity,'quantity');requireThat(entries > 0n,'Attendance delta must be positive');
        fact.type='attendance';fact.quantity=exact(entries);
        fact.metadata.logicalActivityId='attendance:'+sessionId+':'+id;
      }
      if (raw.type === 'session.speaker_contribution') {
        requireThat(raw.measurementStatus === 'verified','Speaker contributions require producer verification');
        const ms=duration(raw.durationMs),outputs=integer(raw.outputCount,'outputCount',{max:2147483647n}),outputMs=integer(raw.verifiedOutputMs,'verifiedOutputMs');
        requireThat(outputs > 0n && outputMs > 0n && outputMs <= ms*outputs,'Invalid verified speaker contribution');
        fact.type='contribution';fact.quantity=exact(outputs);fact.metadata.scene.verifiedOutputMs=outputMs.toString();
        fact.metadata.logicalActivityId='contribution:'+sessionId+':'+id;fact.metadata.verification='producer-attested';
      }
      if (raw.type === 'session.reward_redeemed') {requireThat(Boolean(fact.artistId),'Reward beneficiary artist required');identifier(raw.rewardId,'rewardId');fact.type='reward';}
    }
    const normalized=normalizeFact(fact,platform,{labelId});
    event.fact=normalized;event.contentHash=canonicalHash(raw);events.push(event);
  }
  return {platform,labelId,deliveryId,events};
}

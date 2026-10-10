import {exact} from './validation.js';

const keys={trackzero:['completedListens','listeningMs','speakerPlays','verifiedOutputMs','pointsEarnedMicrounits','pointsSpentMicrounits','rewardsRedeemed','groovesGranted','albumsSold','albumsRefunded'],
  scenesignal:['musicPlays','musicMs','attendees','contributedSpeakers','verifiedOutputMs','rewardsRedeemed','albumsSold','albumsRefunded']};
export function platformBuckets() {
  return Object.fromEntries(Object.entries(keys).map(([name,fields])=>[name,{counts:Object.fromEntries(fields.map(f=>[f,0n])),sessions:new Set(),currencies:new Map()}]));
}
export function addPlatformMetrics(platforms,fact) {
  if (!platforms[fact.source]) return;
  const p=platforms[fact.source],qty=BigInt(fact.quantity),metrics=fact.metadata || {};
  if (fact.source === 'trackzero') {
    if (fact.type === 'stream') p.counts.completedListens+=qty;
    if (fact.type === 'play') p.counts.speakerPlays+=qty;
    if (fact.type === 'reward') p.counts.rewardsRedeemed+=qty;
    if (fact.type === 'groove') p.counts.groovesGranted+=qty;
    for (const key of ['listeningMs','verifiedOutputMs','pointsEarnedMicrounits','pointsSpentMicrounits']) p.counts[key]+=BigInt(metrics.trackzero?.[key] || 0);
  } else {
    if(metrics.scene?.sessionId) p.sessions.add(metrics.scene.sessionId);
    if(fact.type === 'play') p.counts.musicPlays+=qty;
    if(fact.type === 'attendance') p.counts.attendees+=qty;
    if(fact.type === 'contribution') p.counts.contributedSpeakers+=qty;
    if(fact.type === 'reward') p.counts.rewardsRedeemed+=qty;
    for (const key of ['musicMs','verifiedOutputMs']) p.counts[key]+=BigInt(metrics.scene?.[key] || 0);
  }
  if (['sale','refund'].includes(fact.type)) {
    p.counts[fact.type === 'sale' ? 'albumsSold' : 'albumsRefunded']+=qty;
    if (!p.currencies.has(fact.currency)) p.currencies.set(fact.currency,{salesMinor:0n,refundsMinor:0n});
    p.currencies.get(fact.currency)[fact.type === 'sale' ? 'salesMinor' : 'refundsMinor']+=BigInt(fact.amountMinor);
  }
}
export function platformReport(platforms) {
  return Object.fromEntries(Object.entries(platforms).map(([name,p])=>[name,{
    ...Object.fromEntries(Object.entries(p.counts).map(([k,n])=>[k,k.endsWith('Microunits') ? n.toString() : exact(n)])),
    ...(name === 'scenesignal' ? {sessions:p.sessions.size} : {}),
    currencies:Object.fromEntries([...p.currencies].map(([c,m])=>[c,Object.fromEntries(Object.entries(m).map(([k,n])=>[k,exact(n)]))]))
  }]));
}

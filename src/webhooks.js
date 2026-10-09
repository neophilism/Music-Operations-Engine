import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {requireThat} from './errors.js';

export function loadWebhookSecrets(env=process.env) {
  const secrets={trackzero:env.TRACKZERO_WEBHOOK_SECRET,scenesignal:env.SCENESIGNAL_WEBHOOK_SECRET};
  for (const [platform,secret] of Object.entries(secrets)) if (secret !== undefined) requireThat(typeof secret === 'string' && secret.length >= 32,`${platform} webhook secret must be at least 32 characters`);
  requireThat(!secrets.trackzero || !secrets.scenesignal || secrets.trackzero !== secrets.scenesignal,'Use distinct signing secrets for TrackZero and SceneSignal');
  return secrets;
}
export function verifyWebhook(headers,raw,secret,now=Date.now()) {
  requireThat(Boolean(secret),'Platform ingestion is not configured',503);
  const timestamp=headers['x-music-timestamp'],signature=headers['x-music-signature'];
  requireThat(typeof timestamp === 'string' && /^\d{10}$/.test(timestamp),'Missing or invalid webhook timestamp',401);
  requireThat(Math.abs(Math.floor(now/1000)-Number(timestamp)) <= 300,'Webhook timestamp outside the five-minute window',401);
  requireThat(typeof signature === 'string' && /^sha256=[a-f0-9]{64}$/.test(signature),'Missing or invalid webhook signature',401);
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
  const received=Buffer.from(signature.slice(7),'hex');
  requireThat(received.length === expected.length && timingSafeEqual(received,expected),'Invalid webhook signature',401);
  return createHash('sha256').update(raw).digest('hex');
}
export function canonicalHash(value) {
  const canonical=v=>v && typeof v === 'object' ? (Array.isArray(v) ? v.map(canonical) : Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

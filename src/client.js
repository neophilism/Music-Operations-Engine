import {createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {requireThat,ApiError} from './errors.js';
import {PLATFORMS} from './platforms.js';

export async function sendPlatformEvents({url,platform,apiKey,webhookSecret,batch,signal,attempts=3,fetchImpl=fetch,sleep=delay,now=Date.now}) {
  requireThat(PLATFORMS.includes(platform),'Unknown platform');
  const base=new URL(url);
  requireThat(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)),'Platform exports require HTTPS outside local testing');
  requireThat(!base.username && !base.password && !base.search && !base.hash,'Engine URL cannot include credentials, query, or fragment');
  requireThat(typeof apiKey === 'string' && apiKey.length >= 32 && typeof webhookSecret === 'string' && webhookSecret.length >= 32,'Use configured server-side secrets');
  requireThat(Number.isInteger(attempts) && attempts >= 1 && attempts <= 5,'attempts must be 1–5');
  requireThat(batch?.deliveryId && batch?.labelId && batch?.schemaVersion === 1 && Array.isArray(batch.events),'Versioned delivery envelope required');
  const raw=JSON.stringify(batch);
  requireThat(Buffer.byteLength(raw) <= 5_000_000,'Delivery exceeds 5 MB');
  if (!base.pathname.endsWith('/')) base.pathname+='/';
  const endpoint=new URL('v1/platforms/'+platform+'/events',base);
  for (let attempt=0;attempt<attempts;attempt++) {
    signal?.throwIfAborted();
    let response;
    try {
      const timestamp=String(Math.floor(now()/1000));
      response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
        headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','x-music-timestamp':timestamp,
          'x-music-signature':'sha256='+createHmac('sha256',webhookSecret).update(timestamp+'.').update(raw).digest('hex')},body:raw});
    } catch(error) {
      if (signal?.aborted) throw signal.reason;
      if (attempt === attempts-1) throw new ApiError(503,'Platform delivery failed; retain the same delivery id for retry');
    }
    if (response?.ok) {
      const result=await response.json();
      requireThat(result.deliveryId === batch.deliveryId && result.labelId === batch.labelId && result.platform === platform,'Engine acknowledgement did not match this delivery',502);
      return result;
    }
    if (response && ![429,500,502,503,504].includes(response.status)) throw new ApiError(response.status,'Platform delivery rejected; correct the source payload or credentials');
    if (attempt === attempts-1) throw new ApiError(response?.status || 503,'Platform delivery failed; retain the same delivery id for retry');
    await response?.body?.cancel();
    await sleep(Math.min(3000,250*2**attempt),undefined,{signal});
  }
}

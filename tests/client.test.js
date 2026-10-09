import test from 'node:test';
import assert from 'node:assert/strict';
import {sendPlatformEvents} from '../src/client.js';
import {verifyWebhook} from '../src/webhooks.js';

const batch={schemaVersion:1,deliveryId:'delivery',labelId:'label',events:[{id:'event',type:'radio.listen_completed'}]};
const config={url:'https://engine.example/api/',platform:'trackzero',apiKey:'a'.repeat(40),webhookSecret:'s'.repeat(40),batch,now:()=>1900000000000};
test('Producer SDK signs exact bytes, retries the same delivery, and preserves proxy prefixes',async()=>{
  const requests=[],pauses=[];
  const result=await sendPlatformEvents({...config,sleep:async(ms)=>pauses.push(ms),fetchImpl:async(url,options)=>{
    requests.push({url,options});
    const headers=options.headers;
    assert.equal(options.redirect,'error');
    assert.match(verifyWebhook(headers,Buffer.from(options.body),config.webhookSecret,config.now()),/^[a-f0-9]{64}$/);
    if(requests.length === 1) return new Response('',{status:503});
    return new Response(JSON.stringify({deliveryId:'delivery',labelId:'label',platform:'trackzero',accepted:1}),{status:200});
  }});
  assert.equal(result.accepted,1);assert.equal(requests.length,2);assert.equal(requests[0].url.href,'https://engine.example/api/v1/platforms/trackzero/events');
  assert.equal(requests[0].options.body,requests[1].options.body);assert.deepEqual(pauses,[250]);
});
test('Producer SDK does not retry rejected credentials or send business data over public HTTP',async()=>{
  let attempts=0;
  await assert.rejects(sendPlatformEvents({...config,fetchImpl:async()=>{attempts++;return new Response('',{status:401});}}),e=>e.status===401);
  assert.equal(attempts,1);
  await assert.rejects(sendPlatformEvents({...config,url:'http://engine.example'}));
  await assert.rejects(sendPlatformEvents({...config,url:'https://user:secret@engine.example'}));
});

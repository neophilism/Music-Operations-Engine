import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../src/store.js';
import {fixture,labels,serve,secrets,credentials} from './helpers.js';

const input=(extra={})=>({labelId:'alpha',eventId:'concert',sessionId:'evening',sourceReceiptId:'count-1',
  occurredAt:'2026-01-01T12:00:00Z',attendeeCount:'9007199254740993',...extra});
const alpha=credentials.find(x=>x.id==='alpha');
test('durable aggregate retries preserve exact counts and audit once across store recreation',async()=>{
  const f=await fixture();
  try {
    await labels(f.store);
    const first=await f.store.recordAttendance(input(),alpha);
    assert.equal(first.report.attendeeCount,'9007199254740993');
    assert.equal(first.report.providerVerified,false);
    const reopened=await createStore(f.pool);
    const retry=await reopened.recordAttendance(input(),alpha);
    assert.equal(retry.duplicate,true);assert.deepEqual(retry.report,first.report);
    assert.equal((await reopened.audit()).filter(x=>x.action==='attendance.recorded').length,1);
    await assert.rejects(reopened.recordAttendance(input({attendeeCount:2}),alpha),e=>e.status===409);
    assert.equal((await reopened.attendanceReports({labelId:'alpha'},alpha))[0].attendeeCount,'9007199254740993');
  } finally {await f.close();}
});
test('concurrent matching receipts converge and conflicting receipts never overwrite',async()=>{
  const f=await fixture();
  try {
    await labels(f.store);
    const results=await Promise.all([f.store.recordAttendance(input(),alpha),f.store.recordAttendance(input(),alpha)]);
    assert.equal(results.filter(x=>!x.duplicate).length,1);
    const race=await Promise.allSettled([1,2].map(n=>f.store.recordAttendance(input({sourceReceiptId:'race',attendeeCount:n}),alpha)));
    assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(race.find(x=>x.status==='rejected').reason.status,409);
  } finally {await f.close();}
});
test('audit failure rolls back receipt and a retry can safely commit',async()=>{
  const f=await fixture();
  try {
    await labels(f.store);
    const guarded={query:(...args)=>f.pool.query(...args),connect:async()=>{
      const c=await f.pool.connect();return {release:()=>c.release(),query:(sql,params)=>{
        if(sql.includes("'attendance.recorded'")) throw new Error('synthetic audit outage');
        return c.query(sql,params);
      }};
    }};
    const failing=await createStore(guarded);
    await assert.rejects(failing.recordAttendance(input(),alpha),/synthetic audit outage/);
    assert.equal((await f.store.attendanceReports({labelId:'alpha'},alpha)).length,0);
    assert.equal((await f.store.recordAttendance(input(),alpha)).duplicate,false);
  } finally {await f.close();}
});
test('HTTP and store authorization enforce label, source and write permissions',async()=>{
  const f=await fixture();let api;
  try {
    await labels(f.store);api=await serve(f.store);
    assert.equal((await api.request('/v1/attendance',{key:'invalid',body:input()})).status,401);
    assert.equal((await api.request('/v1/attendance',{key:secrets.reader,body:input()})).status,403);
    assert.equal((await api.request('/v1/attendance',{key:secrets.alpha,body:input({labelId:'beta'})})).status,403);
    assert.equal((await api.request('/v1/attendance',{key:secrets.track,body:input()})).status,403);
    await assert.rejects(f.store.recordAttendance(input({labelId:'beta'}),alpha),e=>e.status===403);
    assert.equal((await api.request('/v1/attendance',{key:secrets.alpha,body:input()})).status,201);
    assert.equal((await api.request('/v1/attendance',{key:secrets.alpha,body:input()})).status,200);
    assert.equal((await api.request('/v1/attendance',{key:secrets.alpha,body:input({attendeeCount:1})})).status,409);
    assert.equal((await api.request('/v1/attendance?labelId=beta',{key:secrets.alpha})).status,403);
    assert.equal((await api.request('/v1/attendance?labelId=alpha',{key:secrets.track})).status,403);
    const read=await api.request('/v1/attendance?labelId=alpha&eventId=concert',{key:secrets.alpha});
    assert.equal(read.status,200);assert.equal(read.body.reports.length,1);
    assert.equal(read.body.reports[0].attendeeCount,'9007199254740993');
    for(const query of ['labelId=alpha&labelId=beta','labelId=alpha&limit=0','labelId=alpha&limit=1e2','labelId=alpha&qr=secret'])
      assert.equal((await api.request('/v1/attendance?'+query,{key:secrets.alpha})).status,400);
    for(const extra of [{customerEmail:'x@example.invalid'},{qrPayload:'secret'},{providerVerified:true}])
      assert.equal((await api.request('/v1/attendance',{key:secrets.alpha,body:input(extra)})).status,422);
    assert.equal((await api.request('/v1/attendance',{key:secrets.alpha,body:input({occurredAt:'2999-01-01'})})).status,422);
    assert.equal((await api.request('/v1/attendance',{method:'DELETE',key:secrets.alpha})).status,405);
  } finally {if(api)await api.close();await f.close();}
});
test('late deltas retain event-time ordering and cross-label receipt identities remain independent',async()=>{
  const f=await fixture();
  try {
    await labels(f.store);
    const admin=credentials.find(x=>x.id==='admin');
    await f.store.recordAttendance(input({occurredAt:'2026-02-01'}),alpha);
    await f.store.recordAttendance(input({sourceReceiptId:'late',occurredAt:'2025-12-01'}),alpha);
    await f.store.recordAttendance(input({labelId:'beta'}),admin);
    const rows=await f.store.attendanceReports({labelId:'alpha'},alpha);
    assert.equal(rows.length,2);assert.equal(rows[0].sourceReceiptId,'count-1');
    assert.equal((await f.store.attendanceReports({labelId:'beta'},admin)).length,1);
    assert.equal((await f.store.attendanceReports({labelId:'alpha',sessionId:'absent'},alpha)).length,0);
  } finally {await f.close();}
});

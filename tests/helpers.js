import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createStore} from '../src/store.js';
import {handler} from '../src/http.js';
import {loadCredentials} from '../src/auth.js';

export const secrets={admin:'a'.repeat(40),alpha:'b'.repeat(40),reader:'c'.repeat(40),track:'d'.repeat(40)};
export const credentials=loadCredentials({ENGINE_CREDENTIALS:JSON.stringify([
  {id:'admin',key:secrets.admin,labels:['*'],permissions:['read','ingest','manage']},
  {id:'alpha',key:secrets.alpha,labels:['alpha'],permissions:['read','ingest']},
  {id:'reader',key:secrets.reader,labels:['alpha','beta'],permissions:['read']},
  {id:'track',key:secrets.track,labels:['alpha'],permissions:['read','ingest'],sources:['trackzero']}
])});
export async function fixture(beforeMigrate,storeOptions={}) {
  let pool,cleanup;
  if (process.env.TEST_DATABASE_URL) {
    const schema='music_test_'+randomBytes(8).toString('hex');
    const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
    await admin.query('CREATE SCHEMA '+schema);
    pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema+',public',max:5});
    cleanup=async()=>{await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();};
  } else {
    const db=new PGlite();await db.waitReady;
    let tail=Promise.resolve();
    async function acquire() {
      let release;
      const next=new Promise(r=>{release=r;});const previous=tail;tail=next;await previous;
      return release;
    }
    const query=async(sql,params=[])=>{
      if (!params.length && sql.includes(';')) return (await db.exec(sql)).at(-1) || {rows:[]};
      return db.query(sql,params);
    };
    pool={
      async connect() { const release=await acquire();return {query,release}; },
      async query(sql,params) { const release=await acquire();try{return await query(sql,params);}finally{release();} },
      async end() { await db.close(); }
    };
    cleanup=async()=>{};
  }
  if (beforeMigrate) await beforeMigrate(pool);
  const store=await createStore(pool,storeOptions);
  return {store,pool,async close(){await store.close();await cleanup();}};
}
export async function labels(store) {
  await store.putFamily({id:'family',name:'Family of labels'});
  await store.putFamily({id:'overlap',name:'Second family'});
  await store.putLabel({id:'alpha',name:'Alpha',familyIds:['family','overlap']});
  await store.putLabel({id:'beta',name:'Beta',familyIds:['family']});
  await store.putLabel({id:'hidden',name:'Hidden',familyIds:['family']});
}
export async function catalog(store,labelId='alpha') {
  await store.putCatalog({labelId,id:'artist',kind:'artist',name:'Artist',externalIds:[{source:'trackzero',externalId:'tz-artist'},{source:'scenesignal',externalId:'ss-artist'}]});
  await store.putCatalog({labelId,id:'album',kind:'release',name:'Same Album',artistId:'artist',externalIds:[{source:'trackzero',externalId:'tz-album'},{source:'scenesignal',externalId:'ss-album'}]});
  await store.putCatalog({labelId,id:'track',kind:'track',name:'Track',artistId:'artist',releaseId:'album',isrc:'USAAA2600001',externalIds:[{source:'trackzero',externalId:'tz-track'},{source:'scenesignal',externalId:'ss-track'}]});
}
export async function serve(store,options={}) {
  const server=http.createServer(handler(store,{credentials,onError:()=>{},...options}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  return {
    async request(path,{key=secrets.admin,body,method=body ? 'POST' : 'GET',headers={}}={}) {
      const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+key,...(body ? {'Content-Type':'application/json'} : {}),...headers},body:body ? JSON.stringify(body) : undefined});
      return {status:response.status,body:await response.json()};
    },
    async close(){server.closeIdleConnections();await new Promise(r=>server.close(r));}
  };
}

import {normalizeFact,createSummary,parseCsv} from './core.js';
import {loadCredentials,authenticate,permit,permitLabel,permitSource,resolveScope} from './auth.js';
import {ApiError,requireThat} from './errors.js';
import {timestamp} from './validation.js';

export async function readBody(req) {
  const chunks=[];let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    requireThat(size <= 5_000_000,'Payload exceeds 5 MB',413);
    chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks);
  let data;
  try { data=JSON.parse(raw.toString('utf8')); } catch { throw new ApiError(400,'Invalid JSON'); }
  requireThat(data && typeof data === 'object' && !Array.isArray(data),'Request body must be an object',400);
  return {raw,data};
}
export function reply(req,res,status,value,corsOrigin) {
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if (corsOrigin && req.headers.origin === corsOrigin) {
    headers['Access-Control-Allow-Origin']=corsOrigin;headers.Vary='Origin';
    headers['Access-Control-Allow-Headers']='authorization, content-type, x-music-timestamp, x-music-signature';
    headers['Access-Control-Allow-Methods']='GET,POST,OPTIONS';
  }
  res.writeHead(status,headers);res.end(status===204 ? undefined : JSON.stringify(value));
}
export async function reportFilter(params,principal,store) {
  const scope=await resolveScope(params,principal,store);
  const from=params.has('from') ? timestamp(params.get('from'),'from') : null;
  const to=params.has('to') ? timestamp(params.get('to'),'to') : null;
  requireThat(!from || !to || from < to,'from must be earlier than to',400);
  return {...scope,from,to};
}
export async function report(store,filter) {
  const summary=createSummary();
  for await (const fact of store.iterate(filter)) summary.add(fact);
  return {...summary.value(),scope:{labelIds:filter.labelIds,selection:filter.selection,familyId:filter.familyId},from:filter.from,to:filter.to,
    partial:false,synthetic:false,generatedAt:new Date().toISOString()};
}
export function handler(store,{credentials=loadCredentials(),corsOrigin=process.env.CORS_ORIGIN,onError=console.error}={}) {
  return async (req,res)=>{
    const respond=(status,value)=>reply(req,res,status,value,corsOrigin);
    try {
      const url=new URL(req.url,'http://localhost');
      if (req.method === 'OPTIONS') return respond(204);
      if (req.method === 'GET' && url.pathname === '/health') return respond(200,{ok:await store.health(),service:'music-operations-engine'});
      const principal=authenticate(req,credentials);
      if (req.method === 'GET' && url.pathname === '/v1/scopes') {
        permit(principal,'read');
        return respond(200,await store.scopes(principal.labels.includes('*') ? null : principal.labels));
      }
      if (req.method === 'GET' && ['/v1/summary','/v1/sources','/v1/catalog'].includes(url.pathname)) {
        permit(principal,'read');
        const filter=await reportFilter(url.searchParams,principal,store);
        if (url.pathname === '/v1/sources') return respond(200,{sources:await store.sources(filter),scope:{labelIds:filter.labelIds}});
        if (url.pathname === '/v1/catalog') return respond(200,{items:await store.catalog(filter),scope:{labelIds:filter.labelIds}});
        return respond(200,await report(store,filter));
      }
      if (req.method === 'GET' && url.pathname === '/v1/audit') {
        permit(principal,'manage');return respond(200,{records:await store.audit()});
      }
      if (req.method === 'POST' && ['/v1/families','/v1/labels','/v1/catalog'].includes(url.pathname)) {
        permit(principal,'manage');const {data}=await readBody(req);
        const method={'/v1/families':'putFamily','/v1/labels':'putLabel','/v1/catalog':'putCatalog'}[url.pathname];
        return respond(200,{item:await store[method](data,principal.id)});
      }
      if (req.method === 'POST' && url.pathname === '/v1/ingest') {
        permit(principal,'ingest');const {data}=await readBody(req);
        const source=data.source || 'manual';permitSource(principal,source);
        const raw=data.csv !== undefined ? parseCsv(data.csv) : data.facts;
        requireThat(Array.isArray(raw) && raw.length <= 10000,'Provide up to 10,000 facts',400);
        const facts=raw.map(r=>normalizeFact(r,source,{labelId:data.labelId}));
        for (const fact of facts) permitLabel(principal,fact.labelId);
        return respond(200,{accepted:await store.upsert(facts,principal.id),source,labelIds:[...new Set(facts.map(f=>f.labelId))]});
      }
      return respond(404,{error:'Not found'});
    } catch(error) {
      if (error instanceof ApiError) return respond(error.status,{error:error.message});
      // Database internals and request content do not go into client responses or logs.
      onError({event:'request.failed',name:error.name,code:error.code || 'internal'});
      return respond(500,{error:'Internal service error'});
    }
  };
}

import {timingSafeEqual} from 'node:crypto';
import {ApiError, requireThat} from './errors.js';
import {identifier} from './validation.js';

export function loadCredentials(env = process.env) {
  let configured = [];
  if (env.ENGINE_CREDENTIALS) {
    try { configured = JSON.parse(env.ENGINE_CREDENTIALS); }
    catch { throw new Error('ENGINE_CREDENTIALS must be a JSON array'); }
  }
  requireThat(Array.isArray(configured), 'ENGINE_CREDENTIALS must be an array');
  const credentials = [...configured];
  if (env.ENGINE_API_KEY) credentials.push({id:'bootstrap',key:env.ENGINE_API_KEY,labels:['*'],permissions:['read','ingest','manage']});
  requireThat(credentials.length > 0 && credentials.length <= 100, 'Configure 1–100 engine credentials');
  const ids = new Set(), keys = new Set();
  return credentials.map(c => {
    identifier(c.id, 'credential id');
    requireThat(typeof c.key === 'string' && c.key.length >= 32 && c.key.length <= 256, 'Credential secrets must be 32–256 characters');
    requireThat(!ids.has(c.id) && !keys.has(c.key), 'Credential ids and secrets must be unique');
    ids.add(c.id); keys.add(c.key);
    requireThat(Array.isArray(c.labels) && c.labels.length > 0 && c.labels.length <= 1000, 'Each credential requires explicit label access');
    requireThat(!c.labels.includes('*') || c.labels.length === 1, 'Wildcard label access must stand alone');
    c.labels.filter(x=>x !== '*').forEach(x=>identifier(x,'authorized label'));
    requireThat(Array.isArray(c.permissions) && c.permissions.length > 0 && c.permissions.every(p=>['read','ingest','manage'].includes(p)), 'Invalid credential permissions');
    requireThat(!c.permissions.includes('manage') || c.labels[0] === '*', 'Label registry management requires system-wide authority');
    if (c.sources !== undefined) {
      requireThat(Array.isArray(c.sources) && c.sources.length > 0, 'sources must be a nonempty allowlist');
      c.sources.forEach(s=>identifier(s,'source'));
    }
    return {...c,labels:[...new Set(c.labels)],permissions:[...new Set(c.permissions)]};
  });
}
export function authenticate(req, credentials) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new ApiError(401,'Unauthorized');
  const supplied = Buffer.from(match[1]);
  let principal;
  for (const c of credentials) {
    const key = Buffer.from(c.key);
    if (supplied.length === key.length && timingSafeEqual(supplied,key)) principal = c;
  }
  if (!principal) throw new ApiError(401,'Unauthorized');
  return principal;
}
export async function authenticateRequest(req,credentials,store,now=new Date()) {
  try { return authenticate(req,credentials); }
  catch(error) {
    if (!(error instanceof ApiError) || error.status!==401) throw error;
    const match=/^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    if (!match) throw error;
    const principal=await store.authenticateSession(match[1],now);
    if (!principal) throw error;
    return principal;
  }
}
export function permit(principal, permission) {
  requireThat(principal.permissions.includes(permission), 'Forbidden', 403);
}
export function permitLabel(principal, labelId) {
  identifier(labelId,'labelId');
  requireThat(principal.labels.includes('*') || principal.labels.includes(labelId),'Label access denied',403);
}
export function permitSource(principal, source) {
  identifier(source,'source');
  requireThat(!principal.sources || principal.sources.includes(source),'Source access denied',403);
}
export async function resolveScope(params, principal, store) {
  const menu = await store.scopes(principal.labels.includes('*') ? null : principal.labels);
  const selected = ['labelId','labelIds','familyId'].filter(k=>params.has(k));
  requireThat(selected.length <= 1,'Choose labelId, labelIds, or familyId, not multiple scope selectors',400);
  for (const key of ['labelId','labelIds','familyId','source','from','to']) requireThat(params.getAll(key).length <= 1,`Repeated ${key} parameter`,400);
  let labelIds = menu.labels.map(l=>l.id);
  if (params.has('labelId')) labelIds = [identifier(params.get('labelId'),'labelId')];
  if (params.has('labelIds')) {
    labelIds = [...new Set(params.get('labelIds').split(','))];
    requireThat(labelIds.length > 0 && labelIds.length <= 1000,'Select 1–1000 labels',400);
    labelIds.forEach(x=>identifier(x,'labelId'));
  }
  if (params.has('familyId')) {
    const id=identifier(params.get('familyId'),'familyId');
    const family=menu.families.find(f=>f.id===id);
    requireThat(family,'Family not found in accessible labels',404);
    labelIds=family.labelIds;
  }
  for (const labelId of labelIds) {
    permitLabel(principal,labelId);
    requireThat(menu.labels.some(l=>l.id===labelId),'Label not found',404);
  }
  let sources=principal.sources || null;
  if (params.has('source')) { const source=params.get('source'); permitSource(principal,source); sources=[source]; }
  return {labelIds,sources,selection:selected[0] || 'all',familyId:params.get('familyId') || null};
}

import {createHash,randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {requireThat} from './errors.js';
import {identifier} from './validation.js';

const scrypt=promisify(scryptCallback);
export const sessionLifetimeMs=15*60*1000;
const rolePermissions={
  tenant_admin:['read','ingest','manage'],
  label_manager:['read','ingest'],
  team_member:['read'],
  artist:['read']
};

export function normalizeAccount(raw) {
  requireThat(raw && typeof raw==='object' && !Array.isArray(raw),'Account must be an object',400);
  const email=String(raw.email || '').trim().toLowerCase();
  requireThat(email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Invalid account email',400);
  requireThat(typeof raw.password==='string' && raw.password.length>=14 && raw.password.length<=256,'Password must be 14–256 characters',400);
  requireThat(Object.hasOwn(rolePermissions,raw.role),'Invalid account role',400);
  requireThat(Array.isArray(raw.labelIds),'labelIds must be an array',400);
  const labelIds=[...new Set(raw.labelIds)];
  if (raw.role==='tenant_admin') requireThat(labelIds.length===1 && labelIds[0]==='*','Tenant administrators require system-wide scope',400);
  else {
    requireThat(labelIds.length>0 && labelIds.length<=1000 && !labelIds.includes('*'),'Scoped roles require 1–1000 explicit labels',400);
    labelIds.forEach(x=>identifier(x,'account label'));
  }
  return {email,password:raw.password,role:raw.role,labelIds,permissions:rolePermissions[raw.role]};
}

export async function passwordDigest(password,salt=randomBytes(16)) {
  const digest=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return {salt:salt.toString('hex'),hash:Buffer.from(digest).toString('hex')};
}

export async function passwordMatches(password,salt,expected) {
  const actual=await passwordDigest(password,Buffer.from(salt,'hex'));
  const a=Buffer.from(actual.hash,'hex'),b=Buffer.from(expected,'hex');
  return a.length===b.length && timingSafeEqual(a,b);
}

export function issueBearer(now=new Date(),lifetimeMs=sessionLifetimeMs) {
  requireThat(lifetimeMs>0 && lifetimeMs<=sessionLifetimeMs,'Session lifetime exceeds policy');
  const token=randomBytes(32).toString('base64url');
  return {
    id:randomUUID(),token,tokenHash:tokenDigest(token),createdAt:now,
    expiresAt:new Date(now.getTime()+lifetimeMs)
  };
}

export function tokenDigest(token) {
  return createHash('sha256').update('account-session\0'+token,'utf8').digest('hex');
}

export function principalFromAccount(account,sessionId) {
  return {id:account.id,accountId:account.id,sessionId,role:account.role,
    labels:account.labelIds,permissions:rolePermissions[account.role]};
}

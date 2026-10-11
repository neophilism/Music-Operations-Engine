import {randomUUID} from 'node:crypto';
import {requireThat} from './errors.js';
import {identifier,timestamp} from './validation.js';

export const jobLeaseMs=5*60*1000;

export function normalizeJob(raw,now=new Date()) {
  requireThat(raw && typeof raw==='object' && !Array.isArray(raw),'Job must be an object',400);
  requireThat(['ingest','resync'].includes(raw.kind),'Invalid job kind',400);
  const source=identifier(raw.source,'source'),labelId=identifier(raw.labelId,'labelId');
  const payload=raw.payload ?? {};
  requireThat(payload && typeof payload==='object' && !Array.isArray(payload),'Job payload must be an object',400);
  requireThat(Buffer.byteLength(JSON.stringify(payload),'utf8')<=65536,'Job payload exceeds 64 KiB',413);
  const maxAttempts=raw.maxAttempts===undefined ? 3 : raw.maxAttempts;
  requireThat(Number.isInteger(maxAttempts) && maxAttempts>=1 && maxAttempts<=10,'maxAttempts must be 1–10',400);
  const availableAt=raw.availableAt===undefined ? now.toISOString() : timestamp(raw.availableAt,'availableAt');
  return {id:randomUUID(),kind:raw.kind,source,labelId,payload,maxAttempts,availableAt};
}

export function normalizeFailure(raw,now=new Date()) {
  requireThat(raw && typeof raw==='object' && !Array.isArray(raw),'Failure must be an object',400);
  const errorCode=identifier(raw.errorCode,'errorCode');
  const retryAt=raw.retryAt===undefined ? new Date(now.getTime()+60_000).toISOString() : timestamp(raw.retryAt,'retryAt');
  requireThat(new Date(retryAt)>now,'retryAt must be in the future',400);
  requireThat(new Date(retryAt).getTime()-now.getTime()<=24*60*60*1000,'retryAt exceeds the 24-hour retry bound',400);
  return {errorCode,retryAt};
}

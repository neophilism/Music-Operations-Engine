import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {identifier,title} from './validation.js';
import {requireThat} from './errors.js';

const capabilities=new Set(['full_backfill','incremental_backfill','poll','webhook']);
const aad=Buffer.from('music-operations-engine:connector-credential:v1');

function object(value,name) {
  requireThat(value && typeof value==='object' && !Array.isArray(value),name+' must be an object');
  return value;
}
function connectorKey(encoded) {
  requireThat(typeof encoded==='string' && /^[A-Za-z0-9+/]{43}=$/.test(encoded),'CONNECTOR_MASTER_KEY must be one base64-encoded 32-byte key',503);
  const key=Buffer.from(encoded,'base64');
  requireThat(key.length===32,'CONNECTOR_MASTER_KEY must be one base64-encoded 32-byte key',503);
  return key;
}
function cursor(value) {
  requireThat(value===null || (typeof value==='string' && value.length<=512),'backfillCursor must be null or at most 512 characters');
  return value;
}

export function normalizeConnector(raw) {
  object(raw,'connector');
  const mapping=object(raw.fieldMapping,'fieldMapping');
  const fieldMapping={};
  for (const key of Object.keys(mapping).sort()) fieldMapping[identifier(key,'field mapping key')]=identifier(mapping[key],'field mapping value');
  const requested=Array.isArray(raw.capabilities) ? raw.capabilities : [];
  requireThat(requested.length>0 && requested.every(value=>capabilities.has(value)),'capabilities must contain supported connector operations');
  return {
    labelId:identifier(raw.labelId,'labelId'),
    source:identifier(raw.source,'source'),
    displayName:title(raw.displayName,'displayName'),
    adapterVersion:identifier(raw.adapterVersion,'adapterVersion'),
    capabilities:[...new Set(requested)].sort(),
    fieldMapping,
    backfillCursor:cursor(raw.backfillCursor ?? null)
  };
}

export function normalizeBackfillCursor(value) {
  return cursor(value);
}

export function encryptConnectorCredential(secret,encodedKey) {
  requireThat(typeof secret==='string' && secret.length>=1 && Buffer.byteLength(secret)<=16384,'connector credential must be 1–16384 UTF-8 bytes');
  const key=connectorKey(encodedKey),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return {
    ciphertext:ciphertext.toString('base64'),
    iv:iv.toString('base64'),
    authTag:cipher.getAuthTag().toString('base64'),
    keyVersion:createHash('sha256').update(key).digest('hex').slice(0,16)
  };
}

export function decryptConnectorCredential(envelope,encodedKey) {
  object(envelope,'credential envelope');
  const key=connectorKey(encodedKey),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(envelope.authTag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8');
}

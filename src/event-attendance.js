import {createHash} from 'node:crypto';
import {identifier,integer,timestamp} from './validation.js';
import {requireThat} from './errors.js';

const fields=['labelId','eventId','sessionId','sourceReceiptId','occurredAt','attendeeCount'];
/** Prepare a manual aggregate, not a verified ticket or provider settlement. */
export function prepareOfflineAttendance(input,{labelId,asOf}={}) {
  requireThat(input && Object.getPrototypeOf(input)===Object.prototype &&
    Reflect.ownKeys(input).length===fields.length &&
    fields.every(key=>Object.hasOwn(input,key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(input,key),'value')),
    'attendance report must contain only aggregate fields');
  const scope=identifier(labelId,'labelId');
  requireThat(identifier(input.labelId,'report labelId')===scope,'attendance label mismatch');
  const eventId=identifier(input.eventId,'eventId');
  const sessionId=identifier(input.sessionId,'sessionId');
  const sourceReceiptId=identifier(input.sourceReceiptId,'sourceReceiptId');
  const occurredAt=timestamp(input.occurredAt);
  const observedAt=timestamp(asOf,'asOf');
  requireThat(occurredAt<=observedAt,'attendance report is dated in the future');
  const count=integer(input.attendeeCount,'attendeeCount');
  requireThat(count>0n,'attendeeCount must be positive');
  const id=createHash('sha256').update([scope,eventId,sessionId,sourceReceiptId].join('\0')).digest('hex');
  const contentHash=createHash('sha256').update([id,occurredAt,count.toString()].join('\0')).digest('hex');
  return Object.freeze({id,contentHash,labelId:scope,eventId,sessionId,sourceReceiptId,
    occurredAt,attendeeCount:count.toString(),provenance:'manual_attested',
    providerVerified:false,isLive:false});
}

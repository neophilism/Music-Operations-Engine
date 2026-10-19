import {createHash} from 'node:crypto';
import {parseCsv} from './core.js';
import {requireThat} from './errors.js';
import {identifier} from './validation.js';

const allowedStatuses=new Set(['reported','pending','settled','reversed']);
// This importer currently has a fixed two-decimal amount format. Fail closed for
// currencies whose ISO 4217 minor-unit exponent has not been implemented here.
const twoDecimalCurrencies=new Set(['USD','EUR','GBP']);
function nonempty(value,name,max=256) {
  requireThat(typeof value==='string' && value.trim().length>0 && value.trim().length<=max,name+' is required');
  return value.trim();
}
function cents(raw,name) {
  const value=nonempty(String(raw ?? ''),name,64);
  requireThat(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value),name+' requires a decimal amount with at most two fraction digits');
  const negative=value.startsWith('-');
  const [whole,fraction='']=value.replace(/^-/, '').split('.');
  const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  requireThat(result<=9223372036854775807n,name+' exceeds supported 64-bit minor-unit range');
  return (negative ? -result : result).toString();
}
function date(raw,name) {
  const value=nonempty(raw,name,32);
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,name+' requires a valid YYYY-MM-DD date');
  return value;
}
/**
 * Import an explicitly mapped distributor export. Never assume CSV data is a
 * live provider feed or that a reported amount has already been disbursed.
 * Rows are normalized, not posted to the royalty ledger.
 */
export function parseDistributorStatement(csv,{labelId,source='distributor_csv',mapping}={}) {
  labelId=identifier(labelId,'labelId');
  source=identifier(source,'source');
  requireThat(mapping && typeof mapping==='object' && !Array.isArray(mapping),'explicit column mapping required');
  const needed=['externalId','occurredAt','isrc','currency','gross','fees','net','payoutStatus'];
  for(const key of needed) nonempty(mapping[key],key+' column');
  const rows=parseCsv(csv);
  requireThat(rows.length<=10000,'statement exceeds 10000 rows');
  const seen=new Set();
  return rows.map((row,index)=>{
    for(const key of needed) requireThat(Object.hasOwn(row,mapping[key]),'missing column '+mapping[key]+' at row '+(index+2));
    const externalId=nonempty(row[mapping.externalId],'externalId');
    requireThat(!seen.has(externalId),'duplicate externalId within statement');
    seen.add(externalId);
    const isrc=nonempty(row[mapping.isrc],'ISRC',12).toUpperCase();
    requireThat(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc),'invalid ISRC');
    const currency=nonempty(row[mapping.currency],'currency',3).toUpperCase();
    requireThat(twoDecimalCurrencies.has(currency),'unsupported currency minor-unit exponent');
    const payoutStatus=nonempty(row[mapping.payoutStatus],'payoutStatus',20).toLowerCase();
    requireThat(allowedStatuses.has(payoutStatus),'unsupported payout status');
    const grossMinor=BigInt(cents(row[mapping.gross],'gross'));
    const feesMinor=BigInt(cents(row[mapping.fees],'fees'));
    const netMinor=BigInt(cents(row[mapping.net],'net'));
    requireThat(grossMinor-feesMinor===netMinor,'gross minus fees must equal net');
    const reversesExternalId=mapping.reversesExternalId ? String(row[mapping.reversesExternalId]??'').trim() : '';
    requireThat(payoutStatus==='reversed' ? reversesExternalId.length>0 : reversesExternalId.length===0,
      'only reversed rows require an original transaction reference');
    requireThat(reversesExternalId.length<=256 && reversesExternalId!==externalId,'invalid reversal reference');
    requireThat(payoutStatus!=='reversed' || netMinor<0n,'reversal net must be negative');
    const settlementId=mapping.settlementId ? String(row[mapping.settlementId]??'').trim() : '';
    requireThat(settlementId.length<=256,'settlement reference is too long');
    requireThat(payoutStatus!=='settled'||settlementId.length>0,'settled row requires settlement reference');
    const id=createHash('sha256').update([labelId,source,externalId].join('\0')).digest('hex');
    return {id,labelId,source,externalId,isrc,occurredAt:date(row[mapping.occurredAt],'occurredAt'),
      currency,grossMinor:grossMinor.toString(),feesMinor:feesMinor.toString(),netMinor:netMinor.toString(),
      payoutStatus,settlementId:settlementId||null,reversesExternalId:reversesExternalId||null,provenance:'imported_csv',isLive:false};
  });
}

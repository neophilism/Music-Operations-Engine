import {requireThat} from './errors.js';

export function identifier(value, name = 'id') {
  requireThat(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value), `${name} must be a stable identifier (1–128 characters)`);
  return value;
}
export function title(value, name = 'name') {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= 200, `${name} is required (max 200 characters)`);
  return value.trim();
}
export function integer(value, name, {signed = false, max = 9223372036854775807n} = {}) {
  requireThat((typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^-?\d{1,256}$/.test(value)), `${name} must be an exact integer`);
  const n = BigInt(value);
  requireThat((signed || n >= 0n) && n <= max && n >= -max, `${name} is outside the supported range`);
  return n;
}
export function exact(n) {
  const value = BigInt(n);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
}
export function timestamp(value, name = 'occurredAt') {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value), `${name} must be an ISO date or timestamp with timezone`);
  const date = new Date(value);
  requireThat(!Number.isNaN(date.getTime()), `Invalid ${name}`);
  // Reject normalized invalid calendar dates such as February 30, including zoned timestamps.
  const calendar = value.slice(0,10);
  requireThat(new Date(calendar).toISOString().slice(0,10) === calendar, `Invalid ${name}`);
  return date.toISOString();
}

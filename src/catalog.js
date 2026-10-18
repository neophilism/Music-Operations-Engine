import {requireThat} from './errors.js';
import {identifier, title} from './validation.js';

export function normalizeFamily(raw) { return {id:identifier(raw.id),name:title(raw.name)}; }
export function normalizeLabel(raw) {
  const familyIds=raw.familyIds ?? [];
  requireThat(Array.isArray(familyIds) && familyIds.length <= 100,'familyIds must be an array of up to 100 families');
  return {id:identifier(raw.id),name:title(raw.name),familyIds:[...new Set(familyIds.map(id=>identifier(id,'familyId')))]};
}
export function normalizeCatalog(raw) {
  requireThat(raw && typeof raw==='object' && !Array.isArray(raw),'Catalog item must be an object');
  requireThat(['artist','release','track'].includes(raw.kind),'Catalog kind must be artist, release, or track');
  const artistId=raw.artistId ? identifier(raw.artistId,'artistId') : null;
  const releaseId=raw.releaseId ? identifier(raw.releaseId,'releaseId') : null;
  requireThat(raw.kind === 'artist' ? !artistId && !releaseId : Boolean(artistId),'Releases and tracks require their primary artistId');
  requireThat(raw.kind === 'track' ? Boolean(releaseId) : !releaseId,'Tracks require a releaseId; artists and releases cannot have one');
  requireThat(!raw.isrc || (raw.kind === 'track' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(raw.isrc)),'Invalid track ISRC');
  requireThat(!raw.upc || (raw.kind === 'release' && /^\d{12,13}$/.test(raw.upc)),'Invalid release UPC');
  const externalIds=raw.externalIds ?? [];
  requireThat(Array.isArray(externalIds) && externalIds.length <= 100,'externalIds must contain up to 100 mappings');
  const mappings=externalIds.map(m=>{
    requireThat(m && typeof m==='object' && !Array.isArray(m),'external mapping must be an object');
    return {source:identifier(m.source,'source'),externalId:identifier(m.externalId,'externalId')};
  });
  requireThat(new Set(mappings.map(m=>JSON.stringify([m.source,m.externalId]))).size===mappings.length,
    'Duplicate external mapping within catalog item');
  return {id:identifier(raw.id),labelId:identifier(raw.labelId,'labelId'),kind:raw.kind,name:title(raw.name),artistId,releaseId,isrc:raw.isrc||null,upc:raw.upc||null,
    externalIds:mappings};
}

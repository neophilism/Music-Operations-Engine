import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCatalog} from '../src/catalog.js';
const item=()=>({id:'track-one',labelId:'label-one',kind:'track',name:'Track One',artistId:'artist-one',releaseId:'release-one',isrc:'USABC1234567',externalIds:[{source:'provider-one',externalId:'track-1'}]});
test('catalog mapping preserves exact scoped identity',()=>{
  const normalized=normalizeCatalog(item());
  assert.equal(normalized.labelId,'label-one');assert.equal(normalized.isrc,'USABC1234567');
  assert.deepEqual(normalized.externalIds,[{source:'provider-one',externalId:'track-1'}]);
});
test('duplicate, null and malformed mappings reject without raw TypeError',()=>{
  assert.throws(()=>normalizeCatalog({...item(),externalIds:[...item().externalIds,...item().externalIds]}),/Duplicate external mapping/);
  assert.throws(()=>normalizeCatalog({...item(),externalIds:[null]}),/external mapping must be an object/);
  assert.throws(()=>normalizeCatalog(null),/Catalog item must be an object/);
});

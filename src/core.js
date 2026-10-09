import {createHash} from 'node:crypto';
import {requireThat} from './errors.js';
import {identifier, integer, exact, timestamp} from './validation.js';

export const TYPES = ['sale','stream','play','attendance','event','refund','royalty'];
export function normalizeFact(raw, source='manual', context={}) {
  requireThat(raw && typeof raw === 'object' && !Array.isArray(raw),'Fact must be an object');
  source=identifier(source,'source');
  const labelId=identifier(context.labelId || raw.labelId || 'default','labelId');
  requireThat(!raw.labelId || raw.labelId === labelId,'Fact label must match its ingestion scope');
  const type=String(raw.type || '').toLowerCase();
  requireThat(TYPES.includes(type),'Invalid fact type');
  const occurredAt=timestamp(raw.occurredAt || raw.date);
  const quantity=integer(raw.quantity ?? 1,'quantity');
  const amountMinor=integer(raw.amountMinor ?? 0,'amountMinor',{signed:type === 'royalty'});
  requireThat(['sale','refund','royalty'].includes(type) || amountMinor === 0n,'Only financial facts can carry monetary amounts');
  const currency=String(raw.currency || 'USD').toUpperCase();
  requireThat(/^[A-Z]{3}$/.test(currency),'Invalid currency');
  const externalId=String(raw.externalId || '').trim();
  requireThat(externalId.length > 0 && externalId.length <= 256 && !externalId.includes('\0'),'externalId required (max 256 characters, no NUL)');
  const names={artist:'Unknown',release:'',track:'',channel:'',territory:''};
  for (const [key,fallback] of Object.entries(names)) {
    names[key]=String(raw[key] ?? fallback);
    requireThat(names[key].length <= (key === 'territory' ? 8 : 200),`${key} is too long`);
  }
  const metadata=raw.metadata ?? {};
  requireThat(metadata && typeof metadata === 'object' && !Array.isArray(metadata),'metadata must be an object');
  requireThat(Buffer.byteLength(JSON.stringify(metadata)) <= 16384,'metadata exceeds 16 KiB');
  const result={source,labelId,externalId,type,occurredAt,quantity:exact(quantity),amountMinor:exact(amountMinor),currency,...names,
    artistId:raw.artistId ? identifier(raw.artistId,'artistId') : null,
    releaseId:raw.releaseId ? identifier(raw.releaseId,'releaseId') : null,
    trackId:raw.trackId ? identifier(raw.trackId,'trackId') : null,metadata};
  result.id=createHash('sha256').update(labelId+'\0'+source+'\0'+externalId).digest('hex');
  return result;
}
const countKeys=['sales','streams','plays','attendees','events','royalties'];
const typeCounts={sale:'sales',stream:'streams',play:'plays',attendance:'attendees',event:'events',royalty:'royalties'};
function bucket() { return {counts:Object.fromEntries(countKeys.map(k=>[k,0n])),currencies:new Map(),factCount:0n}; }
function add(bucket,fact) {
  bucket.factCount++;
  const key=typeCounts[fact.type];
  if (key) bucket.counts[key]+=BigInt(fact.quantity);
  if (['sale','refund','royalty'].includes(fact.type)) {
    if (!bucket.currencies.has(fact.currency)) bucket.currencies.set(fact.currency,{salesMinor:0n,refundsMinor:0n,royaltiesMinor:0n});
    bucket.currencies.get(fact.currency)[{sale:'salesMinor',refund:'refundsMinor',royalty:'royaltiesMinor'}[fact.type]]+=BigInt(fact.amountMinor);
  }
}
function publicBucket(b) {
  return {counts:Object.fromEntries(Object.entries(b.counts).map(([k,v])=>[k,exact(v)])),
    currencies:Object.fromEntries([...b.currencies].map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([key,n])=>[key,exact(n)]))])),factCount:exact(b.factCount)};
}
function group(map,key,details,fact) {
  if (!map.has(key)) map.set(key,{...details,bucket:bucket()});
  add(map.get(key).bucket,fact);
}
export function createSummary() {
  const total=bucket(),labels=new Map(),sources=new Map(),releases=new Map(),artists=new Map(),tracks=new Map(),daily=new Map();
  return {
    add(fact) {
      add(total,fact);
      const labelId=fact.labelId || 'default';
      group(labels,labelId,{labelId},fact);
      group(sources,fact.source,{source:fact.source},fact);
      group(releases,labelId+':'+(fact.releaseId || fact.release || 'Unassigned'),{labelId,id:fact.releaseId || null,title:fact.release || 'Unassigned'},fact);
      group(artists,labelId+':'+(fact.artistId || fact.artist),{labelId,id:fact.artistId || null,name:fact.artist},fact);
      if (fact.trackId || fact.track) group(tracks,labelId+':'+(fact.trackId || fact.track),{labelId,id:fact.trackId || null,title:fact.track,releaseId:fact.releaseId},fact);
      group(daily,fact.occurredAt.slice(0,10),{date:fact.occurredAt.slice(0,10)},fact);
    },
    value() {
      const listing=m=>[...m.values()].map(({bucket:b,...details})=>({...details,...publicBucket(b)}));
      return {...publicBucket(total),
        byLabel:Object.fromEntries(listing(labels).map(l=>[l.labelId,l])),
        bySource:Object.fromEntries(listing(sources).map(s=>[s.source,{...s,facts:s.factCount,streams:s.counts.streams,sales:s.counts.sales}])),
        byRelease:Object.fromEntries([...releases].map(([key,{bucket:b,...r}])=>[key,{...r,...publicBucket(b),sales:exact(b.counts.sales),streams:exact(b.counts.streams),plays:exact(b.counts.plays)}])),
        artists:listing(artists),tracks:listing(tracks),
        daily:listing(daily).sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,sales:d.counts.sales,streams:d.counts.streams,plays:d.counts.plays}))};
    }
  };
}
export function summarize(facts) {
  const summary=createSummary();
  for (const fact of facts) summary.add(fact);
  return summary.value();
}
export function parseCsv(csv) {
  if(typeof csv!=="string"||csv.length>5_000_000)throw Error("CSV must be text under 5MB");
  const rows=[];let row=[],field="",quote=false;
  for(let i=0;i<csv.length;i++){
    const ch=csv[i];
    if(quote){if(ch==='"'&&csv[i+1]==='"'){field+='"';i++}else if(ch==='"')quote=false;else field+=ch}
    else if(ch==='"')quote=true;else if(ch===","){row.push(field);field=""}
    else if(ch==="\n"){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field=""}
    else field+=ch;
  }
  if(quote)throw Error("Unclosed CSV quote");
  if(field||row.length){row.push(field);rows.push(row)}
  if(!rows.length)return [];
  const head=rows.shift().map(x=>x.trim());
  return rows.filter(r=>r.some(x=>x.trim())).map((r,i)=>{if(r.length!==head.length)throw Error("CSV column mismatch row "+(i+2));return Object.fromEntries(head.map((key,j)=>[key,r[j]]))});
}


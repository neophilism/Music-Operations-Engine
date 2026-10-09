import {createHash} from "node:crypto";
export const TYPES = ["sale","stream","play","attendance","event","refund","royalty"];
export function normalizeFact(raw, source="manual") {
  if (!raw || typeof raw !== "object") throw Error("Fact must be an object");
  const type=String(raw.type||"").toLowerCase();
  if(!TYPES.includes(type)) throw Error("Invalid fact type");
  const occurredAt=new Date(raw.occurredAt||raw.date);
  if(Number.isNaN(occurredAt.getTime())) throw Error("Valid date required");
  const quantity=Number(raw.quantity??1);
  const amountMinor=Number(raw.amountMinor??0);
  if(!Number.isSafeInteger(quantity)||quantity<0||!Number.isSafeInteger(amountMinor)) throw Error("Integer quantities and minor-unit amounts required");
  const currency=String(raw.currency||"USD").toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) throw Error("Invalid currency");
  const externalId=String(raw.externalId||"").trim();
  if(!externalId||externalId.length>256) throw Error("externalId required (max 256)");
  const result={source:String(source).slice(0,80),externalId,type,occurredAt:occurredAt.toISOString(),quantity,amountMinor,currency,artist:String(raw.artist||"Unknown").slice(0,200),release:String(raw.release||"").slice(0,200),track:String(raw.track||"").slice(0,200),channel:String(raw.channel||"").slice(0,100),territory:String(raw.territory||"").slice(0,8),metadata:raw.metadata&&typeof raw.metadata==="object"&&!Array.isArray(raw.metadata)?raw.metadata:{}};
  result.id=createHash("sha256").update(result.source+"\0"+result.externalId).digest("hex");
  return result;
}
export function summarize(facts) {
  const currencies={},bySource={},byRelease={},counts={sales:0,streams:0,plays:0,attendees:0,events:0,royalties:0},daily={};
  for(const fact of facts){
    const qty=Number(fact.quantity), amount=Number(fact.amountMinor);
    if(fact.type==="sale")counts.sales+=qty;
    if(fact.type==="stream")counts.streams+=qty;
    if(fact.type==="play")counts.plays+=qty;
    if(fact.type==="attendance")counts.attendees+=qty;
    if(fact.type==="event")counts.events+=qty;
    if(fact.type==="royalty")counts.royalties+=qty;
    const money=currencies[fact.currency]??={salesMinor:0,refundsMinor:0,royaltiesMinor:0};
    if(fact.type==="sale")money.salesMinor+=amount;
    if(fact.type==="refund")money.refundsMinor+=amount;
    if(fact.type==="royalty")money.royaltiesMinor+=amount;
    const src=bySource[fact.source]??={facts:0,streams:0,sales:0};
    src.facts++;if(fact.type==="stream")src.streams+=qty;if(fact.type==="sale")src.sales+=qty;
    const release=byRelease[fact.release||"Unassigned"]??={sales:0,streams:0,plays:0};
    if(fact.type==="sale")release.sales+=qty;if(fact.type==="stream")release.streams+=qty;if(fact.type==="play")release.plays+=qty;
    const day=fact.occurredAt.slice(0,10);const date=daily[day]??={date:day,sales:0,streams:0,plays:0};
    if(fact.type==="sale")date.sales+=qty;if(fact.type==="stream")date.streams+=qty;if(fact.type==="play")date.plays+=qty;
  }
  return {counts,currencies,bySource,byRelease,daily:Object.values(daily).sort((a,b)=>a.date.localeCompare(b.date)),factCount:facts.length};
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

import http from "node:http";
import {timingSafeEqual} from "node:crypto";
import {normalizeFact,summarize,parseCsv} from "./core.js";
import {openStore} from "./store.js";
const port=Number(process.env.PORT||4000),apiKey=process.env.ENGINE_API_KEY;
function allowed(req){const input=String(req.headers.authorization||"").replace(/^Bearer /i,"");const a=Buffer.from(input),b=Buffer.from(apiKey||"");return Boolean(apiKey)&&a.length===b.length&&timingSafeEqual(a,b)}
function reply(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":process.env.CORS_ORIGIN||"null","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"});res.end(JSON.stringify(obj))}
async function body(req){let data="";for await(const chunk of req){data+=chunk;if(data.length>5_000_000)throw Error("Payload exceeds 5MB")}return JSON.parse(data||"{}")}
export function handler(store){return async(req,res)=>{
 try{
  if(req.method==="OPTIONS")return reply(res,204,{});
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/health")return reply(res,200,{ok:await store.health(),service:"music-operations-engine"});
  if(!allowed(req))return reply(res,401,{error:"Unauthorized"});
  if(req.method==="GET"&&url.pathname==="/v1/sources")return reply(res,200,{sources:await store.sources()});
  if(req.method==="GET"&&url.pathname==="/v1/summary"){
   const from=url.searchParams.get("from"),to=url.searchParams.get("to");
   const facts=await store.list({from,to});return reply(res,200,{...summarize(facts),from,to,limit:10000,partial:facts.length===10000,synthetic:false,generatedAt:new Date().toISOString()});
  }
  if(req.method==="POST"&&url.pathname==="/v1/ingest"){
   const data=await body(req);const source=String(data.source||"manual");
   if(!/^[a-zA-Z0-9_:-]{1,80}$/.test(source))throw Error("Invalid source");
   const raw=data.csv?parseCsv(data.csv):data.facts;
   if(!Array.isArray(raw)||raw.length>10000)throw Error("Provide up to 10,000 facts");
   const normalized=raw.map(x=>normalizeFact(x,source));
   return reply(res,200,{accepted:await store.upsert(normalized),source});
  }
  return reply(res,404,{error:"Not found"});
 }catch(e){reply(res,400,{error:e.message})}
}}
if(!process.env.ENGINE_API_KEY){console.error("ENGINE_API_KEY is required");process.exit(1)}
const store=await openStore(process.env.DATABASE_URL);
const server=http.createServer(handler(store));server.listen(port,()=>console.log("Music Operations Engine listening on "+port));
process.on("SIGTERM",()=>server.close(async()=>{await store.close();process.exit(0)}));

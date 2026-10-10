import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {loadCredentials} from './auth.js';
import {openStore} from './store.js';
import {handler} from './http.js';

export {handler} from './http.js';
export async function start(env=process.env) {
  const credentials=loadCredentials(env);
  const port=Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const store=await openStore(env.DATABASE_URL);
  const server=http.createServer(handler(store,{credentials,corsOrigin:env.CORS_ORIGIN}));
  server.listen(port,()=>console.log('Music Operations Engine listening on '+port));
  const shutdown=()=>server.close(async()=>{await store.close();});
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {server,store};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(error=>{console.error(error.message);process.exitCode=1;});
}


import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for (const directory of ['src','scripts','tests']) {
  for (const file of await readdir(directory,{recursive:true})) {
    if (!/\.(?:js|mjs)$/.test(file)) continue;
    const result=spawnSync(process.execPath,['--check',directory+'/'+file],{stdio:'inherit'});
    if (result.status !== 0) process.exit(result.status || 1);
  }
}

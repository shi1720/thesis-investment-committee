import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

function run(args){const result=spawnSync(process.execPath,args,{stdio:'inherit',cwd:process.cwd()});if(result.status!==0)process.exit(result.status??1);}
if(!existsSync('node_modules/vinext')){console.error('Run npm ci first.');process.exit(1);}
run(['scripts/run-framework.mjs','build']);
mkdirSync('.sites-runtime',{recursive:true});
const ledgerPath='.sites-runtime/local-migrations.json';
const ledger=existsSync(ledgerPath)?JSON.parse(readFileSync(ledgerPath,'utf8')):{};
for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort()){
 const path='drizzle/'+name;const hash=createHash('sha256').update(readFileSync(path)).digest('hex');
 if(ledger[name]){if(ledger[name]!==hash)throw new Error(`Applied migration ${name} changed. Restore it and create a new migration.`);continue;}
 run(['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file',path]);
 ledger[name]=hash;writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
}
console.log('Thesis is ready. Run npm run dev, then open the printed URL and choose Sign in. Local preview uses a synthetic development account.');

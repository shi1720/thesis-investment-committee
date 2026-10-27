import {build} from 'esbuild';
import {resolve} from 'node:path';
import {existsSync,statSync} from 'node:fs';
const root=process.cwd();
const replacements=new Map([
 [resolve(root,'lib/server/store.ts'),resolve(root,'server/firebase/store.ts')],
 [resolve(root,'app/chatgpt-auth.ts'),resolve(root,'server/firebase/auth.ts')],
]);
await build({entryPoints:['server/api.ts'],outfile:'dist/api/server.mjs',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',sourcemap:true,plugins:[{name:'thesis-portable-runtime',setup(builder){builder.onResolve({filter:/.*/},args=>{
 if(args.path==='cloudflare:workers')return {path:resolve(root,'server/firebase/env.ts')};
 const candidate=args.path.startsWith('@/')?resolve(root,args.path.slice(2)):args.path.startsWith('.')?resolve(args.resolveDir,args.path):null;
 if(candidate){const match=replacements.get(candidate)||replacements.get(candidate+'.ts');if(match)return {path:match};if(args.path.startsWith('@/')){const file=[candidate,candidate+'.ts',candidate+'.tsx',resolve(candidate,'index.ts')].find(p=>existsSync(p)&&statSync(p).isFile());if(file)return {path:file};}}
 return null;
 });}}]});
console.log('Built portable Node API with Firebase Auth, Firestore persistence and durable connected-job dispatch.');

import {createServer,type IncomingMessage} from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {handlePlatformRoute} from './platform/routes';
import {executePlatformJob} from './platform/executor';
import {responseToNode} from './firebase/node-response';
import * as bootstrap from '../app/api/bootstrap/route';
import * as health from '../app/api/health/route';
import * as history from '../app/api/runs/route';
import * as runRecord from '../app/api/runs/[id]/route';
import * as report from '../app/api/runs/[id]/report/route';
import * as watchlist from '../app/api/watchlist/route';
import * as savedItem from '../app/api/watchlist/[id]/route';
import * as account from '../app/api/account/route';
import * as research from './firebase/research-route';
import {firebaseAdmin} from './firebase/admin';
import {verifyFirebaseRequest,FirebaseAuthenticationError} from './firebase/auth';
import {withFirebaseRequest} from './firebase/context';
import {verifyTaskRequest,claimJob,pendingJobs,jobStatus} from './firebase/jobs';
import {executeResearch} from '../lib/server/service';
import {completeRun,failRun,getRun} from './firebase/store';
import {json,errorResponse,HttpError,requireUser,readJson,validId} from '../lib/server/http';

type Handler=(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>;
function requestOrigin(headers:Headers){const allowed=(process.env.PUBLIC_ORIGINS??'https://thesis-investing.web.app,https://thesis-investing.firebaseapp.com').split(',').map(s=>s.trim()).filter(Boolean);const origin=headers.get('origin');return origin&&allowed.includes(origin)?origin:allowed[0];}
function webRequest(incoming:IncomingMessage):Request{const headers=new Headers();for(const[name,value]of Object.entries(incoming.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
 const path=new URL(incoming.url??'/','http://localhost').pathname+new URL(incoming.url??'/','http://localhost').search;
 const method=incoming.method??'GET';return new Request(requestOrigin(headers)+path,{method,headers,...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(incoming) as ReadableStream<Uint8Array>,duplex:'half'}:{})} as RequestInit);}
function context(id=''){return {params:Promise.resolve({id:decodeURIComponent(id)})};}
async function dispatch(request:Request):Promise<Response>{
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(process.env.PLATFORM_V2==='true'&&path==='/api/health')return handlePlatformRoute(new Request(request.url.replace('/api/health','/api/platform/health'),request));
 if(path.startsWith('/api/platform/'))return handlePlatformRoute(request);
 if(process.env.PLATFORM_V2==='true'&&['/api/bootstrap','/api/research'].includes(path))return json({error:'Use the portfolio, planning and observed-source research workspace.',code:'LEGACY_ENDPOINT_RETIRED'},410);
 if(path==='/api/jobs'&&method==='GET'){const user=await requireUser();return json({jobs:await pendingJobs(user.userId)});}
 const poll=path.match(/^\/api\/runs\/([^/]+)$/);
 if(poll&&method==='GET'){const user=await requireUser(),id=validId(decodeURIComponent(poll[1])),run=await getRun(user.userId,id);if(run)return json(run);const job=await jobStatus(user.userId,id);if(job)return json(job,job.status==='failed'?422:202);throw new HttpError(404,'Research run not found.','NOT_FOUND');}
 const routes:{test:RegExp;module:Record<string,unknown>}[]=[{test:/^\/api\/bootstrap$/,module:bootstrap},{test:/^\/api\/health$/,module:health},{test:/^\/api\/research$/,module:research},{test:/^\/api\/runs$/,module:history},{test:/^\/api\/runs\/([^/]+)\/report$/,module:report},{test:/^\/api\/runs\/([^/]+)$/,module:runRecord},{test:/^\/api\/watchlist$/,module:watchlist},{test:/^\/api\/watchlist\/([^/]+)$/,module:savedItem},{test:/^\/api\/account$/,module:account}];
 for(const route of routes){const match=path.match(route.test);if(match){const handler=route.module[method] as Handler|undefined;if(!handler)return json({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405,{Allow:Object.keys(route.module).filter(k=>/^(GET|POST|PATCH|DELETE)$/.test(k)).join(', ')});return handler(request,context(match[1]));}}
 return json({error:'API route not found.',code:'NOT_FOUND'},404);
}
async function internalJob(request:Request){if(request.method!=='POST'||!await verifyTaskRequest(request.headers))return json({error:'Task authentication required.',code:'TASK_AUTH_REQUIRED'},401);
 const body=await readJson(request,2048) as Record<string,unknown>;if(typeof body.userId!=='string'||!body.userId.startsWith('firebase:')||body.userId.length>150||typeof body.id!=='string')throw new HttpError(400,'Invalid queued research identity.','INVALID_JOB');const id=validId(body.id),userId=body.userId;
 const profile=await claimJob(userId,id);if(!profile)return new Response(null,{status:204});
 return withFirebaseRequest({user:{userId,displayName:'Background research',email:null,fullName:null},startedAt:Date.now()},async()=>{try{const{run,memorySnapshot}=await executeResearch(userId,profile,id);await completeRun(userId,run,memorySnapshot);return json({id,status:'completed'});}catch{await failRun(userId,id);return json({id,status:'failed',message:'Research failed. Inspect its private status before creating a new request.'},200);}});
}
export function createApiServer(){const server=createServer(async(incoming,out)=>{try{const request=webRequest(incoming),startedAt=Date.now();let response:Response;
 if(new URL(request.url).pathname==='/_internal/platform-jobs'){if(request.method!=='POST'||!await verifyTaskRequest(request.headers))response=json({error:'Task authentication required.'},401);else{const value=await readJson(request,2048) as Record<string,unknown>;if(typeof value.userId!=='string'||!value.userId.startsWith('firebase:')||typeof value.id!=='string')throw new HttpError(400,'Invalid job identity.','INVALID_JOB');response=json(await executePlatformJob(value.userId,validId(value.id)));}}
 else if(new URL(request.url).pathname==='/_internal/research-jobs')response=await internalJob(request);
 else{const user=await verifyFirebaseRequest(request.headers,token=>firebaseAdmin().auth.verifyIdToken(token));response=await withFirebaseRequest({user,startedAt},()=>dispatch(request));}
 await responseToNode(response,out);
 }catch(error){if(out.headersSent||out.destroyed||out.writableEnded){if(!out.destroyed)out.destroy();return;}await responseToNode(error instanceof FirebaseAuthenticationError?json({error:'Your sign-in token is invalid or expired. Sign in again.',code:error.code},401):errorResponse(error),out);}});server.requestTimeout=30_000;server.headersTimeout=10_000;return server;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.PORT??8080);createApiServer().listen(port,'0.0.0.0',()=>console.log(JSON.stringify({service:'thesis-api',port,storage:'Firestore',auth:'Firebase ID tokens',database:process.env.FIRESTORE_DATABASE_ID??'(default)'})));}

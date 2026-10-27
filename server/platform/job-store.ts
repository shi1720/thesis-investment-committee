import {CloudTasksClient} from '@google-cloud/tasks';
import {createHash} from 'node:crypto';
import {firebaseAdmin} from '../firebase/admin';
import {getUserRoot,assertAccount} from './persistence';
import {clearPlatformMemory} from './memory';
import {encodeRecord,decodeRecord} from '../firebase/codec';
import {HttpError} from '../../lib/server/http';
import type {PlatformJob,PlatformJobInput} from '../../lib/platform-contracts';
import type {ResearchAgentEvent} from '../../lib/ai/types';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const leaseMs=15*60_000;
const jobs=(userId:string)=>getUserRoot(userId).collection('platform_jobs');
export async function getPlatformJob(userId:string,id:string):Promise<PlatformJob|null>{const row=await jobs(userId).doc(id).get();return row.exists?settleExpiredJob(userId,decodeRecord<PlatformJob>(row.get('record'))):null;}
export async function listPlatformJobs(userId:string){const rows=await jobs(userId).orderBy('createdAt','desc').limit(40).get();return Promise.all(rows.docs.map(row=>settleExpiredJob(userId,decodeRecord<PlatformJob>(row.get('record')))));}
async function settleExpiredJob(userId:string,job:PlatformJob):Promise<PlatformJob>{
 const expired=(value:PlatformJob)=>['queued','running'].includes(value.status)&&Date.now()-Date.parse(value.startedAt??value.createdAt)>leaseMs;
 if(!expired(job))return job;
 return firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);const ref=jobs(userId).doc(job.id),control=getUserRoot(userId).collection('private_settings').doc('platform_lock');const[row,lock]=await Promise.all([tx.get(ref),tx.get(control)]);if(!row.exists)return job;const current=decodeRecord<PlatformJob>(row.get('record'));if(!expired(current))return current;
 const failed:PlatformJob={...current,status:'failed',updatedAt:new Date().toISOString(),completedAt:new Date().toISOString(),error:{code:'RUN_EXPIRED',message:'Completion could not be confirmed within the execution window. Recorded receipts are retained. No inference was automatically replayed.'}};
 tx.update(ref,{record:encodeRecord(failed),status:'failed'});if(lock.get('id')===job.id)tx.set(control,{id:null,startedAt:0});return failed;});
}
export async function createPlatformJob(userId:string,kind:PlatformJob['kind'],input:PlatformJobInput,key:string,workflow?:'source_review'){
 const fingerprint=hash(JSON.stringify({kind,input,workflow})),now=new Date().toISOString();
 return firebaseAdmin().db.runTransaction(async tx=>{const account=await assertAccount(tx,userId);const root=getUserRoot(userId),lookup=root.collection('platform_requests').doc(hash(key)),control=root.collection('private_settings').doc('platform_lock');const[prior,lock]=await Promise.all([tx.get(lookup),tx.get(control)]);
  if(prior.exists){if(prior.get('fingerprint')!==fingerprint)throw new HttpError(409,'This request key belongs to different inputs.','IDEMPOTENCY_CONFLICT');const old=await tx.get(jobs(userId).doc(prior.get('id')));if(old.exists)return {job:decodeRecord<PlatformJob>(old.get('record')),created:false};}
  if(lock.get('id')&&Date.now()-(lock.get('startedAt')??0)<leaseMs)throw new HttpError(409,'An agent is already working for this workspace. Open Agent runs to follow it.','RUN_IN_PROGRESS');
  const job:PlatformJob={id:crypto.randomUUID(),kind,...(workflow?{workflow}:{}),status:'queued',createdAt:now,updatedAt:now,input,memoryGeneration:account.get('memoryGeneration')??0,events:[],result:null};tx.set(jobs(userId).doc(job.id),{record:encodeRecord(job),createdAt:now,status:'queued'});tx.set(lookup,{id:job.id,fingerprint});tx.set(control,{id:job.id,startedAt:Date.now()});return {job,created:true};
 });
}
/** A deterministic task name makes bounded create retries safe; inference itself is never retried here. */
export async function enqueuePlatformJob(userId:string,id:string){if(process.env.THESIS_LOCAL_JOBS==='true'&&process.env.NODE_ENV!=='production'){setTimeout(()=>{void import('./executor').then(m=>m.executePlatformJob(userId,id)).catch(()=>{});},0);return {acknowledged:true};}const project=process.env.FIREBASE_PROJECT_ID,location=process.env.CLOUD_TASKS_LOCATION,queue=process.env.CLOUD_TASKS_QUEUE,url=process.env.CLOUD_RUN_SERVICE_URL,invoker=process.env.TASKS_INVOKER_SERVICE_ACCOUNT;if(!project||!location||!queue||!url||!invoker)throw new HttpError(503,'The background research service is not configured.','QUEUE_UNAVAILABLE');
 const client=new CloudTasksClient(),task={name:client.taskPath(project,location,queue,'platform-'+id),dispatchDeadline:{seconds:900},httpRequest:{httpMethod:'POST' as const,url:url.replace(/\/$/,'')+'/_internal/platform-jobs',headers:{'Content-Type':'application/json'},body:Buffer.from(JSON.stringify({userId,id})).toString('base64'),oidcToken:{serviceAccountEmail:invoker,audience:url.replace(/\/$/,'')}}};
 for(let attempt=0;attempt<2;attempt++)try{await client.createTask({parent:client.queuePath(project,location,queue),task},{timeout:10000,retry:null});return {acknowledged:true};}catch(error){const code=(error as {code?:number}).code;if(code===6)return {acknowledged:true};if([3,5,7,9,16].includes(code??-1))throw new HttpError(503,'The background research queue rejected this request. Check provider configuration.','QUEUE_UNAVAILABLE');if(attempt===1)return {acknowledged:false};}
 return {acknowledged:false};
}
export async function claimPlatformJob(userId:string,id:string){return firebaseAdmin().db.runTransaction(async tx=>{
 await assertAccount(tx,userId);const ref=jobs(userId).doc(id),control=getUserRoot(userId).collection('private_settings').doc('platform_lock');
 const[row,lock]=await Promise.all([tx.get(ref),tx.get(control)]);if(!row.exists)return null;
 const job=decodeRecord<PlatformJob>(row.get('record'));if(job.status!=='queued')return null;
 if(lock.get('id')!==id||Date.now()-(lock.get('startedAt')??0)>leaseMs){job.status='failed';job.error={code:'QUEUE_EXPIRED',message:'This request expired before execution. No automatic inference replay was attempted.'};job.updatedAt=new Date().toISOString();tx.update(ref,{record:encodeRecord(job),status:'failed'});if(lock.get('id')===id)tx.set(control,{id:null,startedAt:0});return null;}
 job.status='running';job.startedAt=new Date().toISOString();job.updatedAt=job.startedAt;
 tx.update(ref,{record:encodeRecord(job),status:'running'});tx.set(control,{id,startedAt:Date.now()});return job;
 });}
export async function updatePlatformJob(userId:string,id:string,change:(job:PlatformJob)=>PlatformJob){return firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);const root=getUserRoot(userId),ref=jobs(userId).doc(id),control=root.collection('private_settings').doc('platform_lock');const[row,lock]=await Promise.all([tx.get(ref),tx.get(control)]);if(!row.exists)throw new HttpError(404,'The agent run was removed.','NOT_FOUND');const current=decodeRecord<PlatformJob>(row.get('record'));if(!['queued','running'].includes(current.status)||lock.get('id')!==id||Date.now()-(lock.get('startedAt')??0)>leaseMs)throw new HttpError(409,'This agent run no longer owns its execution lease.','RUN_FINISHED');const job=change(current);job.updatedAt=new Date().toISOString();tx.update(ref,{record:encodeRecord(job),status:job.status});if(['completed','failed'].includes(job.status)&&lock.get('id')===id)tx.set(control,{id:null,startedAt:0});return job;});}
export async function appendJobEvent(userId:string,id:string,event:ResearchAgentEvent){await updatePlatformJob(userId,id,job=>({...job,events:[...job.events,event].slice(-160),receipts:event.receipt?[...(job.receipts??[]).filter(r=>r.id!==event.receipt!.id),event.receipt].slice(-24):job.receipts??[]}));}
export async function finishPlatformJob(userId:string,id:string,result:PlatformJob['result']){return updatePlatformJob(userId,id,job=>({...job,status:'completed',completedAt:new Date().toISOString(),result}));}
export async function failPlatformJob(userId:string,id:string,code:string,message:string){return updatePlatformJob(userId,id,job=>({...job,status:'failed',completedAt:new Date().toISOString(),error:{code,message}}));}
export async function deletePlatformJob(userId:string,id:string){const root=getUserRoot(userId);await firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);const ref=jobs(userId).doc(id),row=await tx.get(ref);if(!row.exists)throw new HttpError(404,'Agent run not found.','NOT_FOUND');const job=decodeRecord<PlatformJob>(row.get('record'));if(['queued','running'].includes(job.status))throw new HttpError(409,'Wait for this agent run to finish before removing it.','RUN_ACTIVE');tx.delete(ref);});await clearPlatformMemory(userId);return {ok:true};}

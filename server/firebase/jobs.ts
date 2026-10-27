import {CloudTasksClient} from '@google-cloud/tasks';
import {OAuth2Client} from 'google-auth-library';
import {firebaseAdmin} from './admin';
import {createHash} from 'node:crypto';
import {CONNECTED_EXECUTION_MS,QUEUED_RESEARCH_MS} from './jobs-policy';
import type {ResearchProfile} from '../../lib/contracts';
export interface PendingJob {id:string;status:'queued'|'running'|'failed';createdAt:string;message:string;}
const user=(id:string)=>firebaseAdmin().db.collection('thesis_users').doc(createHash('sha256').update(id).digest('hex'));
const oauth=new OAuth2Client();
export async function enqueueResearch(userId:string,id:string){
 const project=process.env.FIREBASE_PROJECT_ID??process.env.GOOGLE_CLOUD_PROJECT,location=process.env.CLOUD_TASKS_LOCATION,queue=process.env.CLOUD_TASKS_QUEUE,url=process.env.CLOUD_RUN_SERVICE_URL,invoker=process.env.TASKS_INVOKER_SERVICE_ACCOUNT;
 if(!project||!location||!queue||!url||!invoker)throw new Error('Connected research queue is not configured.');
 const client=new CloudTasksClient(),parent=client.queuePath(project,location,queue),name=client.taskPath(project,location,queue,'research-'+id);
 try{await client.createTask({parent,task:{name,dispatchDeadline:{seconds:900},httpRequest:{httpMethod:'POST',url:url.replace(/\/$/,'')+'/_internal/research-jobs',headers:{'Content-Type':'application/json'},body:Buffer.from(JSON.stringify({userId,id})).toString('base64'),oidcToken:{serviceAccountEmail:invoker,audience:url.replace(/\/$/,'')}}}},{timeout:10000,retry:null});}
 catch(error){if((error as {code?:number})?.code===6)return;throw new Error('Connected research could not be queued. No inference was started by this request.');}
}
export async function verifyTaskRequest(headers:Headers,verify=async(token:string,audience:string)=>{const ticket=await oauth.verifyIdToken({idToken:token,audience});return ticket.getPayload();}):Promise<boolean>{
 const token=headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{20,16000})$/)?.[1],audience=process.env.CLOUD_RUN_SERVICE_URL?.replace(/\/$/,''),email=process.env.TASKS_INVOKER_SERVICE_ACCOUNT;
 if(!token||!audience||!email)return false;
 try{const payload=await verify(token,audience);return !!payload&&payload.email===email&&payload.email_verified===true&&['accounts.google.com','https://accounts.google.com'].includes(payload.iss??'');}catch{return false;}
}
export async function jobStatus(userId:string,id:string):Promise<PendingJob|null>{
 const db=firebaseAdmin().db,root=user(userId),ref=root.collection('runs').doc(id),control=root.collection('settings').doc('control');
 return db.runTransaction(async tx=>{const[snapshot,lock]=await Promise.all([tx.get(ref),tx.get(control)]);if(!snapshot.exists||snapshot.get('status')==='completed')return null;
 const value=snapshot.data()!,executing=value.jobState==='executing';
 const expired=value.status==='running'&&(executing?Date.now()-(value.jobStartedAt??0)>CONNECTED_EXECUTION_MS:Date.now()-Date.parse(value.createdAt)>QUEUED_RESEARCH_MS);
 if(expired){tx.update(ref,{status:'failed',jobState:'failed',error:executing?'Execution was interrupted or its upstream outcome is uncertain. Review before creating a new request.':'Research did not start within the queue deadline. Create a new request.'});if(lock.get('activeRunId')===id)tx.set(control,{activeRunId:null,activeStartedAt:0,activeLeaseUntil:0},{merge:true});return {id,status:'failed',createdAt:value.createdAt,message:executing?'Execution was interrupted. No automatic paid inference replay was attempted.':'The queue deadline expired before execution.'};}
 return {id,status:value.status==='failed'?'failed':executing?'running':'queued',createdAt:value.createdAt,message:value.status==='failed'?(value.error??'Research failed. Start a new request.'):executing?'Your connected research is running. You can return to its history after completion.':'Your connected research is queued. You can close this page; the pending record is persistent.'};
 });
}
export async function pendingJobs(userId:string){const snapshot=await user(userId).collection('runs').where('status','==','running').limit(20).get();return (await Promise.all(snapshot.docs.map(doc=>jobStatus(userId,doc.id)))).filter((j):j is PendingJob=>j!==null);}
/** A duplicate delivery never repeats a potentially already billed model call. */
export async function claimJob(userId:string,id:string):Promise<ResearchProfile|null>{
 const db=firebaseAdmin().db,root=user(userId),ref=root.collection('runs').doc(id);
 return db.runTransaction(async tx=>{const control=root.collection('settings').doc('control');const[account,snapshot,lock]=await Promise.all([tx.get(root),tx.get(ref),tx.get(control)]);if(!snapshot.exists||account.get('erasing')||snapshot.get('status')!=='running')return null;
 if(snapshot.get('jobState')==='executing')return null;
 if(Date.now()-Date.parse(snapshot.get('createdAt'))>QUEUED_RESEARCH_MS||lock.get('activeRunId')!==id){tx.update(ref,{status:'failed',jobState:'failed',error:'Queued research expired or was superseded. No inference was started.'});return null;}
 tx.update(ref,{jobState:'executing',jobStartedAt:Date.now()});tx.set(control,{activeLeaseUntil:Date.now()+CONNECTED_EXECUTION_MS},{merge:true});return JSON.parse(snapshot.get('profile')) as ResearchProfile;});
}

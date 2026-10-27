import {createHash} from 'node:crypto';
import type {Firestore,DocumentReference,Transaction} from 'firebase-admin/firestore';
import type {Market,ResearchRun,SavedThesis} from '../../lib/contracts';
import {firebaseAdmin} from './admin';
import {firebaseRequest} from './context';
import {encodeRecord,decodeRecord,type StoredJson} from './codec';
import {HttpError} from '../../lib/server/http';
import {eraseZetarisObservations} from '../platform/zetaris-layer';
import {QUEUED_RESEARCH_MS} from './jobs-policy';
const key=(value:string)=>createHash('sha256').update(value).digest('hex');
export function createFirestoreRepository(db:Firestore){
const database=()=>db;
const owner=(userId:string)=>database().collection('thesis_users').doc(key(userId));
const runs=(userId:string)=>owner(userId).collection('runs');
const saved=(userId:string)=>owner(userId).collection('theses');
const control=(userId:string)=>owner(userId).collection('settings').doc('control');
const memories=(userId:string)=>owner(userId).collection('settings').doc('memory');
const archives=(userId:string)=>owner(userId).collection('memory_archives');
const completedIndex=(userId:string)=>owner(userId).collection('completed_run_index');
interface RunDocument {id:string;status:string;createdAt:string;profile:string;idempotencyKey:string;record?:StoredJson;error?:string;}
function runFrom(document:RunDocument):ResearchRun{return decodeRecord<ResearchRun>(document.record!);}
async function checkAccount(tx:Transaction,userId:string){const snapshot=await tx.get(owner(userId)),state=snapshot.data();if(state?.erasing)throw new HttpError(409,'Workspace erasure is in progress. Please retry shortly.','ACCOUNT_ERASING');if(state?.erasedAt&&((firebaseRequest()?.startedAt??Date.now())<=state.erasedAt))throw new HttpError(409,'The workspace was cleared during this request. Start a new request.','STALE_WORKSPACE');return state;}
async function listRuns(userId:string):Promise<ResearchRun[]>{const index=await completedIndex(userId).orderBy('createdAt','desc').limit(30).get();if(!index.size)return [];const records=await database().getAll(...index.docs.map(d=>runs(userId).doc(d.id)));return records.filter(d=>d.exists&&d.get('status')==='completed').map(d=>runFrom(d.data() as RunDocument));}
async function getRun(userId:string,id:string):Promise<ResearchRun|null>{const snapshot=await runs(userId).doc(id).get(),value=snapshot.data() as RunDocument|undefined;return value?.status==='completed'&&value.record?runFrom(value):null;}
async function getIdempotentRun(userId:string,idempotencyKey:string){const lookup=await owner(userId).collection('idempotency').doc(key(idempotencyKey)).get();const id=lookup.get('runId');if(typeof id!=='string')return null;const snapshot=await runs(userId).doc(id).get(),value=snapshot.data() as RunDocument|undefined;return value?{id:value.id,status:value.status,profile:value.profile,result:value.record?JSON.stringify(runFrom(value)):null}:null;}
async function createRun(userId:string,id:string,profile:unknown,idempotencyKey:string){return database().runTransaction(async tx=>{
 const account=await checkAccount(tx,userId);const lookup=owner(userId).collection('idempotency').doc(key(idempotencyKey)),[prior,lock]=await Promise.all([tx.get(lookup),tx.get(control(userId))]);
 if(prior.exists||((lock.get('activeLeaseUntil')??0)>Date.now()))return false;
 tx.set(runs(userId).doc(id),{id,status:'running',createdAt:new Date().toISOString(),profile:JSON.stringify(profile),idempotencyKey,jobState:'queued',memoryGeneration:account?.memoryGeneration??0});
 tx.set(lookup,{runId:id});tx.set(control(userId),{activeRunId:id,activeStartedAt:Date.now(),activeLeaseUntil:Date.now()+QUEUED_RESEARCH_MS},{merge:true});return true;
});}
async function completeRun(userId:string,run:ResearchRun,memorySnapshot?:unknown){await database().runTransaction(async tx=>{
 const account=await checkAccount(tx,userId);const ref=runs(userId).doc(run.id),[existing,lock]=await Promise.all([tx.get(ref),tx.get(control(userId))]);if(!existing.exists||existing.get('status')!=='running')throw new HttpError(409,'This research was cancelled or cleared.','RUN_CANCELLED');
 const memoryValid=(existing.get('memoryGeneration')??0)===(account?.memoryGeneration??0);
 if(!memoryValid){run.memory={reused:false,lessons:[]};run.events=run.events.filter(e=>e.agent!=='Memory');run.warnings.push('History changed during this research. Recalled memory was cleared and was not retained.');}
 const retained=run;
 tx.update(ref,{status:'completed',jobState:'completed',record:encodeRecord(retained),error:null});tx.set(completedIndex(userId).doc(run.id),{createdAt:run.createdAt});if(lock.get('activeRunId')===run.id)tx.set(control(userId),{activeRunId:null,activeStartedAt:0,activeLeaseUntil:0},{merge:true});
 if(memorySnapshot&&memoryValid){const{pendingArchive,...clean}=memorySnapshot as Record<string,unknown>;tx.set(memories(userId),{runId:run.id,record:encodeRecord(clean)});if(pendingArchive)tx.create(archives(userId).doc(),{runId:run.id,generation:account?.memoryGeneration??0,createdAt:new Date().toISOString(),record:encodeRecord(pendingArchive)});}
});}
async function failRun(userId:string,id:string){await database().runTransaction(async tx=>{const ref=runs(userId).doc(id),[found,lock]=await Promise.all([tx.get(ref),tx.get(control(userId))]);if(found.exists)tx.update(ref,{status:'failed',jobState:'failed',error:'Provider or analysis failure. Retry with a new request.'});if(lock.get('activeRunId')===id)tx.set(control(userId),{activeRunId:null,activeStartedAt:0,activeLeaseUntil:0},{merge:true});});}
async function deleteCollection(ref:ReturnType<Firestore['collection']>){await database().recursiveDelete(ref);}
async function deleteRun(userId:string,id:string){const found=await runs(userId).doc(id).get();if(!found.exists)return;
 const retiredGeneration=await database().runTransaction(async tx=>{const account=await checkAccount(tx,userId);const lock=await tx.get(control(userId));tx.delete(runs(userId).doc(id));tx.delete(completedIndex(userId).doc(id));tx.delete(owner(userId).collection('idempotency').doc(key(found.get('idempotencyKey'))));tx.delete(memories(userId));tx.set(owner(userId),{memoryGeneration:(account?.memoryGeneration??0)+1},{merge:true});if(lock.get('activeRunId')===id)tx.set(control(userId),{activeRunId:null,activeStartedAt:0,activeLeaseUntil:0},{merge:true});return account?.memoryGeneration??0;});
 const related=await saved(userId).where('runId','==',id).get();for(const doc of related.docs)await database().runTransaction(async tx=>{const latest=await tx.get(doc.ref);if(latest.get('runId')===id)tx.delete(doc.ref);});const retiredArchives=await archives(userId).where('generation','<=',retiredGeneration).get();for(const doc of retiredArchives.docs)await doc.ref.delete();
}
async function checkRateLimit(rateKey:string,maximum=8,windowMs=600_000){const ref=database().collection('thesis_rate_limits').doc(key(rateKey));const allowed=await database().runTransaction(async tx=>{const prior=await tx.get(ref),window=Math.floor(Date.now()/windowMs),count=prior.get('window')===window?(prior.get('count')??0)+1:1;tx.set(ref,{window,count,updatedAt:Date.now()});return count<=maximum;});if(!allowed)throw new HttpError(429,'Research limit reached. Try again in 10 minutes.','RATE_LIMITED');}
async function listTheses(userId:string):Promise<SavedThesis[]>{const snapshot=await saved(userId).get();return snapshot.docs.map(d=>d.data() as SavedThesis).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);}
async function saveThesis(userId:string,input:{symbol:string;market:Market;runId:string;note:string}):Promise<SavedThesis>{const run=await getRun(userId,input.runId),stock=run?.opportunities.find(s=>s.symbol===input.symbol&&s.market===input.market);if(!stock)throw new HttpError(404,'Research this stock before saving its thesis.','THESIS_NOT_FOUND');
 const id=key(stock.market+':'+stock.symbol),ref=saved(userId).doc(id);return database().runTransaction(async tx=>{await checkAccount(tx,userId);const [found,linked]=await Promise.all([tx.get(ref),tx.get(runs(userId).doc(input.runId))]);if(!linked.exists||linked.get('status')!=='completed')throw new HttpError(404,'Research this stock before saving its thesis.','THESIS_NOT_FOUND');if(!found.exists){const all=await tx.get(saved(userId));if(all.size>=100)throw new HttpError(409,'Your saved thesis limit is100. Remove one to save another.','SAVE_LIMIT');}
 const item:SavedThesis={id,symbol:stock.symbol,name:stock.name,market:stock.market,runId:run!.id,createdAt:new Date().toISOString(),invalidation:stock.invalidation,note:input.note};tx.set(ref,item);return item;});}
async function updateThesis(userId:string,id:string,note:string){return database().runTransaction(async tx=>{await checkAccount(tx,userId);const ref=saved(userId).doc(id),found=await tx.get(ref);if(!found.exists)throw new HttpError(404,'Saved thesis not found.','NOT_FOUND');tx.update(ref,{note});return {...found.data(),note} as SavedThesis;});}
async function deleteThesis(userId:string,id:string){await database().runTransaction(async tx=>{await checkAccount(tx,userId);tx.delete(saved(userId).doc(id));});}
async function getMemory(userId:string){const snapshot=await memories(userId).get();return snapshot.exists?decodeRecord(snapshot.get('record')):undefined;}
async function exportMemory(userId:string){const current=await getMemory(userId),rows=await archives(userId).get();return {current,archives:rows.docs.map(d=>({createdAt:d.get('createdAt'),payload:decodeRecord(d.get('record'))}))};}
async function* exportRunRecords(userId:string):AsyncGenerator<string>{let after:FirebaseFirestore.QueryDocumentSnapshot|undefined;for(;;){let query=completedIndex(userId).orderBy('createdAt','desc').limit(10);if(after)query=query.startAfter(after);const batch=await query.get();if(!batch.size)break;const records=await database().getAll(...batch.docs.map(d=>runs(userId).doc(d.id)));for(const record of records)if(record.exists&&record.get('status')==='completed')yield JSON.stringify(runFrom(record.data() as RunDocument));after=batch.docs[batch.docs.length-1];}}
async function* exportArchiveRecords(userId:string):AsyncGenerator<string>{let after:FirebaseFirestore.QueryDocumentSnapshot|undefined;for(;;){let query=archives(userId).orderBy('createdAt','asc').limit(10);if(after)query=query.startAfter(after);const batch=await query.get();if(!batch.size)break;for(const document of batch.docs)yield JSON.stringify({createdAt:document.get('createdAt'),payload:decodeRecord(document.get('record'))});after=batch.docs[batch.docs.length-1];}}
async function eraseAccount(userId:string){const root=owner(userId);await database().runTransaction(async tx=>{const row=await tx.get(root),lock=await tx.get(root.collection('private_settings').doc('platform_lock'));if(lock.get('id')&&Date.now()-(lock.get('startedAt')??0)<15*60000)throw new HttpError(409,'Wait for active agents to finish before clearing this workspace.','RUN_ACTIVE');if(row.get('mergeToken'))throw new HttpError(409,'Account migration is in progress. Please wait before clearing this workspace.','ACCOUNT_MERGING');tx.set(root,{erasing:true},{merge:true});});try{if(!await eraseZetarisObservations(userId))throw new HttpError(503,'Source-data erasure could not be confirmed. The workspace remains locked; retry clearing it once source storage reconnects.','SOURCE_ERASURE_UNAVAILABLE');for(const collection of await root.listCollections())await deleteCollection(collection);await database().collection('thesis_rate_limits').doc(key('research:'+userId)).delete();await root.set({erasing:false,erasedAt:Date.now()});}catch(error){throw error;}}

return {listRuns,getRun,getIdempotentRun,createRun,completeRun,failRun,deleteRun,checkRateLimit,listTheses,saveThesis,updateThesis,deleteThesis,getMemory,exportMemory,exportRunRecords,exportArchiveRecords,eraseAccount};
}
type Repository=ReturnType<typeof createFirestoreRepository>;
const repository=()=>createFirestoreRepository(firebaseAdmin().db);
export const listRuns:Repository['listRuns']=(...args)=>repository().listRuns(...args);
export const getRun:Repository['getRun']=(...args)=>repository().getRun(...args);
export const getIdempotentRun:Repository['getIdempotentRun']=(...args)=>repository().getIdempotentRun(...args);
export const createRun:Repository['createRun']=(...args)=>repository().createRun(...args);
export const completeRun:Repository['completeRun']=(...args)=>repository().completeRun(...args);
export const failRun:Repository['failRun']=(...args)=>repository().failRun(...args);
export const deleteRun:Repository['deleteRun']=(...args)=>repository().deleteRun(...args);
export const checkRateLimit:Repository['checkRateLimit']=(...args)=>repository().checkRateLimit(...args);
export const listTheses:Repository['listTheses']=(...args)=>repository().listTheses(...args);
export const saveThesis:Repository['saveThesis']=(...args)=>repository().saveThesis(...args);
export const updateThesis:Repository['updateThesis']=(...args)=>repository().updateThesis(...args);
export const deleteThesis:Repository['deleteThesis']=(...args)=>repository().deleteThesis(...args);
export const getMemory:Repository['getMemory']=(...args)=>repository().getMemory(...args);
export const exportMemory:Repository['exportMemory']=(...args)=>repository().exportMemory(...args);
export const exportRunRecords:Repository['exportRunRecords']=(...args)=>repository().exportRunRecords(...args);
export const exportArchiveRecords:Repository['exportArchiveRecords']=(...args)=>repository().exportArchiveRecords(...args);
export const eraseAccount:Repository['eraseAccount']=(...args)=>repository().eraseAccount(...args);

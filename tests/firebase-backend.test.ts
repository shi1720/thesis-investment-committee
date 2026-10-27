import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {createFirestoreRepository} from '../server/firebase/store';
import {verifyFirebaseRequest,getChatGPTUser} from '../server/firebase/auth';
import {withFirebaseRequest} from '../server/firebase/context';
import {encodeRecord,decodeRecord} from '../server/firebase/codec';
import {verifyTaskRequest} from '../server/firebase/jobs';
import {runResearch} from '../lib/research/engine';
import {defaultProfile} from '../lib/contracts';

test('public API ignores forged Sites identity and requires a verified Firebase token',async()=>{
 let verifications=0;const verifier=async()=>{verifications++;return {uid:'alice'};};
 assert.equal(await verifyFirebaseRequest(new Headers({'oai-authenticated-user-id':'victim','oai-authenticated-user-email':'victim@example.test'}),verifier),null);
 assert.equal(verifications,0);
 await assert.rejects(()=>verifyFirebaseRequest(new Headers({authorization:'Bearer '+('x'.repeat(30))}),async()=>{throw new Error('bad signature')}));
 const verified=await verifyFirebaseRequest(new Headers({authorization:'Bearer '+('x'.repeat(30))}),verifier);
 assert.equal(verified?.userId,'firebase:alice');assert.equal(verified?.email,null);
});

test('concurrent request identities remain isolated across async boundaries',async()=>{
 const work=(id:string)=>withFirebaseRequest({user:{userId:id,displayName:id,email:null,fullName:null},startedAt:1},async()=>{await Promise.resolve();return (await getChatGPTUser())?.userId;});
 assert.deepEqual(await Promise.all([work('alice'),work('bob')]),['alice','bob']);assert.equal(await getChatGPTUser(),null);
});

test('stored JSON is compressed, round-trips exactly and rejects corrupt payloads',()=>{
 const value={sample:true,prices:Array.from({length:500},(_,i)=>i+100),note:'A source note'};
 const encoded=encodeRecord(value);assert.deepEqual(decodeRecord(encoded),value);
 assert.throws(()=>decodeRecord({...encoded,rawBytes:1}),/length/);
 assert.throws(()=>decodeRecord({...encoded,payload:Buffer.from('invalid')}));
});

test('task headers cannot replace a signed Google OIDC token for the exact invoker',async()=>{
 const oldUrl=process.env.CLOUD_RUN_SERVICE_URL,oldEmail=process.env.TASKS_INVOKER_SERVICE_ACCOUNT;
 process.env.CLOUD_RUN_SERVICE_URL='https://api.example.run.app';process.env.TASKS_INVOKER_SERVICE_ACCOUNT='worker@example.iam.gserviceaccount.com';
 try{
  assert.equal(await verifyTaskRequest(new Headers({'x-cloudtasks-taskname':'forged'})),false);
  const headers=new Headers({authorization:'Bearer '+('x'.repeat(30))});
  assert.equal(await verifyTaskRequest(headers,async()=>({email:'attacker@example.test',email_verified:true,iss:'accounts.google.com',sub:'test-sub',aud:'https://api.example.run.app',iat:100,exp:200})),false);
  assert.equal(await verifyTaskRequest(headers,async(_token,audience)=>{assert.equal(audience,'https://api.example.run.app');return {email:process.env.TASKS_INVOKER_SERVICE_ACCOUNT,email_verified:true,iss:'https://accounts.google.com',sub:'test-invoker',aud:audience,iat:100,exp:200};}),true);
 }finally{if(oldUrl===undefined)delete process.env.CLOUD_RUN_SERVICE_URL;else process.env.CLOUD_RUN_SERVICE_URL=oldUrl;if(oldEmail===undefined)delete process.env.TASKS_INVOKER_SERVICE_ACCOUNT;else process.env.TASKS_INVOKER_SERVICE_ACCOUNT=oldEmail;}
});

/** Deterministic Firestore contract fake; remote IAM/index/latency requires deployed E2E. */
class MemoryFirestore {
 records=new Map<string,Record<string,unknown>>();
 collection(path:string){return new Collection(this,path);}
 async getAll(...refs:Doc[]){return refs.map(ref=>ref.snapshot());}
 async recursiveDelete(ref:Collection){for(const path of this.records.keys())if(path.startsWith(ref.path+'/'))this.records.delete(path);}
 private tail:Promise<unknown>=Promise.resolve();
 async runTransaction<T>(callback:(tx:unknown)=>Promise<T>):Promise<T>{
  const execute=async()=>{let wrote=false;const writes:(()=>void)[]=[];const tx={get:async(ref:Doc|Collection)=>{if(wrote)throw Error('Firestore forbids reads after writes');return ref instanceof Doc?ref.snapshot():ref.get();},set:(ref:Doc,value:Record<string,unknown>,opts?:{merge?:boolean})=>{wrote=true;writes.push(()=>ref.setSync(value,opts));},update:(ref:Doc,value:Record<string,unknown>)=>{wrote=true;writes.push(()=>{if(!this.records.has(ref.path))throw Error('missing update');ref.setSync(value,{merge:true});});},delete:(ref:Doc)=>{wrote=true;writes.push(()=>this.records.delete(ref.path));},create:(ref:Doc,value:Record<string,unknown>)=>{wrote=true;writes.push(()=>{if(this.records.has(ref.path))throw Error('already exists');ref.setSync(value);});}};const value=await callback(tx);for(const write of writes)write();return value;};
  const result=this.tail.then(execute);this.tail=result.catch(()=>{});return result;
 }
}
class Snapshot {
 constructor(public ref:Doc,private value:Record<string,unknown>|undefined){}
 get id(){return this.ref.id;}get exists(){return this.value!==undefined;}data(){return this.value===undefined?undefined:structuredClone(this.value);}get(name:string){return this.value?.[name];}
}
class Doc {
 constructor(private db:MemoryFirestore,public path:string){}
 get id(){return this.path.split('/').at(-1)!;}collection(name:string){return new Collection(this.db,this.path+'/'+name);}snapshot(){return new Snapshot(this,this.db.records.get(this.path));}async get(){return this.snapshot();}
 setSync(value:Record<string,unknown>,opts?:{merge?:boolean}){this.db.records.set(this.path,structuredClone({...opts?.merge?this.db.records.get(this.path):{},...value}));}
 async set(value:Record<string,unknown>,opts?:{merge?:boolean}){this.setSync(value,opts);}async update(value:Record<string,unknown>){if(!this.db.records.has(this.path))throw Error('missing');this.setSync(value,{merge:true});}async delete(){this.db.records.delete(this.path);}
 async listCollections(){const names=new Set<string>();for(const path of this.db.records.keys())if(path.startsWith(this.path+'/'))names.add(path.slice(this.path.length+1).split('/')[0]);return [...names].map(name=>this.collection(name));}
}
class Collection {
 constructor(private db:MemoryFirestore,public path:string,private filters:[string,unknown][]=[],private order?:[string,string],private max=Infinity,private after?:string){}
 doc(id=crypto.randomUUID()){return new Doc(this.db,this.path+'/'+id);}where(field:string,_operator:string,value:unknown){return new Collection(this.db,this.path,[...this.filters,[field,value]],this.order,this.max,this.after);}orderBy(field:string,direction='asc'){return new Collection(this.db,this.path,this.filters,[field,direction],this.max,this.after);}limit(max:number){return new Collection(this.db,this.path,this.filters,this.order,max,this.after);}startAfter(doc:Snapshot){return new Collection(this.db,this.path,this.filters,this.order,this.max,doc.id);}
 async get(){let docs=[...this.db.records.keys()].filter(path=>path.startsWith(this.path+'/')&&path.slice(this.path.length+1).split('/').length===1).map(path=>new Doc(this.db,path).snapshot()).filter(s=>this.filters.every(([field,value])=>s.get(field)===value));if(this.order){const[field,direction]=this.order;docs.sort((a,b)=>String(a.get(field)).localeCompare(String(b.get(field)))*(direction==='desc'?-1:1));}if(this.after){const i=docs.findIndex(d=>d.id===this.after);docs=docs.slice(i+1);}docs=docs.slice(0,this.max);return {docs,size:docs.length};}
}
function repository(){return createFirestoreRepository(new MemoryFirestore() as unknown as Firestore);}

test('Firestore repository partitions records, uses server-owned stock identity and preserves idempotency',async()=>{
 const store=repository(),run=await runResearch(defaultProfile,{id:'first-run'});
 assert.equal(await store.createRun('alice',run.id,run.profile,'request-1'),true);
 assert.equal(await store.createRun('alice','duplicate',run.profile,'request-1'),false);
 await store.completeRun('alice',run,{state:{records:[]},ledger:[]});
 assert.equal((await store.getIdempotentRun('alice','request-1'))?.id,run.id);
 assert.equal((await store.getRun('alice',run.id))?.id,run.id);assert.equal(await store.getRun('bob',run.id),null);assert.equal((await store.listRuns('bob')).length,0);
 const stock=run.opportunities.find(s=>s.status==='qualified')!;
 await assert.rejects(()=>store.saveThesis('bob',{symbol:stock.symbol,market:stock.market,runId:run.id,note:'intrusion'}));
 const thesis=await store.saveThesis('alice',{symbol:stock.symbol,market:stock.market,runId:run.id,note:'owner note'});
 await assert.rejects(()=>store.updateThesis('bob',thesis.id,'intrusion'));
 assert.equal((await store.updateThesis('alice',thesis.id,'revised')).note,'revised');assert.equal((await store.listRuns('alice')).length,1);
});

test('erasure prevents an in-flight result and memory from resurrecting cleared records',async()=>{
 const store=repository(),run=await runResearch(defaultProfile,{id:'pending-erasure'});await store.createRun('alice',run.id,run.profile,'request-erase');await store.eraseAccount('alice');
 await assert.rejects(()=>store.completeRun('alice',run,{state:{records:[{content:'old'}]}}));
 assert.equal(await store.getRun('alice',run.id),null);assert.equal(await store.getMemory('alice'),undefined);
});

test('deleting earlier research invalidates recalled memory in an in-flight later run',async()=>{
 const store=repository(),first=await runResearch(defaultProfile,{id:'old-run'});await store.createRun('alice',first.id,first.profile,'old-request');await store.completeRun('alice',first,{state:{records:[{content:'old context'}]}});
 const next=await runResearch(defaultProfile,{id:'new-run',previousRuns:[first]});await store.createRun('alice',next.id,next.profile,'new-request');await store.deleteRun('alice',first.id);await store.completeRun('alice',next,{state:{records:[{content:'deleted old context'}]}});
 assert.equal(await store.getMemory('alice'),undefined);assert.equal((await store.getRun('alice',next.id))?.memory.reused,false);assert.equal(next.memory.reused,false);
});

test('queued lease remains active beyond five minutes and late completion cannot clear a newer lock',async()=>{
 const db=new MemoryFirestore(),store=createFirestoreRepository(db as unknown as Firestore),old=await runResearch(defaultProfile,{id:'slow-old'});
 await store.createRun('alice',old.id,old.profile,'slow-request');
 const actualNow=Date.now;try{Date.now=()=>actualNow()+10*60_000;assert.equal(await store.createRun('alice','too-early',old.profile,'early-request'),false);}finally{Date.now=actualNow;}
 const lock=[...db.records.entries()].find(([path])=>path.endsWith('/settings/control'))!;db.records.set(lock[0],{...lock[1],activeLeaseUntil:Date.now()-1});
 assert.equal(await store.createRun('alice','newer',old.profile,'newer-request'),true);
 await store.completeRun('alice',old);
 assert.equal(await store.createRun('alice','third',old.profile,'third-request'),false);
 assert.equal(db.records.get(lock[0])?.activeRunId,'newer');
});

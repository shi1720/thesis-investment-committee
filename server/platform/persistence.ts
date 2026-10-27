import {createHash} from 'node:crypto';
import type {Transaction} from 'firebase-admin/firestore';
import {firebaseAdmin} from '../firebase/admin';
import {firebaseRequest} from '../firebase/context';
import {HttpError} from '../../lib/server/http';
import {encodeRecord,decodeRecord} from '../firebase/codec';

export const ownerKey=(userId:string)=>createHash('sha256').update(userId).digest('hex');
export const getUserRoot=(userId:string)=>firebaseAdmin().db.collection('thesis_users').doc(ownerKey(userId));
export async function assertAccount(tx:Transaction,userId:string){const root=getUserRoot(userId),row=await tx.get(root);if(row.get('erasing'))throw new HttpError(409,'Your workspace is being cleared. Please retry shortly.','ACCOUNT_ERASING');if((row.get('erasedAt')??0)>=(firebaseRequest()?.startedAt??Date.now()))throw new HttpError(409,'Your workspace changed during this request. Reload before continuing.','STALE_WORKSPACE');return row;}
export function settingsStore<T extends object>(namespace:string){
 if(!/^[a-z_]{1,50}$/.test(namespace))throw new Error('Invalid settings namespace');
 return {
  async get(userId:string):Promise<T|null>{const row=await getUserRoot(userId).collection('private_settings').doc(namespace).get();return row.exists?row.get('settings') as T:null;},
  async mutate(userId:string,update:(current:T|null)=>T):Promise<T>{return firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);const ref=getUserRoot(userId).collection('private_settings').doc(namespace),row=await tx.get(ref);const next=update(row.exists?row.get('settings') as T:null);if(Buffer.byteLength(JSON.stringify(next))>700000)throw new HttpError(413,'Settings exceed the account limit.','SETTINGS_TOO_LARGE');tx.set(ref,{settings:JSON.parse(JSON.stringify(next)),updatedAt:new Date().toISOString()});return next;});},
 };
}
export async function readRecord<T>(userId:string,collection:string,id:string):Promise<T|null>{const row=await getUserRoot(userId).collection(collection).doc(id).get();return row.exists?decodeRecord<T>(row.get('record')):null;}
export async function writeRecord(userId:string,collection:string,id:string,value:unknown){return firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);tx.set(getUserRoot(userId).collection(collection).doc(id),{record:encodeRecord(value),updatedAt:new Date().toISOString()});});}
export async function listRecords<T>(userId:string,collection:string,limit=40):Promise<T[]>{const snapshot=await getUserRoot(userId).collection(collection).orderBy('updatedAt','desc').limit(limit).get();return snapshot.docs.map(row=>decodeRecord<T>(row.get('record')));}

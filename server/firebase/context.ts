import {AsyncLocalStorage} from 'node:async_hooks';
export interface FirebaseRequestUser {userId:string;displayName:string;email:string|null;fullName:string|null;}
export interface FirebaseRequestContext {user:FirebaseRequestUser|null;startedAt:number;}
const requests=new AsyncLocalStorage<FirebaseRequestContext>();
export function withFirebaseRequest<T>(context:FirebaseRequestContext,run:()=>T):T{return requests.run(context,run);}
export function firebaseRequest():FirebaseRequestContext|undefined{return requests.getStore();}

import {firebaseRequest,type FirebaseRequestUser} from './context';
export type TokenClaims={uid:string;name?:string;email?:string;firebase?:{sign_in_provider?:string}};
export type TokenVerifier=(token:string)=>Promise<TokenClaims>;
export class FirebaseAuthenticationError extends Error {constructor(public code:string){super('A valid Firebase sign-in token is required.');this.name='FirebaseAuthenticationError';}}
/** Caller-supplied Sites identity headers are never trusted on this public API. */
export async function verifyFirebaseRequest(headers:Headers,verify:TokenVerifier):Promise<FirebaseRequestUser|null>{
 const authorization=headers.get('authorization');
 if(!authorization)return null;
 const match=/^Bearer ([A-Za-z0-9._-]{20,16000})$/.exec(authorization);
 if(!match)throw new FirebaseAuthenticationError('INVALID_AUTHORIZATION');
 let claims:TokenClaims;try{claims=await verify(match[1]);}catch{throw new FirebaseAuthenticationError('INVALID_ID_TOKEN');}
 if(!claims.uid||typeof claims.uid!=='string'||claims.uid.length>128)throw new FirebaseAuthenticationError('INVALID_PRINCIPAL');
 return {userId:'firebase:'+claims.uid,displayName:claims.name||claims.email||'Guest researcher',email:claims.email??null,fullName:claims.name??null};
}
/** Build-time alias for the Sites identity helper. Context is request-scoped. */
export async function getChatGPTUser():Promise<FirebaseRequestUser|null>{return firebaseRequest()?.user??null;}

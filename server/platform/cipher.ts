import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export interface CipherRecord {version:1;algorithm:'A256GCM';iv:string;data:string;tag:string;purpose:string;keyVersion:string}
function master(){const value=process.env.THESIS_SETTINGS_KEY;if(!value)throw new Error('Secure account settings are not configured.');const key=Buffer.from(value,'base64url');if(key.length!==32)throw new Error('Secure account settings key is invalid.');return key;}
export async function encryptSecret(userId:string,purpose:string,plaintext:string):Promise<CipherRecord>{
 if(!userId||!purpose||plaintext.length>8192)throw new Error('Invalid secret request.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master(),iv);cipher.setAAD(Buffer.from(JSON.stringify([userId,purpose,1])));
 const data=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
 return {version:1,algorithm:'A256GCM',iv:iv.toString('base64url'),data:data.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),purpose,keyVersion:'1'};
}
export async function decryptSecret(userId:string,purpose:string,value:CipherRecord):Promise<string>{
 if(value.version!==1||value.algorithm!=='A256GCM'||value.purpose!==purpose||value.keyVersion!=='1')throw new Error('Unsupported encrypted setting.');
 const iv=Buffer.from(value.iv,'base64url'),tag=Buffer.from(value.tag,'base64url');if(iv.length!==12||tag.length!==16||value.data.length>16000)throw new Error('Invalid encrypted setting.');
 const cipher=createDecipheriv('aes-256-gcm',master(),iv);cipher.setAAD(Buffer.from(JSON.stringify([userId,purpose,1])));cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(Buffer.from(value.data,'base64url')),cipher.final()]).toString('utf8');
}
export const secretCipher={encrypt:encryptSecret,decrypt:decryptSecret};

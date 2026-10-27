import {createHash} from 'node:crypto';
export const observationKinds=['quote','history','fundamentals','news','sec-facts'];
export const MAX_OBSERVATION_BYTES=300000;
export const hex64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const sha256=value=>createHash('sha256').update(value).digest('hex');
/** Canonical JSON, with no numeric coercion, secret fields, PII or synthetic flags. */
export function canonicalObservation(value){
 let nodes=0;
 function normalize(v,depth){
  if(++nodes>30000||depth>18)throw Error('Observation structure limit');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Nonfinite observation');return v}
  if(typeof v==='string'){
   if(v.length>50000)throw Error('Observation string limit');
   if(/^https?:\/\//i.test(v)){const url=new URL(v);if(url.username||url.password||[...url.searchParams.keys()].some(k=>/key|token|secret|authorization|signature/i.test(k)))throw Error('Credential URL forbidden')}
   return v;
  }
  if(Array.isArray(v)){if(v.length>10000)throw Error('Observation row limit');return v.map(item=>normalize(item,depth+1))}
  if(v&&typeof v==='object'){
   if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('Plain observation objects required');
   const entries=Object.entries(v).filter(([,item])=>item!==undefined);if(entries.length>150)throw Error('Observation field limit');
   return Object.fromEntries(entries.sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>{
    if(/api.?key|authorization|password|secret|credential|ciphertext|access.?token|^userId$|^email$|^__proto__$|^constructor$|^prototype$/i.test(key))throw Error('Private credentials or identity forbidden');
    if(/^(?:sample|synthetic|syntheticInputs)$/i.test(key)&&item===true)throw Error('Synthetic observations forbidden');
    return[key,normalize(item,depth+1)];
   }));
  }
  throw Error('Unsupported observation value');
 }
 const normalized=normalize(value,0),json=JSON.stringify(normalized);
 if(Buffer.byteLength(json)>MAX_OBSERVATION_BYTES)throw Error('Observation byte limit');
 return{value:normalized,json,hash:sha256(json)};
}
export function validateObservationEnvelope(value){
 const normalized=canonicalObservation(value),envelope=normalized.value;
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||!['ok','partial'].includes(envelope.status)||envelope.data===null||envelope.data===undefined||!Array.isArray(envelope.warnings))throw Error('Actual usable observation required');
 const p=envelope.provenance;if(!p||typeof p.provider!=='string'||!p.provider||typeof p.fetchedAt!=='string'||!Number.isFinite(Date.parse(p.fetchedAt))||!(p.asOf===null||typeof p.asOf==='string'&&Number.isFinite(Date.parse(p.asOf)))||typeof p.sourceUrl!=='string'||!/^https:\/\//.test(p.sourceUrl))throw Error('Dated source provenance required');
 return normalized;
}
export function validateObservationRequest(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['ownerHash','kind','recordKey','envelope','startedAt'].includes(k))||!hex64(body.ownerHash)||!hex64(body.recordKey)||!observationKinds.includes(body.kind)||!Number.isSafeInteger(body.startedAt)||body.startedAt<=0||body.startedAt>Date.now()+60000)return false;
 try{validateObservationEnvelope(body.envelope);return true}catch{return false}
}
export function observationNames(ownerHash){
 if(!hex64(ownerHash))throw Error('Invalid owner scope');
 const suffix=ownerHash.slice(0,32);
 return{database:'thesis_obs_'+suffix,container:'thesis_owner_'+suffix,view:'thesis_owner_'+suffix+'.observations',directory:'/home/zetaris/customer-data/shared/thesis-observations/'+ownerHash};
}

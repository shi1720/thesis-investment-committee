import {gzipSync,gunzipSync} from 'node:zlib';
export interface StoredJson {encoding:'gzip-json-v1';payload:Buffer;rawBytes:number;}
export function encodeRecord(value:unknown):StoredJson{
 const json=Buffer.from(JSON.stringify(value),'utf8');if(json.byteLength>8_000_000)throw new Error('Research record exceeds the bounded storage contract.');
 const payload=gzipSync(json);if(payload.byteLength>850_000)throw new Error('Compressed research record exceeds the Firestore document limit.');
 return {encoding:'gzip-json-v1',payload,rawBytes:json.byteLength};
}
export function decodeRecord<T>(value:StoredJson):T{
 if(value.encoding!=='gzip-json-v1'||!Number.isInteger(value.rawBytes)||value.rawBytes<1||value.rawBytes>8_000_000)throw new Error('Invalid stored research record encoding.');
 const json=gunzipSync(value.payload,{maxOutputLength:8_000_000});if(json.byteLength!==value.rawBytes)throw new Error('Stored research record length mismatch.');
 return JSON.parse(json.toString('utf8')) as T;
}

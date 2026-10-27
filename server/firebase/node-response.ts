import type {ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';

/** Bridge fetch responses with bounded buffering and cancellation on disconnect. */
export async function responseToNode(response:Response,out:ServerResponse):Promise<void>{
 if(out.headersSent||out.destroyed||out.writableEnded){try{await response.body?.cancel();}catch{}if(!out.destroyed)out.destroy();return;}
 try{
  out.statusCode=response.status;
  response.headers.forEach((value,name)=>out.setHeader(name,value));
  out.setHeader('X-Content-Type-Options','nosniff');out.setHeader('Referrer-Policy','no-referrer');out.setHeader('X-Frame-Options','DENY');
  if(!response.body){out.end();return;}
  await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),out);
 }catch{
  // Headers or partial content may already have reached the client. Destroying
  // the socket also cancels the source; never append a second JSON response.
  if(!out.destroyed)out.destroy();
 }
}

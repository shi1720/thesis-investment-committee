import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import type {ServerResponse} from 'node:http';
import {responseToNode} from '../server/firebase/node-response';
class ResponseSink extends Writable {
 statusCode=0;headersSent=false;headers=new Map<string,string>();consumed=0;
 constructor(private fail=false){super({highWaterMark:16_384});}
 setHeader(name:string,value:string){if(this.headersSent)throw new Error('Headers already sent');this.headers.set(name,value);return this;}
 _write(_chunk:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){this.headersSent=true;if(this.fail){callback(new Error('Client disconnected'));return;}setTimeout(()=>{this.consumed++;callback();},1);}
}

test('slow export consumers apply backpressure instead of buffering the full account export',async()=>{
 const sink=new ResponseSink(),total=96;let produced=0,maxPending=0;
 const body=new ReadableStream<Uint8Array>({pull(controller){if(produced===total){controller.close();return;}produced++;maxPending=Math.max(maxPending,produced-sink.consumed);controller.enqueue(new Uint8Array(65_536));}});
 await responseToNode(new Response(body,{status:201,headers:{'Content-Type':'application/json'}}),sink as unknown as ServerResponse);
 assert.equal(sink.statusCode,201);assert.equal(sink.consumed,total);assert.equal(sink.writableFinished,true);
 assert.ok(maxPending<=5,`Source ran ${maxPending} chunks ahead of a slow consumer`);
 assert.equal(sink.headers.get('X-Content-Type-Options'),'nosniff');
});

test('a disconnect cancels the export source and does not attempt a second response',async()=>{
 let cancelled=false,pulls=0;const sink=new ResponseSink(true);
 const body=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(65_536));},cancel(){cancelled=true;}});
 await responseToNode(new Response(body),sink as unknown as ServerResponse);
 assert.equal(cancelled,true);assert.equal(sink.destroyed,true);assert.ok(pulls<6);
});

test('a response is never rewritten after headers were already sent',async()=>{
 let cancelled=false;const sink=new ResponseSink();sink.headersSent=true;
 const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 await responseToNode(new Response(body,{status:500}),sink as unknown as ServerResponse);
 assert.equal(cancelled,true);assert.equal(sink.headers.size,0);assert.equal(sink.statusCode,0);assert.equal(sink.destroyed,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson,assertSameOrigin,HttpError } from '../lib/server/http';
test('mutation boundary refuses a different origin and cross-site Fetch Metadata',()=>{
  assert.throws(()=>assertSameOrigin(new Request('https://thesis.example/api/research',{headers:{origin:'https://attacker.example'}})),(e:unknown)=>e instanceof HttpError&&e.status===403);
  assert.throws(()=>assertSameOrigin(new Request('https://thesis.example/api/research',{headers:{'sec-fetch-site':'cross-site'}})),/must come from Thesis/);
  assert.doesNotThrow(()=>assertSameOrigin(new Request('https://thesis.example/api/research',{headers:{origin:'https://thesis.example','sec-fetch-site':'same-origin'}})));
});
test('streamed JSON request is byte-bounded before complete buffering',async()=>{
  let pulled=0,cancelled=false;
  const body=new ReadableStream({pull(c){pulled++;c.enqueue(new Uint8Array(4096).fill(32));if(pulled===50)c.close();},cancel(){cancelled=true;}});
  const request=new Request('https://thesis.example/api/research',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'} as RequestInit);
  await assert.rejects(()=>readJson(request,8192),(e:unknown)=>e instanceof HttpError&&e.status===413);
  assert.ok(cancelled);assert.ok(pulled<50);
});
test('request parser rejects invalid JSON and unsupported content types',async()=>{
  await assert.rejects(()=>readJson(new Request('https://thesis.example/api/research',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'})),/invalid JSON/);
  await assert.rejects(()=>readJson(new Request('https://thesis.example/api/research',{method:'POST',body:'{}'})),(e:unknown)=>e instanceof HttpError&&e.status===415);
});

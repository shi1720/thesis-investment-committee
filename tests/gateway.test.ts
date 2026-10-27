import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGatewayRequest, authorizeGateway } from '../scripts/provider-gateway.mjs';
test('bridge authentication rejects malformed multibyte input without throwing',()=>{
 assert.equal(authorizeGateway('Bearer abc','abc'),true);
 for(const value of [undefined,'','Bearer wrong','Bearer ééé'])assert.equal(authorizeGateway(value,'abc'),false);
});
const query={queryId:'a1234567-1234-1234-1234-123456789abc',sql:"SELECT * FROM thesis.research_universe WHERE market IN ('US', 'India') LIMIT 1000",source:'SqlEditor',limit:1000};
test('public bridge accepts only the fixed synthetic view and known market projection',()=>{
 assert.equal(validateGatewayRequest('/api/v1.0/sql-editor/sqls/run','POST',query),'zetaris');
 for(const sql of ['SELECT * FROM thesis_personal.research_universe LIMIT 1000','DROP DATABASE thesis',query.sql+'; SELECT * FROM users',query.sql.replace("'US'","'untrusted'")])assert.equal(validateGatewayRequest('/api/v1.0/sql-editor/sqls/run','POST',{...query,sql}),null);
 assert.equal(validateGatewayRequest('/api/v1.0/internal/auth/legacy-login','GET'),null);
});
test('public bridge rejects arbitrary tools, models and unbounded generation',()=>{
 const payload={model:'local-runtime/qwen2-5-7b-instruct-q4-k-m',messages:[{role:'system',content:'Review'},{role:'user',content:'Synthetic case'}],temperature:.15,max_tokens:900,stream:false};
 assert.equal(validateGatewayRequest('/v1/chat/completions','POST',payload),'nightshift');
 for(const changes of [{model:'unknown'},{max_tokens:100000},{stream:true},{tools:[{}]},{messages:[{role:'user',content:'x'.repeat(21000)}]}])assert.equal(validateGatewayRequest('/v1/chat/completions','POST',{...payload,...changes}),null);
});

test('bounded source admission waits fairly instead of rejecting the third healthy operation',async()=>{
 const{createGatewayLimiter}=await import('../scripts/provider-gateway.mjs');const limiter=createGatewayLimiter({limit:2,maxPending:2,waitMs:1000});const first=await limiter.acquire(),second=await limiter.acquire();let thirdStarted=false;
 const third=limiter.acquire({wait:true}).then(release=>{thirdStarted=true;return release});await Promise.resolve();assert.equal(thirdStarted,false);assert.equal(limiter.status().pending,1);first();const releaseThird=await third;assert.equal(thirdStarted,true);assert.equal(limiter.status().active,2);releaseThird();releaseThird();second();assert.equal(limiter.status().active,0);
});
test('waiting source admission is abort-aware, bounded, and does not dispatch canceled work',async()=>{
 const{createGatewayLimiter,GatewayAdmissionError}=await import('../scripts/provider-gateway.mjs');const limiter=createGatewayLimiter({limit:1,maxPending:1,waitMs:1000});const release=await limiter.acquire();const abort=new AbortController();let dispatched=false;const waiting=limiter.acquire({wait:true,signal:abort.signal}).then(next=>{dispatched=true;next()});
 await assert.rejects(limiter.acquire({wait:true}),(e:unknown)=>e instanceof GatewayAdmissionError&&e.status===429);await assert.rejects(limiter.acquire(),(e:unknown)=>e instanceof GatewayAdmissionError&&e.status===429);abort.abort();await assert.rejects(waiting,{name:'AbortError'});release();assert.equal(dispatched,false);assert.deepEqual(limiter.status(),{active:0,pending:0,limit:1,maxPending:1});
});
test('source admission timeout releases its queue slot without replaying any request',async()=>{
 const{createGatewayLimiter,GatewayAdmissionError}=await import('../scripts/provider-gateway.mjs');const limiter=createGatewayLimiter({limit:1,maxPending:1,waitMs:10});const release=await limiter.acquire();await assert.rejects(limiter.acquire({wait:true}),(e:unknown)=>e instanceof GatewayAdmissionError&&e.status===503);assert.equal(limiter.status().pending,0);release();const next=await limiter.acquire();next();assert.equal(limiter.status().active,0);
});

test('initial model admission can wait within its own smaller deadline without inference replay',async()=>{
 const{createGatewayLimiter,GatewayAdmissionError}=await import('../scripts/provider-gateway.mjs');const limiter=createGatewayLimiter({limit:1,maxPending:2,waitMs:1000});const sourceRelease=await limiter.acquire();let dispatched=0;const model=limiter.acquire({wait:true,maxWaitMs:10}).then(release=>{dispatched++;release()});await assert.rejects(model,(e:unknown)=>e instanceof GatewayAdmissionError&&e.status===503);sourceRelease();assert.equal(dispatched,0);const admitted=await limiter.acquire({wait:true,maxWaitMs:10});dispatched++;admitted();assert.equal(dispatched,1);
});

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

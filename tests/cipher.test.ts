import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {encryptSecret,decryptSecret} from '../server/platform/cipher';
test('account keys are authenticated, randomized, owner-bound and purpose-bound',async()=>{
 const previous=process.env.THESIS_SETTINGS_KEY;process.env.THESIS_SETTINGS_KEY=randomBytes(32).toString('base64url');try{
 const one=await encryptSecret('one','ai:nvidia','synthetic-test-key'),two=await encryptSecret('one','ai:nvidia','synthetic-test-key');assert.notEqual(one.iv,two.iv);assert.equal(await decryptSecret('one','ai:nvidia',one),'synthetic-test-key');assert.ok(!JSON.stringify(one).includes('synthetic-test-key'));
 await assert.rejects(()=>decryptSecret('two','ai:nvidia',one));await assert.rejects(()=>decryptSecret('one','ai:openai',one));await assert.rejects(()=>decryptSecret('one','ai:nvidia',{...one,data:one.data.slice(0,-1)+'!'}));
 }finally{if(previous===undefined)delete process.env.THESIS_SETTINGS_KEY;else process.env.THESIS_SETTINGS_KEY=previous;}
});

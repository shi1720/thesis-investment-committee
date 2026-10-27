import test from 'node:test';
import assert from 'node:assert/strict';
import {AIClient} from '../lib/ai/client';
import {AIError} from '../lib/ai/errors';
test('native billing rejection is actionable, retains a receipt and is never automatically replayed',async()=>{let calls=0;const client=new AIClient({fetcher:(async()=>{calls++;return new Response('{}',{status:402});}) as typeof fetch});await assert.rejects(()=>client.complete({provider:'gemini',apiKey:'test-only-not-a-key',model:'gemini-test-model',role:'connection_test',system:'Return the nonce.',prompt:'nonce',maxOutputTokens:64}),error=>{assert.ok(error instanceof AIError);assert.equal(error.code,'provider_billing');assert.equal(error.status,402);assert.equal(error.receipt?.status,'failed');assert.match(error.message,/billing or available credits/);return true;});assert.equal(calls,1);});

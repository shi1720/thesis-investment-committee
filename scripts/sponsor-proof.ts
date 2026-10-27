/** Operator smoke test. Credentials come from environment only; output contains no configuration secrets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultProfile } from '../lib/contracts';
import { runResearch } from '../lib/research/engine';
import { sampleUniverse } from '../lib/research/sample-data';
import { publicSponsorProof } from '../lib/providers/proof';
import { fetchZetarisStocks, NightshiftClient, recallResearchMemory, rememberResearch, type ProviderEnv } from '../lib/providers';

async function main(){
  const env=process.env as ProviderEnv;
  const nightshiftOnly=process.argv.includes('--nightshift-only');
  const started=new Date().toISOString();
  const stocks=nightshiftOnly?sampleUniverse:await fetchZetarisStocks(env);
  const synthetic=stocks.some(s=>s.evidence.some(e=>e.sample));
  const profile={...defaultProfile,mode:synthetic?'sample' as const:'live' as const};
  const first=await runResearch(profile,{stocks,id:'sponsor-proof-'+crypto.randomUUID()});
  const memorySnapshot=rememberResearch(first);
  const memory=recallResearchMemory(profile,[],memorySnapshot);
  const run=await runResearch(profile,{stocks,memoryLessons:memory.lessons,id:'sponsor-proof-'+crypto.randomUUID()});
  const client=new NightshiftClient(env);
  const health=await client.health();
  if(health.status!=='online')throw new Error(`Nightshift connection is ${health.status}.`);
  const reviewed=await client.critiqueResearch(run,memory.context);
  for(const critique of reviewed.critiques){
    const opportunity=run.opportunities.find(o=>o.symbol===critique.symbol)!;
    opportunity.analystNote='Nightshift qualitative review passed schema and source-ID membership checks; financial claims are unverified and numerical gates are unchanged.';
    opportunity.bullCase=critique.bullCase;opportunity.bearCase=critique.bearCase;
  }
  const result={schema:'thesis.sponsor-proof.v1',project:'Thesis',startedAt:started,finishedAt:new Date().toISOString(),scope:nightshiftOnly?'Real Nightshift inference over included synthetic research examples; Zetaris not exercised by this proof.':reviewed.receipts.length?'Real Zetaris query and Nightshift inference in the same research workflow.':'Real Zetaris query and Nightshift discovery; policy abstention skipped generation.',syntheticInputs:synthetic,financialDataNotice:synthetic?'All input prices and fundamentals are fabricated research fixtures. Real infrastructure execution is not live market data.':'Permissioned source data supplied by the operator; independent financial correctness has not been attested.',dataProvider:nightshiftOnly?'Bundled fixtures':'Zetaris',stockCount:stocks.length,sourceRowsValidated:true,memory:{engine:'Meterless H-MEM',reused:memory.reused,lessonCount:memory.lessons.length,trace:memory.trace},receipts:reviewed.receipts,warnings:reviewed.warnings,research:{id:run.id,abstained:run.abstained,eligibleCount:run.eligibleCount,reviewed:reviewed.critiques,events:run.events},limitations:['Schema and citation validation are deterministic checks, not independent verification of a model’s financial claims.','Runtime receipt bodies are retained when supplied; this script does not claim cryptographic signature verification.']};
  const filename=nightshiftOnly?'nightshift-live.json':'connected-research.json';
  await fs.mkdir(path.resolve('evidence'),{recursive:true});
  let privateProof:string|null=null;
  if(synthetic){
    await fs.writeFile(path.resolve('evidence',filename),JSON.stringify(result,null,2)+'\n');
  }else{
    const privateDirectory=path.resolve('work/private-proofs');
    await fs.mkdir(privateDirectory,{recursive:true,mode:0o700});
    await fs.chmod(privateDirectory,0o700);
    privateProof=path.join(privateDirectory,filename.replace('.json','-'+Date.now()+'-'+crypto.randomUUID()+'.json'));
    await fs.writeFile(privateProof,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
    await fs.writeFile(path.resolve('evidence',filename),JSON.stringify(publicSponsorProof(result),null,2)+'\n');
  }
  console.log(JSON.stringify({success:true,proof:'evidence/'+filename,privateProof,stockCount:stocks.length,memoryReused:memory.reused,models:reviewed.receipts.map(r=>r.resolvedModel),providerCostUsd:reviewed.receipts.every(r=>r.providerCostUsd!==null)?reviewed.receipts.reduce((sum,r)=>sum+(r.providerCostUsd??0),0):null}));
}
main().catch(error=>{console.error(JSON.stringify({success:false,error:error instanceof Error?error.message:'Sponsor proof failed.'}));process.exitCode=1});

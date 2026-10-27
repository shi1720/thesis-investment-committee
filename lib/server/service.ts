import { env } from 'cloudflare:workers';
import type { AgentEvent, ResearchProfile, ResearchRun } from '@/lib/contracts';
import { runResearch } from '@/lib/research/engine';
import { sampleUniverse } from '@/lib/research/sample-data';
import { fetchZetarisStocks, getProviderStatuses, NightshiftClient, NightshiftReviewError, ProviderError, recallResearchMemory, rememberResearch, type MemorySnapshot, type ProviderEnv } from '@/lib/providers';
import { getMemory, listRuns } from './store';
import { HttpError } from './http';
export function providerEnv():ProviderEnv {return env as ProviderEnv;}

export async function executeResearch(userId:string,profile:ResearchProfile,id:string):Promise<{run:ResearchRun;memorySnapshot:MemorySnapshot}>{
  const started=Date.now(); const config=providerEnv();
  const previousRuns=await listRuns(userId);
  const persisted=await getMemory(userId) as MemorySnapshot|undefined;
  const memory=recallResearchMemory(profile,previousRuns,persisted);
  let stocks=sampleUniverse;
  if(profile.mode==='live'){
    try{stocks=await fetchZetarisStocks(config,profile.markets);}
    catch(error){
      if(error instanceof ProviderError)throw new HttpError(503,error.message,'ZETARIS_'+error.code.toUpperCase());
      throw error;
    }
  }
  const synthetic=stocks.some(s=>s.evidence.some(e=>e.sample));
  // A real sponsor query does not turn synthetic fixtures into market observations.
  const analysisProfile=synthetic?{...profile,mode:'sample' as const}:profile;
  const run=await runResearch(analysisProfile,{stocks,previousRuns,memoryLessons:memory.lessons,id});
  run.profile=profile;
  run.mode=synthetic?'sample':'live';
  run.providers=getProviderStatuses(config);
  const hmem=run.providers.find(p=>p.name==='Meterless H-MEM');
  if(hmem){hmem.status='verified';hmem.detail=`Official pinned H-MEM engine executed hybrid recall; ${memory.lessons.length} prior decision records recalled. Persisted per signed-in account.`;}
  run.memory={reused:memory.reused,lessons:memory.lessons};
  const event=(agent:AgentEvent['agent'],action:string,detail:string,status:AgentEvent['status']='completed',model='deterministic/research-rules-v1',evidenceIds:string[]=[],iteration=3)=>{
    run.events.push({id:`${id}-orchestrator-${run.events.length+1}`,at:new Date().toISOString(),agent,action,detail,status,iteration,model,evidenceIds});
  };
  run.events.splice(1,0,{id:`${id}-hmem-recall`,at:new Date().toISOString(),agent:'Memory',action:'Recall with Meterless H-MEM',detail:`Official engine commit 1742dec. ${memory.reused?`${memory.lessons.length} historical decisions recalled using hybrid search.`:'First run: empty account memory. New decision will be retained for the next run.'} Prior decisions cannot change current risk limits.`,status:'completed',iteration:1,model:'Meterless/H-MEM',evidenceIds:[]});
  if(profile.mode==='live'){
    const zetaris=run.providers.find(p=>p.name==='Zetaris');
    if(zetaris){zetaris.status='verified';zetaris.detail=`Successful authenticated query delivered ${stocks.length} validated stock records from the configured view. ${synthetic?'Data is synthetic research fixtures.':'Dated price and filing provenance retained.'}`;}
    event('Data steward','Verify the Zetaris query',`Authenticated data-layer query returned ${stocks.length} stocks; validated schema, identities, source metadata and listing scope. ${synthetic?'The dataset contains synthetic fixtures and remains labeled sample.':'This result uses connected financial source records.'}`,'completed','Zetaris/SQL',run.evidence.map(e=>e.id));
    try{
      const review=await new NightshiftClient(config).critiqueResearch(run,memory.context);
      const ns=run.providers.find(p=>p.name==='Meterless Nightshift');
      if(ns){ns.status=review.receipts.length?'verified':'configured';ns.detail=review.receipts.length?`Actual provider response: ${[...new Set(review.receipts.map(r=>r.resolvedModel??r.responseModel))].join(', ')}. ${review.receipts.length} model requests.`:'No model calls: hard gates caused abstention before narrative research.';}
      run.cost.modelCalls=review.receipts.length;
      run.cost.actualUsd=review.receipts.length&&review.receipts.every(r=>r.providerCostUsd!==null)?review.receipts.reduce((n,r)=>n+r.providerCostUsd!,0):review.receipts.length?null:0;
      run.cost.estimatedUsd=0;
      for(const receipt of review.receipts)event('Skeptic',receipt.role==='Skeptic repair'?'Repair a rejected model critique':'Request independent Nightshift critique',`Request ${receipt.requestId}; receipt ${receipt.receiptId??'not returned'}; ${receipt.inputTokens??'?'} input / ${receipt.outputTokens??'?'} output tokens; ${receipt.latencyMs} ms. Requested ${receipt.requestedModel}; returned ${receipt.responseModel}. ${receipt.resolvedModel?'Concrete model identified.':'Routing alias only: underlying model is not attested.'}`,'completed',receipt.resolvedModel??receipt.responseModel,[],receipt.role==='Skeptic repair'?4:3);
      // The model can add a counterargument, never erase the deterministic invalidation rules.
      for(const critique of review.critiques){const stock=run.opportunities.find(s=>s.symbol===critique.symbol);if(!stock)continue;stock.bullCase=critique.bullCase;stock.bearCase=critique.bearCase;stock.analystNote=`Model-generated qualitative critique. Review original sources; factual entailment is unverified. Invalidation observation: ${critique.invalidation} Sources: ${critique.evidenceIds.join(', ')}. Numeric risk gates remain binding.`;}
      for(const warning of review.warnings)event('Evaluator','Validate and repair source-grounded output',warning,'warning');
      const nv=run.providers.find(p=>p.name==='NVIDIA Nemotron');
      if(nv && review.receipts.some(r=>r.nvidiaVerified)){nv.status='verified';nv.detail=`Concrete returned Nemotron model: ${review.receipts.find(r=>r.nvidiaVerified)!.resolvedModel}. This confirms route identity, not predictive accuracy.`;}
      event('Evaluator','Revalidate after model review',`Accepted ${review.critiques.length} source-cited counterarguments. Rechecked all numeric hard gates and retained deterministic exclusions. Model commentary cannot authorize an investment.`,'completed','deterministic/evidence-validator-v1',review.critiques.flatMap(c=>c.evidenceIds),4);
    }catch(error){
      if(!(error instanceof ProviderError))throw error;
      if(error instanceof NightshiftReviewError){
        run.cost.modelCalls=error.attemptedCalls;
        run.cost.actualUsd=error.attemptedCalls===error.receipts.length&&error.receipts.length&&error.receipts.every(r=>r.providerCostUsd!==null)?error.receipts.reduce((n,r)=>n+r.providerCostUsd!,0):null;
        for(const receipt of error.receipts)event('Evaluator','Reject generated model output',`Rejected response from ${receipt.resolvedModel??receipt.responseModel}; request ${receipt.requestId}; receipt ${receipt.receiptId??'unavailable'}; ${receipt.inputTokens??'?'} input / ${receipt.outputTokens??'?'} output tokens. Usage retained even though the answer did not pass validation.`,'rejected',receipt.resolvedModel??receipt.responseModel);
      }
      run.mode=synthetic?'sample':'degraded';
      const ns=run.providers.find(p=>p.name==='Meterless Nightshift');if(ns){ns.status='unavailable';ns.detail=error.message;}
      run.warnings.push('Primary Nightshift skeptical review did not complete. Its narratives remain deterministic; any independent exclusion audit is identified separately in the trace.');
      event('Evaluator','Escalate provider failure',error.message+' Preserve numeric screening; require a successful new connected run before relying on model commentary.','warning','provider/failure');
    }
    if(config.NIGHTSHIFT_AUDITOR_MODEL&&!run.abstained){
      try{
        const audit=await new NightshiftClient(config).auditExclusion(run);
        if(audit){
          run.cost.modelCalls+=audit.receipts.length;
          run.cost.actualUsd=run.cost.actualUsd!==null&&audit.receipts.every(r=>r.providerCostUsd!==null)?run.cost.actualUsd+audit.receipts.reduce((n,r)=>n+r.providerCostUsd!,0):null;
          for(const receipt of audit.receipts)event('Risk guardian','Independent model audits an exclusion',`Request ${receipt.requestId}; receipt ${receipt.receiptId??'not returned'}; ${receipt.inputTokens??'?'} input / ${receipt.outputTokens??'?'} output tokens. The auditor cannot remove a numeric veto.`,'completed',receipt.resolvedModel??receipt.responseModel,audit.evidenceIds,5);
          const excluded=run.opportunities.find(s=>s.symbol===audit.symbol&&s.status==='excluded');
          if(excluded){
            excluded.analystNote=(excluded.analystNote??'')+' Independent exclusion audit: '+audit.observation+' The original numeric veto remains binding.';
            event(audit.decision==='request_review'?'Planner':'Risk guardian',audit.decision==='request_review'?'Recheck a challenged exclusion':'Retain the independently reviewed exclusion',`${audit.symbol}: ${audit.observation} Recomputed decision: ${excluded.metrics.filter(m=>!m.passed).map(m=>`${m.name} ${m.value}% > ${m.limit}%`).join('; ')}. Exclusion retained.`,'completed','deterministic/risk-revalidation-v1',audit.evidenceIds,6);
          }
          if(audit.receipts.some(r=>r.nvidiaVerified)){const nv=run.providers.find(p=>p.name==='NVIDIA Nemotron');if(nv){nv.status='verified';nv.detail=`Independent exclusion audit handled by ${audit.receipts.find(r=>r.nvidiaVerified)!.resolvedModel}. Output remains unverified qualitative interpretation; hard risk gates stayed binding.`;}}
        }
      }catch(error){
        if(error instanceof NightshiftReviewError){
          const before=run.cost.actualUsd;run.cost.modelCalls+=error.attemptedCalls;
          run.cost.actualUsd=before!==null&&error.attemptedCalls===error.receipts.length&&error.receipts.every(r=>r.providerCostUsd!==null)?before+error.receipts.reduce((n,r)=>n+r.providerCostUsd!,0):null;
          for(const receipt of error.receipts)event('Evaluator','Reject independent auditor output',`Request ${receipt.requestId}; receipt ${receipt.receiptId??'not returned'}. Invalid auditor output did not change any stock decision.`,'rejected',receipt.resolvedModel??receipt.responseModel,[],5);
        }
        event('Evaluator','Escalate optional audit failure',error instanceof ProviderError?error.message:'Independent audit unavailable. Original exclusions retained.','warning','provider/failure',[],5);
        run.warnings.push('Optional independent exclusion audit did not complete. Deterministic exclusions remain in force.');
      }
    }
    if(synthetic)run.warnings.push('Connected research: Zetaris delivered synthetic fixtures. Real API calls are shown in the audit trail, but none of these figures represent current market data.');
  }else{
    run.providers=run.providers.map(p=>p.name==='Zetaris'||p.name==='Meterless Nightshift'?{...p,status:'sample',detail:'Not called in this offline sample run. Synthetic fixtures and deterministic research specialists were used.'}:p);
  }
  const snapshot=rememberResearch(run,memory.snapshot);
  event('Memory','Retain the decision in H-MEM','Saved account-scoped decision context and provenance for the next research run. Memory is historical context, never substitute market evidence.','completed','Meterless/H-MEM');
  run.durationMs=Date.now()-started;
  return {run,memorySnapshot:snapshot};
}

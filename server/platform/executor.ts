import {withFirebaseRequest} from '../firebase/context';
import {claimPlatformJob,finishPlatformJob,failPlatformJob,appendJobEvent} from './job-store';
import {runSourceReview,type SourceReviewInput} from './source-review';
import {runDeepResearch} from './research-service';
import {buildPersonalizedPlan} from './planning';
import {aiSettings} from './settings';
import {rememberPlatformDecision} from './memory';
import type {ResearchAgentInput} from '../../lib/ai/types';
import {instrumentKey} from '../../lib/finance/contracts';
import {AIError} from '../../lib/ai/errors';

export async function executePlatformJob(userId:string,id:string){const job=await claimPlatformJob(userId,id);if(!job)return {status:'not_claimed'};
 return withFirebaseRequest({user:{userId,displayName:'Background agent',email:null,fullName:null},startedAt:Date.parse(job.startedAt??job.createdAt)},async()=>{
  const event=(value:Parameters<typeof appendJobEvent>[2])=>appendJobEvent(userId,id,value);
  try{
   const result=job.workflow==='source_review'?await runSourceReview(userId,job.input as SourceReviewInput,event):job.kind==='plan'?await buildPersonalizedPlan(userId,id,job.input,event):await runDeepResearch(userId,job.input as ResearchAgentInput,event);
   result.id=id;
   await finishPlatformJob(userId,id,result);
   try{await rememberPlatformDecision(userId,{id,summary:job.workflow==='source_review'?'Source evidence review for '+instrumentKey((job.input as SourceReviewInput).instrument)+'. '+('sourceAudit'in result?'Missing inputs: '+(result.sourceAudit as {missing:string[]}).missing.join(', ')+'. ':'')+'No investment approval.':job.kind==='plan'?'Investment allocation prepared under the recorded goal and constraints. '+('summary'in result?result.summary:''):'Research finished with '+('findings'in result?result.findings.length:0)+' accepted findings; gaps and risks retained.',goal:job.workflow==='source_review'?'Source evidence review '+(job.input as SourceReviewInput).instrument.symbol:job.kind==='plan'?'Personalized investment plan':(job.input as ResearchAgentInput).question,symbols:job.workflow==='source_review'?[instrumentKey((job.input as SourceReviewInput).instrument)]:'findings'in result?result.findings.flatMap(f=>f.symbol?[f.symbol]:[]):'allocations'in result?result.allocations.flatMap(a=>a.symbol?[a.symbol]:[]):[],sourceIds:'evidence'in result?result.evidence.map(e=>e.id).slice(0,50):[],memoryGeneration:job.memoryGeneration,startedAt:Date.parse(job.startedAt??job.createdAt)});}catch{/* A cleared workspace must never be repopulated by a late memory write. */}
   return {status:'completed'};
  }catch(error){await failPlatformJob(userId,id,error instanceof AIError?error.code:'RESEARCH_UNAVAILABLE',error instanceof AIError?error.message:'The research could not be completed. Review your data and model connections before a new request.').catch(()=>{});return {status:'failed'};}
 });
}

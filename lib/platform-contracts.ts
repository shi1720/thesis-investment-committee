import type {ResearchAgentEvent,AIUsageReceipt,StructuredResearchReport} from './ai/types';
import type {PersonalizedPlan,PlanProfile} from './planning/contracts';
import type {InstrumentRef} from './finance/contracts';
export interface PlatformJob {id:string;kind:'research'|'plan';workflow?:'source_review';status:'queued'|'running'|'completed'|'failed';createdAt:string;updatedAt:string;startedAt?:string;completedAt?:string;input:unknown;memoryGeneration?:number;events:ResearchAgentEvent[];receipts?:AIUsageReceipt[];result:StructuredResearchReport|PersonalizedPlan|null;error?:{code:string;message:string}}
export interface ResearchRequest {markets:string[];sectors:string[];symbols?:string[];question:string;portfolioContext?:string;risk:{targetReturn:number;maxVolatility:number;maxDrawdown:number;horizonMonths:number}}
export interface SourceReviewRequest {instrument:InstrumentRef;question?:string}
export type PlatformJobInput=ResearchRequest|PlanProfile|SourceReviewRequest;

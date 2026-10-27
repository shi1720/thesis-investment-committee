export const AI_PROVIDERS=['nvidia','openai','anthropic','gemini','nightshift'] as const;
export type AIProvider=typeof AI_PROVIDERS[number];
export const AI_ROLES=['planner','fundamentals','quant','news','skeptic','evaluator'] as const;
export type AIRole=typeof AI_ROLES[number];
export const SEARCH_PROVIDERS=['brave','tavily'] as const;
export type SearchProvider=typeof SEARCH_PROVIDERS[number];
export interface ModelAssignment {provider:AIProvider;model:string|null}
export interface CatalogModel {id:string;name:string;createdAt?:string;contextWindow?:number;capability:'text'|'unverified';inferenceTested:boolean}
export interface ConnectionCheck {status:'untested'|'passed'|'failed';checkedAt?:string;model?:string;message?:string}
export interface ProviderSettings {id:AIProvider;name:string;keyConfigured:boolean;keyLast4:string|null;keySource:'account'|'operator'|null;models:CatalogModel[];catalogFetchedAt?:string;catalogStatus:'not_loaded'|'ready'|'error';connection:ConnectionCheck}
export interface AgentBudget {maxModelCalls:number;maxToolCalls:number;maxOutputTokens:number;maxTotalTokens:number;timeoutMs:number}
export interface PublicAISettings {defaultProvider:AIProvider;providers:ProviderSettings[];roles:Record<AIRole,ModelAssignment>;search:{provider:SearchProvider|null;configured:boolean};budget:AgentBudget;updatedAt?:string}
export interface ValidationIssue {path:string;code:string;expectedType?:string;receivedType?:string}
export interface AIUsageReceipt {id:string;role:AIRole|'connection_test';provider:AIProvider;requestedModel:string;responseModel:string|null;startedAt:string;latencyMs:number;inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;reportedCostUsd:number|null;requestId:string|null;status:'completed'|'failed'|'incomplete'|'invalid_output';errorCode?:string;validationIssues?:ValidationIssue[]}
/** Credentials exist only in the server request, never in a report or public settings. */
export interface ResolvedModel {provider:AIProvider;model:string;apiKey:string}
export interface CompletionRequest extends ResolvedModel {role:AIRole|'connection_test';system:string;prompt:string;maxOutputTokens:number;timeoutMs?:number;signal?:AbortSignal}
export interface Completion {text:string;receipt:AIUsageReceipt}
export interface AgentEvidence {id:string;kind:'quote'|'history'|'fundamentals'|'news'|'web'|'mandate'|'policy';symbol?:string;title:string;url?:string;source:string;asOf:string|null;retrievedAt:string;content:unknown;untrusted:boolean;warnings:string[]}
export interface ResearchAgentInput {kind?:'plan'|'research';markets:string[];sectors:string[];symbols?:string[];question:string;portfolioContext?:string;risk:{targetReturn:number;maxVolatility:number;maxDrawdown:number;horizonMonths:number}}
export interface AgentFinding {symbol:string|null;thesis:string;risks:string[];invalidation:string;confidence:'low'|'medium'|'high';evidenceIds:string[]}
export interface AgentStageResult {role:AIRole;summary:string;findings:AgentFinding[];questions:string[];evidenceIds:string[]}
export interface ResearchAgentEvent {id:string;at:string;stage:string;type:'started'|'tool'|'model'|'completed'|'warning'|'failed';message:string;evidenceIds?:string[];receiptId?:string;receipt?:AIUsageReceipt}
export interface StructuredResearchReport {id:string;status:'completed'|'incomplete'|'failed';startedAt:string;completedAt:string;input:ResearchAgentInput;plan:string[];findings:AgentFinding[];risks:string[];unansweredQuestions:string[];stages:AgentStageResult[];evidence:AgentEvidence[];receipts:AIUsageReceipt[];events:ResearchAgentEvent[];budget:{modelCalls:number;toolCalls:number;knownTokens:number;unknownUsageCalls:number};limitations:string[];error?:{code:string;message:string}}
/** Tools are implemented by trusted server adapters. No arbitrary URL fetch tool exists. */
export interface ResearchAgentTools {
 quote(symbol:string,signal?:AbortSignal):Promise<unknown>;
 history(symbol:string,signal?:AbortSignal):Promise<unknown>;
 fundamentals(symbol:string,signal?:AbortSignal):Promise<unknown>;
 news(query:string,signal?:AbortSignal):Promise<unknown>;
 webSearch?(query:string,signal?:AbortSignal):Promise<unknown>;
}

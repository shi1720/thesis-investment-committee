import { z } from 'zod';
export const markets = ['US','India','China','UAE'] as const;
export type Market = typeof markets[number];
export const profileSchema = z.object({
  markets: z.array(z.enum(markets)).min(1).max(4),
  targetReturn: z.number().finite().min(0).max(60),
  maxVolatility: z.number().finite().min(5).max(80),
  maxDrawdown: z.number().finite().min(5).max(80),
  horizonMonths: z.number().int().min(3).max(120),
  capital: z.number().finite().min(100).max(1000000000),
  baseCurrency: z.enum(['USD','INR','CNY','AED']),
  excludedSectors: z.array(z.string().max(60)).max(12).default([]),
  mode: z.enum(['sample','live']).default('sample'),
});
export type ResearchProfile = z.infer<typeof profileSchema>;
export const defaultProfile: ResearchProfile = {markets:['US','India'],targetReturn:12,maxVolatility:25,maxDrawdown:25,horizonMonths:36,capital:25000,baseCurrency:'USD',excludedSectors:[],mode:'sample'};
export interface Evidence { id: string; title: string; publisher: string; url: string; asOf: string; kind: 'filing'|'prices'|'macro'|'methodology'; excerpt: string; sample: boolean; }
export interface Stock { symbol:string; name:string; market:Market; exchange:string; currency:string; sector:string; price:number; annualReturn:number; annualVolatility:number; maxDrawdown:number; revenueGrowth:number; operatingMargin:number; debtToEquity:number; pe:number; dividendYield:number; marketCapBn:number; quality:number; prices:number[]; evidence:Evidence[]; catalyst:string; risk:string; thesis:string; asOf:string; }
export interface Opportunity extends Stock { score:number; status:'qualified'|'watch'|'excluded'; reasons:string[]; bullCase:string; bearCase:string; invalidation:string; metrics:{name:string;value:number;limit:number;passed:boolean}[]; targetGap:number; analystNote?:string; }
export interface AgentEvent { id:string; at:string; agent:'Planner'|'Data steward'|'Quant analyst'|'Fundamental analyst'|'Skeptic'|'Risk guardian'|'Evaluator'|'Memory'; action:string; detail:string; status:'running'|'completed'|'warning'|'rejected'; iteration:number; model:string; evidenceIds:string[]; }
export interface Scenario { name:string; description:string; shock:number; values:{symbol:string;impact:number}[]; }
export interface ProviderStatus { name:string; status:'sample'|'configured'|'unavailable'|'verified'; detail:string; }
export interface ResearchRun { id:string; createdAt:string; profile:ResearchProfile; mode:'sample'|'live'|'degraded'; title:string; summary:string; opportunities:Opportunity[]; events:AgentEvent[]; scenarios:Scenario[]; evidence:Evidence[]; universeCount:number; eligibleCount:number; abstained:boolean; feasibility:{status:'aligned'|'stretch'|'conflict';message:string}; providers:ProviderStatus[]; memory:{reused:boolean;lessons:string[]}; durationMs:number; cost:{modelCalls:number;estimatedUsd:number;actualUsd:number|null}; methodology:string[]; warnings:string[]; }
export interface SavedThesis { id:string;symbol:string;name:string;market:Market;runId:string;createdAt:string;invalidation:string;note:string; }
export interface Bootstrap { user:{name:string;email:string|null;signedIn:boolean}; providers:ProviderStatus[]; universe:Stock[]; recentRuns:ResearchRun[]; watchlist:SavedThesis[]; }

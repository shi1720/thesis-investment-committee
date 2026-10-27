import {latestMarketScan} from './screening';
import {researchUniverse,selectResearchUniverse,type ResearchInstrument} from '../../lib/finance/universe';
import {instrumentKey,type InstrumentRef,type FactorInput} from '../../lib/finance/contracts';
import {analyzeHistory} from '../../lib/finance/math';
import {scoreFactors} from '../../lib/finance/features';
import {runResearchAgents,researchAgentInputSchema} from './agent-runner';
import {AIClient} from '../../lib/ai/client';
import {searchWeb} from '../../lib/ai/search';
import type {ResearchAgentInput,ResearchAgentTools,ResearchAgentEvent,StructuredResearchReport} from '../../lib/ai/types';
import {aiSettings} from './settings';
import {marketClient,newsMarketClient,observedQuote,observedHistory,observedFundamentals} from './market-service';
import {publicNews} from './news';
import {recallPlatformMemory} from './memory';
import {HttpError} from '../../lib/server/http';

export async function resolveInstrument(userId:string,symbol:string,markets:string[]):Promise<InstrumentRef>{const upper=symbol.toUpperCase(),matches=researchUniverse.filter(i=>markets.includes(i.market)&&[i.symbol.toUpperCase(),instrumentKey(i).toUpperCase(),`${i.exchange}:${i.symbol}`.toUpperCase()].includes(upper));if(matches.length===1)return matches[0];if(matches.length>1)throw new HttpError(400,'Choose an exchange-qualified instrument.','AMBIGUOUS_SYMBOL');const client=await marketClient(userId);if(client){const result=await client.search(symbol,markets.length===1?markets[0] as InstrumentRef['market']:undefined),found=result.data?.filter(i=>markets.includes(i.market)&&(i.symbol.toUpperCase()===upper||instrumentKey(i).toUpperCase()===upper));if(found?.length===1)return found[0];}throw new HttpError(422,'The requested symbol could not be verified in the selected markets.','SYMBOL_UNVERIFIED');}
export async function runDeepResearch(userId:string,raw:ResearchAgentInput,onEvent?:(event:ResearchAgentEvent)=>Promise<void>):Promise<StructuredResearchReport>{
 const input=researchAgentInputSchema.parse(raw),settings=await aiSettings.getPublic(userId),selected=input.symbols?.length?await Promise.all(input.symbols.map(s=>resolveInstrument(userId,s,input.markets))):selectResearchUniverse({markets:input.markets as InstrumentRef['market'][],sectors:input.sectors,limit:4});
 // Exchange-qualified identifiers remain unique across countries and source tools.
 const symbols=selected.map(instrumentKey),map=new Map(selected.map(i=>[instrumentKey(i),i]));
 const find=(symbol:string)=>{const direct=map.get(symbol);if(direct)return direct;const matches=selected.filter(i=>i.symbol.toUpperCase()===symbol.toUpperCase());if(matches.length===1)return matches[0];throw new HttpError(422,'The agent requested an instrument outside the verified research scope.','TOOL_SCOPE');};
 const factorInputs=new Map<string,FactorInput>();for(const i of selected)factorInputs.set(instrumentKey(i),{instrument:i,history:null,fundamentals:null});
 const tools:ResearchAgentTools={
  quote:async symbol=>observedQuote(userId,find(symbol)),
  history:async symbol=>{const i=find(symbol),value=await observedHistory(userId,i);if(value.data)factorInputs.get(instrumentKey(i))!.history=analyzeHistory(value.data);return value;},
  fundamentals:async symbol=>{const i=find(symbol),value=await observedFundamentals(userId,i);if(value.data)factorInputs.get(instrumentKey(i))!.fundamentals=value.data;return value;},
  news:async query=>{const client=await newsMarketClient(userId),instrument=selected.find(i=>query.toUpperCase().includes(i.symbol.toUpperCase()));if(client&&instrument){const value=await client.news(instrument,{days:14,limit:8});if(value.data?.length)return value;}return publicNews(selected,query);},
 };
 const search=await aiSettings.resolveSearch(userId);if(search)tools.webSearch=(query,signal)=>searchWeb(search,query,{signal});
 const memory=await recallPlatformMemory(userId,input.question);await onEvent?.({id:crypto.randomUUID(),at:new Date().toISOString(),stage:'memory',type:'completed',message:`Official H-MEM recalled ${memory.count} historical decisions. Historical context cannot establish current market facts.`});
 const report=await runResearchAgents({...input,symbols,portfolioContext:[input.portfolioContext,memory.context?'Historical context, not current market evidence:\n'+memory.context.slice(0,2000):''].filter(Boolean).join('\n').slice(0,8000)},{tools,resolveModel:role=>aiSettings.resolveAssignment(userId,role),budget:settings.budget,onEvent,client:new AIClient({nightshiftBaseUrl:process.env.NIGHTSHIFT_BASE_URL})});
 const savedScan=await latestMarketScan(userId),compatibleScan=savedScan&&Date.now()-Date.parse(savedScan.completedAt)<24*3600000?savedScan:null;
 const quantitative={cohort:compatibleScan?{completedAt:compatibleScan.completedAt,inputs:compatibleScan.inputs,sources:compatibleScan.sources}:null,history:[...factorInputs.values()].map(i=>({instrument:i.instrument,analysis:i.history})),factors:compatibleScan?compatibleScan.factors.filter(f=>symbols.includes(instrumentKey(f.instrument))):scoreFactors([...factorInputs.values()],{minPeers:5}),warnings:['Factor ranks are withheld when the research scope lacks enough comparable, dated observations. They are research heuristics rather than forecasts.']};
 return Object.assign(report,{quantitative,memory:{reused:memory.reused,count:memory.count,engine:'Meterless H-MEM'}});
}

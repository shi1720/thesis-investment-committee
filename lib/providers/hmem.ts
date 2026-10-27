import type { ResearchProfile, ResearchRun } from '../contracts';
import { HMEM, type LedgerEntry, type MemoryRecord, type QueryResult } from './meterless-hmem';
export { HMEM } from './meterless-hmem';
export type { MemoryRecord } from './meterless-hmem';
export const HMEM_COMMIT='1742dec56a66e58eef9dda2d2b865823758ca8cd';
export interface MemoryArchive {entries:LedgerEntry[];evictedRecords:MemoryRecord[];}
export interface MemorySnapshot {version:1;engineCommit:string;state:{records:MemoryRecord[];seq:number};ledger:LedgerEntry[];retention?:{maxRecords:256;maxAuditEntries:512;totalEvictedRecords:number;totalArchivedAuditEntries:number};pendingArchive?:MemoryArchive;}
const MAX_RECORDS=256;
const MAX_AUDIT_ENTRIES=512;
function hydrate(snapshot?:MemorySnapshot):HMEM {
  const hmem=new HMEM({actor:'thesis-committee'});
  if(snapshot){
    if(snapshot.version!==1||snapshot.engineCommit!==HMEM_COMMIT||!Array.isArray(snapshot.state?.records)||snapshot.state.records.length>1000||!Number.isSafeInteger(snapshot.state.seq)||snapshot.state.seq<0)throw new Error('Unsupported H-MEM snapshot.');
    hmem.store.restoreAll(snapshot.state.records,snapshot.state.seq);
  }
  return hmem;
}
function snapshot(hmem:HMEM,prior?:MemorySnapshot):MemorySnapshot{
  const evictedRecords:MemoryRecord[]=[];
  const records=hmem.store.all();
  if(records.length>MAX_RECORDS){
    const oldest=[...records].sort((a,b)=>{
      // Current user preferences survive before stale factual context.
      const protectA=a.type==='preference'&&!a.supersededBy?1:0;
      const protectB=b.type==='preference'&&!b.supersededBy?1:0;
      return protectA-protectB || a.lastAccessed-b.lastAccessed || a.timestamp-b.timestamp || a.id.localeCompare(b.id);
    });
    for(const record of oldest.slice(0,records.length-MAX_RECORDS)){
      evictedRecords.push(structuredClone(record));
      hmem.store.delete(record.id,'Bounded product context retention; prior record exported to the user-scoped audit archive.');
    }
  }
  const allEntries=[...(prior?.ledger??[]),...hmem.ledger.all()];
  const archivedEntries=allEntries.slice(0,Math.max(0,allEntries.length-MAX_AUDIT_ENTRIES));
  const entries=[...(prior?.pendingArchive?.entries??[]),...archivedEntries];
  const archivedRecords=[...(prior?.pendingArchive?.evictedRecords??[]),...evictedRecords];
  return {version:1,engineCommit:HMEM_COMMIT,state:hmem.store.snapshotAll(),ledger:allEntries.slice(-MAX_AUDIT_ENTRIES),retention:{maxRecords:MAX_RECORDS,maxAuditEntries:MAX_AUDIT_ENTRIES,totalEvictedRecords:(prior?.retention?.totalEvictedRecords??0)+evictedRecords.length,totalArchivedAuditEntries:(prior?.retention?.totalArchivedAuditEntries??0)+archivedEntries.length},...(entries.length||archivedRecords.length?{pendingArchive:{entries,evictedRecords:archivedRecords}}:{})};
}
function profileText(profile:ResearchProfile):string{return `${profile.markets.join(' ')} investment risk volatility limit ${profile.maxVolatility} drawdown limit ${profile.maxDrawdown} target return ${profile.targetReturn} horizon ${profile.horizonMonths} months.`}
function recordRun(hmem:HMEM,run:ResearchRun):void {
  const source='research-run:'+run.id;
  if(hmem.store.all().some(m=>m.source===source))return;
  const text=profileText(run.profile);
  hmem.add({content:`Historic research decision: ${text} ${run.abstained?'The committee abstained.':'The committee produced a research shortlist.'}`,source,type:'factual',layer:'long_term',confidence:1,tags:['investment','risk','volatility','drawdown',...run.profile.markets],provenance:{origin:'plan_completion',learnedAt:Date.parse(run.createdAt),label:'Previous research run '+run.id,refs:[run.id]}});
  for(const excluded of run.opportunities.filter(o=>o.status==='excluded').slice(0,3)){
    hmem.add({content:`Historic ${excluded.market} investment risk review rejected ${excluded.symbol}: ${excluded.reasons.join(' ')} Recheck against current evidence before changing the decision.`,source,type:'factual',layer:'working',confidence:0.9,tags:['investment','risk','volatility',excluded.market,excluded.symbol],provenance:{origin:'plan_completion',learnedAt:Date.parse(run.createdAt),label:'Risk exclusion in '+run.id,refs:[run.id,excluded.symbol]}});
  }
}
/** The caller must supply only this authenticated user’s D1 snapshot and runs. */
export function recallResearchMemory(profile:ResearchProfile,previousRuns:ResearchRun[]=[],persisted?:MemorySnapshot):{lessons:string[];context:string;reused:boolean;snapshot:MemorySnapshot;trace:QueryResult['trace']} {
  const hmem=hydrate(persisted);
  for(const run of previousRuns.slice(0,20))recordRun(hmem,run);
  const recalled=hmem.query(profileText(profile),{topN:5});
  const lessons=recalled.memories.filter(m=>!m.memory.supersededBy).map(m=>m.memory.content);
  return {lessons,context:recalled.context,reused:lessons.length>0,snapshot:snapshot(hmem,persisted),trace:recalled.trace};
}
export function rememberResearch(run:ResearchRun,persisted?:MemorySnapshot):MemorySnapshot {
  const hmem=hydrate(persisted);recordRun(hmem,run);return snapshot(hmem,persisted);
}
/** Explicit preference corrections keep the old record and add a supersession edge. */
export function rememberPreference(content:string,source:string,persisted?:MemorySnapshot):MemorySnapshot {
  const hmem=hydrate(persisted);
  const old=[...hmem.store.all()].reverse().find(m=>m.type==='preference'&&!m.supersededBy);
  const added=hmem.add({content,source,type:'preference',layer:'long_term',confidence:1,tags:['investment','risk','volatility'],supersedes:old?.id,provenance:{origin:'user_correction',learnedAt:Date.now(),label:source}});
  if(old)hmem.store.update(old.id,{supersededBy:added.id});
  return snapshot(hmem,persisted);
}

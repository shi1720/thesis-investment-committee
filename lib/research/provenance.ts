import type { ResearchRun, Stock } from '../contracts';
export function isSyntheticStock(stock:Pick<Stock,'evidence'>):boolean{return stock.evidence.some(e=>e.sample);}
/** Data origin and model-review completion are independent facts. */
export function researchPresentation(run?:Pick<ResearchRun,'mode'|'profile'|'providers'|'evidence'>|null){
  const hasObservedData=!!run&&run.evidence.length>0&&run.evidence.every(e=>!e.sample);
  const reviewIncomplete=!!run&&(run.mode==='degraded'||(run.profile.mode==='live'&&run.providers.some(p=>p.name==='Meterless Nightshift'&&p.status==='unavailable')));
  return {hasObservedData,reviewIncomplete,label:reviewIncomplete?'AI review incomplete':hasObservedData?'Connected research':'Sample workspace'};
}

import { profileSchema, type ResearchProfile, type ResearchRun, type Stock, type Opportunity, type AgentEvent, type Evidence, type Scenario } from '../contracts';
import { sampleUniverse, SAMPLE_NOTICE, SAMPLE_AS_OF } from './sample-data';
import { priceMetrics, round, type PriceMetrics } from './math';

export interface ResearchOptions {
  previousRuns?: ResearchRun[];
  stocks?: Stock[];
  now?: Date;
  id?: string;
  /** A caller may supply lessons recalled through the official Meterless H-MEM runtime. */
  memoryLessons?: string[];
}
const RULE_MODEL = 'deterministic/research-rules-v1';
const DAY_MS = 86400000;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const money = (n: number) => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(n);
const dedupe = <T,>(items: T[]) => [...new Set(items)];

export function assessFeasibility(p: ResearchProfile): ResearchRun['feasibility'] {
  // Explicit product suitability policy, not an efficient frontier or a return forecast.
  if ((p.targetReturn >= 25 && (p.maxVolatility <= 20 || p.maxDrawdown <= 15)) ||
      (p.horizonMonths <= 12 && p.targetReturn >= 25) ||
      (p.horizonMonths <= 6 && p.maxDrawdown <= 10 && p.targetReturn > 0)) {
    return {status:'conflict',message:'Your goal and risk budget conflict under the research policy. The committee will abstain rather than imply these returns can be delivered. Revisit the return aspiration, time horizon or risk limits.'};
  }
  if (p.targetReturn > 15 || p.horizonMonths < 24 || p.maxDrawdown <= 10) {
    return {status:'stretch',message:'This mandate needs extra scrutiny. A high return aspiration, short horizon or narrow loss budget can leave few suitable research candidates; historical results cannot establish the likelihood of meeting your goal.'};
  }
  return {status:'aligned',message:'The preferences are coherent enough for a research screen. This is a policy assessment, not a forecast that the return goal or loss limit will be achieved.'};
}

function validateStock(stock: Stock, now: Date, live: boolean): {issues: string[];quant:PriceMetrics|null} {
  const issues: string[] = [];
  let quant:PriceMetrics|null = null;
  if (!stock.symbol || !stock.name || !['US','India','China','UAE'].includes(stock.market)) issues.push('Missing or invalid security identity.');
  if (!['USD','INR','CNY','AED','HKD'].includes(stock.currency)) issues.push('Unsupported listing currency.');
  const numeric = [stock.price,stock.revenueGrowth,stock.operatingMargin,stock.debtToEquity,stock.pe,stock.dividendYield,stock.marketCapBn,stock.quality];
  if (numeric.some(v => !Number.isFinite(v)) || stock.price <= 0 || stock.marketCapBn <= 0 || stock.quality < 0 || stock.quality > 100 || stock.debtToEquity < 0 || stock.pe < 0 || stock.dividendYield < 0) issues.push('Fundamentals contain missing, non-finite or invalid values.');
  try { quant = priceMetrics(stock.prices); } catch (e) { issues.push(e instanceof Error ? e.message : 'Invalid adjusted price history.'); }
  if (quant && Number.isFinite(stock.price)) {
    const lastClose = stock.prices[stock.prices.length-1];
    if (Math.abs(stock.price-lastClose)/lastClose>0.001) issues.push('Latest adjusted closing price is inconsistent with the end of its price history (more than 0.1% difference).');
  }
  const asOf = Date.parse(stock.asOf);
  if (!Number.isFinite(asOf) || (now.getTime()-asOf)/DAY_MS > 45 || asOf > now.getTime()+DAY_MS) issues.push('Market snapshot is undated, future-dated or more than 45 days old.');
  if (!Array.isArray(stock.evidence) || stock.evidence.length === 0) issues.push('No source provenance is attached.');
  else {
    if (stock.evidence.some(e => !e.id || !e.excerpt || !e.publisher || !Number.isFinite(Date.parse(e.asOf)) || !(/^https:\/\//.test(e.url) || (e.sample && /^#sample-[a-z0-9-]+$/.test(e.url))))) issues.push('Source provenance is incomplete or uses an unsafe URL.');
    if (live) {
      if (stock.evidence.some(e => e.sample)) issues.push('Sample evidence cannot qualify as live financial evidence.');
      for (const evidence of stock.evidence) {
        const sourceDate = Date.parse(evidence.asOf);
        if (!Number.isFinite(sourceDate)) continue; // Incomplete provenance is already rejected above.
        if (evidence.kind==='prices' && now.getTime()-sourceDate>45*DAY_MS) {
          issues.push(`Price provenance ${evidence.id} is more than 45 days old. A fresh security snapshot cannot replace a current price source.`);
        }
        if ((evidence.kind==='prices'||evidence.kind==='filing') && sourceDate>now.getTime()+DAY_MS) {
          issues.push(`${evidence.kind==='prices'?'Price':'Filing'} provenance ${evidence.id} is future-dated by more than one day.`);
        }
        // Older annual filings are legitimate dated sources. Their relevance
        // still needs review; a price-source age limit is not a filing-age limit.
      }
    }
  }
  return {issues,quant};
}

function valueScore(stock: Stock): number {
  if (stock.pe === 0 || stock.operatingMargin <= 0) return 15;
  // Within this small discovery universe, valuation is a research heuristic, not intrinsic value.
  const sectorAnchor = stock.sector === 'Financials' ? 17 : stock.sector === 'Utilities' ? 20 : 30;
  return clamp(100 - Math.max(0, stock.pe - sectorAnchor) * 2.3, 0, 100);
}
function rank(stock: Stock, quant:PriceMetrics, p:ResearchProfile, skepticPenalty:number): number {
  const riskRoom = (clamp(1-quant.annualVolatility/(p.maxVolatility*1.6),0,1) + clamp(1-quant.maxDrawdown/(p.maxDrawdown*1.6),0,1))/2*100;
  const fundamentals = clamp(stock.revenueGrowth*1.4 + stock.operatingMargin*1.05 + 20,0,100);
  const historyFit = clamp(100-Math.max(0,p.targetReturn-quant.annualReturn)*4,0,100);
  return round(clamp(stock.quality*0.30+riskRoom*0.25+fundamentals*0.20+valueScore(stock)*0.15+historyFit*0.10-skepticPenalty,0,100),1);
}

function stressScenarios(opportunities: Opportunity[], p:ResearchProfile): Scenario[] {
  const candidates = opportunities.filter(s => s.status !== 'excluded').slice(0,8);
  return [
    {name:'Equity sell-off',description:'Illustrative local-currency stress: a −20% broad-equity shock, scaled by each security’s sample volatility / 20, capped at −65%. This assumed sensitivity is not an estimated beta or a forecast.',shock:-20,values:candidates.map(s=>({symbol:s.symbol,impact:round(clamp(-20*s.annualVolatility/20,-65,0))}))},
    {name:'Rates stay higher',description:'Illustrative +100 bp rate shock with assumed sector impacts: real estate −12%, utilities −9%, technology −8%, financials −5%, other sectors −6%. These assumptions are not a calibrated factor model.',shock:1,values:candidates.map(s=>({symbol:s.symbol,impact: s.sector==='Real estate'?-12:s.sector==='Utilities'?-9:s.sector==='Technology'?-8:s.sector==='Financials'?-5:-6}))},
    {name:'Currency headwind',description:`Illustrative isolated FX stress: a security’s listing currency weakens 5% against ${p.baseCurrency}; same-currency listings have 0% FX impact. No live FX conversion, hedging, taxes or fees are modeled.`,shock:-5,values:candidates.map(s=>({symbol:s.symbol,impact:s.currency===p.baseCurrency?0:-5}))},
  ];
}

/**
 * Bounded research state machine. The next branch depends on measured data, critique,
 * suitability and earlier decisions. Deterministic specialists do real validation and
 * calculation; their trace never claims an LLM was called in sample mode.
 */
export async function runResearch(rawProfile: ResearchProfile, options:ResearchOptions = {}): Promise<ResearchRun> {
  const started = Date.now();
  const p = profileSchema.parse(rawProfile);
  p.markets = dedupe(p.markets);
  p.excludedSectors = dedupe(p.excludedSectors.map(s=>s.trim()).filter(Boolean));
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Research timestamp must be valid.');
  const id = options.id ?? crypto.randomUUID();
  const at = now.toISOString();
  const events:AgentEvent[] = [];
  let sequence = 0;
  const emit = (agent:AgentEvent['agent'],action:string,detail:string,status:AgentEvent['status']='completed',iteration=1,evidenceIds:string[]=[]) => events.push({id:`${id}-event-${++sequence}`,at,agent,action,detail,status,iteration,model:RULE_MODEL,evidenceIds:dedupe(evidenceIds)});
  const isLive = p.mode === 'live';
  const stocks = options.stocks ?? (isLive ? [] : sampleUniverse);
  // Sample mode replays a fixed synthetic snapshot; it must remain reproducible
  // after the fixture date. Live mode alone evaluates freshness against now.
  const evaluationClock = isLive ? now : new Date(`${SAMPLE_AS_OF}T23:59:59.999Z`);
  const rawScope = stocks.filter(s=>p.markets.includes(s.market));
  const canonicalEvidence = (e:Evidence) => JSON.stringify([e.id,e.title,e.publisher,e.url,e.asOf,e.kind,e.excerpt,e.sample]);
  const sourceVersions = new Map<string,Set<string>>();
  for(const s of rawScope)for(const e of s.evidence??[]){
    const variants=sourceVersions.get(e.id)??new Set<string>();variants.add(canonicalEvidence(e));sourceVersions.set(e.id,variants);
  }
  const conflictingIds = new Set([...sourceVersions].filter(([,versions])=>versions.size>1).map(([id])=>id));
  const quarantinedAliases = new Map<string,string>();
  const reservedSourceIds = new Set(sourceVersions.keys());
  let aliasSequence=0;
  for(const id of [...conflictingIds].sort())for(const version of [...sourceVersions.get(id)!].sort()){
    let alias:string;
    do {alias=`conflict-${++aliasSequence}-${id.slice(0,120)}`;} while(reservedSourceIds.has(alias));
    reservedSourceIds.add(alias);quarantinedAliases.set(version,alias);
  }
  const sourceIntegrityIssues = new Map<Stock,string>();
  const scope = rawScope.map(stock=>{
    const affected=(stock.evidence??[]).filter(e=>conflictingIds.has(e.id));
    if(!affected.length)return stock;
    // Preserve every conflicting source verbatim under a quarantined unique ID,
    // rather than silently overwrite one company’s evidence in the dossier.
    const copy={...stock,evidence:stock.evidence.map(e=>conflictingIds.has(e.id)?{...e,id:quarantinedAliases.get(canonicalEvidence(e))!}:e)};
    sourceIntegrityIssues.set(copy,`Ambiguous source identifier collision: ${dedupe(affected.map(e=>e.id)).join(', ')} refers to contradictory records. Sources were quarantined; this security cannot qualify.`);
    return copy;
  });
  const feasibility = assessFeasibility(p);
  const warnings:string[] = [];
  const previous = (options.previousRuns ?? []).slice(0,20);
  const lessons = dedupe((options.memoryLessons ?? []).map(s=>s.slice(0,600))).slice(0,8);
  if (!lessons.length && previous.length) {
    const priorRejected = dedupe(previous.flatMap(r=>r.opportunities.filter(s=>s.status==='excluded' && (s.annualVolatility>r.profile.maxVolatility || s.maxDrawdown>r.profile.maxDrawdown)).map(s=>s.symbol))).slice(0,6);
    if (priorRejected.length) lessons.push(`Recheck previously rejected risk exposures against this mandate: ${priorRejected.join(', ')}. Earlier decisions are context only, not fresh evidence.`);
    if (previous.some(r=>r.abstained)) lessons.push('A prior mandate caused abstention. Reassess feasibility before producing a shortlist; do not loosen risk limits to fill it.');
    if (previous.some(r=>r.profile.maxVolatility!==p.maxVolatility || r.profile.maxDrawdown!==p.maxDrawdown)) lessons.push('Risk limits changed since an earlier run. Recompute every hard gate from prices; do not reuse eligibility labels.');
  }
  emit('Planner','Compile your research mandate',`${p.markets.join(' + ')}; ${p.horizonMonths}-month horizon; ${p.targetReturn}% annual return aspiration; volatility ≤${p.maxVolatility}%; historical drawdown ≤${p.maxDrawdown}%. ${p.baseCurrency} ${money(p.capital)} is a research budget, not an allocation order.`);
  if (lessons.length) emit('Memory','Recall previous committee decisions',`${lessons.join(' ')} Current evidence and hard limits still govern every outcome.`);
  emit('Data steward','Establish provenance and listing scope',`${scope.length} securities in the selected market universe. ${isLive?'Live sources require dated provenance and adjusted closing prices.':'All price paths and fundamentals are synthetic fixtures. Company source links are discovery references, not support for the sample figures.'}`,isLive&&!scope.length?'warning':'completed',1,scope.flatMap(s=>s.evidence?.map(e=>e.id)??[]));
  if (conflictingIds.size) warnings.push(`${conflictingIds.size} source identifiers referred to contradictory records. Every affected security was excluded; conflicting records are retained with unique conflict-* IDs for inspection.`);
  if (!scope.length) warnings.push(isLive?'No live universe was supplied. Configure and verify Zetaris before requesting live research.':'No securities are available in the selected markets.');
  if (!isLive) warnings.push(`${SAMPLE_NOTICE} Sample validation replays the fixed ${SAMPLE_AS_OF} fixture clock; the run creation time is not a current market-data timestamp.`);
  if (scope.some(s=>s.currency!==p.baseCurrency)) warnings.push(`Returns and risk are in each security’s listing currency. They are not normalized to ${p.baseCurrency}; FX, taxes, access restrictions, fees and investability require separate verification. Capital is not converted into share allocations.`);
  if (p.horizonMonths<24) warnings.push('A short horizon can make equity losses difficult to recover from. Historical annualized metrics should not be read as a short-term forecast.');
  const historyYears = scope.length ? Math.min(...scope.map(s=>Math.max(0,(s.prices?.length??0)-1)/252)) : 0;
  if (historyYears>0 && p.horizonMonths>historyYears*12) warnings.push(`The shortest supplied price history spans about ${round(historyYears,1)} years, shorter than your ${p.horizonMonths}-month horizon; it cannot establish performance across that full horizon.`);
  if (feasibility.status!=='aligned') emit('Risk guardian','Challenge the goal and loss budget',feasibility.message,'warning');
  if (p.excludedSectors.length) emit('Planner','Apply sector exclusions',`Exclude ${p.excludedSectors.join(', ')} before ranking; excluded sectors cannot be restored by model commentary.`);

  type WorkingCandidate = {opportunity:Opportunity;quant:PriceMetrics|null;issues:string[];critiques:string[];penalty:number};
  const working:WorkingCandidate[] = [];
  let invalidCount = 0;
  // Stage 1: establish valid evidence and calculate an initial uncritiqued ranking.
  // Risk metrics are measured here, but the risk guardian owns the later veto.
  for (const stock of scope) {
    const {issues,quant} = validateStock(stock,evaluationClock,isLive);
    const sourceIssue=sourceIntegrityIssues.get(stock);if(sourceIssue)issues.push(sourceIssue);
    const q = quant ?? {annualReturn:0,annualVolatility:0,maxDrawdown:0,observations:0};
    const metrics = [
      {name:'Annualized volatility',value:round(q.annualVolatility),limit:p.maxVolatility,passed:!!quant&&q.annualVolatility<=p.maxVolatility},
      {name:'Historical max drawdown',value:round(q.maxDrawdown),limit:p.maxDrawdown,passed:!!quant&&q.maxDrawdown<=p.maxDrawdown},
    ];
    const reasons:string[] = [...issues];
    let status:Opportunity['status'] = issues.length?'excluded':'qualified';
    if (issues.length) invalidCount++;
    if (p.excludedSectors.some(s=>s.toLowerCase()===stock.sector.toLowerCase())) {status='excluded';reasons.push(`The ${stock.sector} sector is excluded by your mandate.`);}
    const invalidation = `Reopen the thesis if annualized volatility exceeds ${p.maxVolatility}%, observed drawdown exceeds ${p.maxDrawdown}%, dated evidence becomes stale, or the catalyst fails to appear in verified filings. ${stock.risk}`;
    const opportunity:Opportunity = {...stock,annualReturn:round(q.annualReturn),annualVolatility:round(q.annualVolatility),maxDrawdown:round(q.maxDrawdown),score:quant&&!issues.length?rank(stock,q,p,0):0,status,reasons,bullCase:`${isLive?'Research hypothesis':'Illustrative upside thesis'}: ${stock.catalyst} The source filings must substantiate this mechanism before any investment decision.`,bearCase:`The skeptic’s countercase: ${stock.risk}`,invalidation,metrics,targetGap:round(Math.max(0,p.targetReturn-q.annualReturn)),analystNote:isLive?'Deterministic quantitative screen of supplied data; model commentary cannot override hard risk gates.':'Deterministic committee analysis of synthetic fixtures. No model API was called.'};
    working.push({opportunity,quant,issues,critiques:[],penalty:0});
  }
  const sortByScore = (a:WorkingCandidate,b:WorkingCandidate) => b.opportunity.score-a.opportunity.score || a.opportunity.symbol.localeCompare(b.opportunity.symbol);
  working.sort(sortByScore);
  const initialTop = working.filter(w=>w.opportunity.status!=='excluded').slice(0,3).map(w=>`${w.opportunity.symbol} (${w.opportunity.score})`).join(', ') || 'none';
  const quantRefs = scope.flatMap(s=>s.evidence?.filter(e=>e.kind==='prices').map(e=>e.id)??[]);
  emit('Quant analyst','Recompute risk from adjusted closing prices',`Calculated CAGR, sample standard deviation of simple daily returns × √252, and peak-to-trough drawdown. ${invalidCount} source records failed validation. Reported summary metrics were not trusted.`,invalidCount?'warning':'completed',1,quantRefs);
  emit('Fundamental analyst','Build the initial uncritiqued ranking',`Initial leaders: ${initialTop}. Evaluated business quality (30%), risk headroom (25%), growth/margin inputs (20%), valuation heuristic (15%) and historical aspiration comparison (10%). These are research heuristics; historical return is not expected future return.`, 'completed',1,scope.flatMap(s=>s.evidence?.filter(e=>e.kind==='filing').map(e=>e.id)??[]));

  // Stage 2: the skeptic inspects the initial candidates and returns revision tasks.
  for (const w of working) {
    const s=w.opportunity;
    if(w.issues.length) continue;
    if (s.operatingMargin<=0 || s.revenueGrowth<0) {w.critiques.push('The earnings recovery is unproven: negative growth or operating margin weakens the fundamental case.');w.penalty+=18;}
    if (s.pe>45) {w.critiques.push(`The ${s.pe}× P/E multiple leaves the thesis sensitive to earnings disappointments.`);w.penalty+=10;}
    if (s.debtToEquity>1.2 && s.sector!=='Financials') {w.critiques.push(`Debt/equity of ${s.debtToEquity}× increases financing exposure.`);w.penalty+=12;}
    if (s.quality<65) {w.critiques.push('Quality inputs are below the committee’s 65/100 research threshold.');w.penalty+=10;}
    if (p.horizonMonths<=12) {w.critiques.push('Your short horizon is a poor match for an equity thesis whose catalysts may take years.');w.penalty+=8;}
    if (s.currency!==p.baseCurrency) {w.critiques.push(`The ${s.currency} listing adds unmodeled currency exposure against your ${p.baseCurrency} budget.`);w.penalty+=2;}
  }
  const challenged = working.filter(w=>w.critiques.length);
  emit('Skeptic','Challenge the initial ranking',challenged.length?`${challenged.length} theses triggered revision tasks. ${challenged.slice(0,5).map(w=>`${w.opportunity.symbol}: ${w.critiques.join(' ')}`).join(' ')}`:'No additional valuation, earnings, leverage, horizon or currency challenge was triggered. Route the initial candidates directly to hard risk review.',challenged.length?'warning':'completed',1,challenged.flatMap(w=>w.opportunity.evidence.map(e=>e.id)));

  // Stage 3 is conditional: critique changes actual candidate scores and statuses.
  if (challenged.length) {
    const changes:string[]=[];
    for(const w of challenged){
      const s=w.opportunity, baseline=s.score;
      if(w.quant) s.score=rank(s,w.quant,p,w.penalty);
      s.reasons.push(...w.critiques);
      s.bearCase += ` ${w.critiques[0]}`;
      if((s.operatingMargin<=0 || s.quality<65 || p.horizonMonths<=12) && s.status!=='excluded')s.status='watch';
      s.analystNote += ` Initial score ${baseline}; revised to ${s.score} after skeptic review.`;
      changes.push(`${s.symbol}: ${baseline} → ${s.score}${s.status==='watch'?' (watch-only)':''}`);
    }
    working.sort(sortByScore);
    emit('Planner','Revise the research plan after critique',`Applied the skeptic’s revision tasks and re-ranked actual candidates. ${changes.slice(0,8).join('; ')}. Route this revised state to the risk guardian; hard limits remain unchanged.`,'completed',2,challenged.flatMap(w=>w.opportunity.evidence.map(e=>e.id)));
  }

  // Stage 4: independently veto from measured, unrounded risk after revisions.
  // Neither a higher score nor an analyst’s persuasive narrative can bypass it.
  for(const w of working){
    const s=w.opportunity;
    for(const m of s.metrics)if(!m.passed&&w.quant){s.status='excluded';s.reasons.unshift(`${m.name} ${m.value}% exceeds your ${m.limit}% limit.`);}
    if(feasibility.status==='conflict'&&s.status!=='excluded'){s.status='watch';s.reasons.push('The committee abstains because the return aspiration conflicts with the stated risk/horizon policy.');}
    if(s.status==='qualified')s.reasons.unshift(`Passes both measured risk gates: ${s.annualVolatility}% volatility and ${s.maxDrawdown}% maximum drawdown.`);
    if(w.quant){
      const label=isLive?'Supplied historical':'Synthetic historical';
      s.reasons.push(w.quant.annualReturn<p.targetReturn
        ? `${label} annualized return of ${s.annualReturn}% is below your ${p.targetReturn}% aspiration. This comparison is not a forecast.`
        : `${label} annualized return of ${s.annualReturn}% exceeds the aspiration in this dataset; it does not establish future expected return.`);
    }
  }
  const opportunities=working.map(w=>w.opportunity);
  opportunities.sort((a,b)=>{const order={qualified:0,watch:1,excluded:2};return order[a.status]-order[b.status] || b.score-a.score || a.symbol.localeCompare(b.symbol);});
  const excluded = opportunities.filter(s=>s.status==='excluded');
  const qualified = opportunities.filter(s=>s.status==='qualified');
  const finalTop=qualified.slice(0,3).map(s=>`${s.symbol} (${s.score})`).join(', ')||'none';
  emit('Risk guardian','Veto candidates that breach the mandate',`${excluded.length} securities excluded; ${qualified.length} pass the research screen. Initial leaders: ${initialTop}. Final qualified leaders: ${finalTop}. ${excluded.slice(0,6).map(s=>`${s.symbol}: ${s.reasons[0]}`).join(' ')}`,excluded.length?'warning':'completed',challenged.length?2:1,excluded.flatMap(s=>s.evidence.map(e=>e.id)));
  const abstained = qualified.length===0 || feasibility.status==='conflict';
  if (abstained) {
    emit('Planner','Branch to abstention','No defensible qualified shortlist remains. Return rejected and watch-only cases for transparency; do not relax the mandate or manufacture a winning stock.','warning',2);
    warnings.push('The committee has abstained. Watch and excluded cases are explanatory research records, not qualified opportunities.');
  } else {
    emit('Skeptic','Review the revised shortlist',`${qualified.length} candidates remain after critique. Retain a concrete bear case and invalidation trigger for every candidate; no single-stock position sizes or promised returns are generated.`,'completed',2,qualified.flatMap(s=>s.evidence.map(e=>e.id)));
  }
  const evidence = [...new Map(opportunities.flatMap(s=>s.evidence).map(e=>[e.id,e])).values()];
  const availableIds = new Set(evidence.map(e=>e.id));
  // Only source IDs actually in the exported dossier may appear in its trace.
  for (const event of events) event.evidenceIds = event.evidenceIds.filter(e=>availableIds.has(e));
  emit('Evaluator','Validate the final decision record',`Verified ${opportunities.length} decisions, ${evidence.length} provenance records and every hard risk gate. ${abstained?'Abstention is the final outcome.':'The shortlist qualifies for further research only.'} ${isLive?'Supplied source provenance is retained.':'All sample data and deterministic roles are explicitly labeled.'}`,abstained?'warning':'completed',2,evidence.map(e=>e.id));
  const title = abstained?'No forced picks. Your limits come first.':`${qualified.length} opportunities. Every thesis challenged.`;
  const summary = abstained
    ? `The committee found no qualified research opportunities for this mandate. ${feasibility.status==='conflict'?feasibility.message:'Your risk limits, horizon, sector exclusions or source requirements rule out the available candidates.'}`
    : `${qualified.map(s=>s.symbol).slice(0,3).join(', ')} lead a ${qualified.length}-security research shortlist after quantitative screening and a skeptic’s review. A ${p.maxDrawdown}% loss on your ${p.baseCurrency} ${money(p.capital)} budget equals ${p.baseCurrency} ${money(p.capital*p.maxDrawdown/100)}; this is a tolerance illustration, not a maximum possible loss.`;
  return {id,createdAt:at,profile:p,mode:isLive&&!scope.length?'degraded':p.mode,title,summary,opportunities,events,scenarios:stressScenarios(opportunities,p),evidence,universeCount:scope.length,eligibleCount:qualified.length,abstained,feasibility,providers:[
    {name:'Zetaris',status:isLive&&scope.length?'configured':'sample',detail:isLive&&scope.length?'Source universe supplied by the caller; this engine does not itself attest a live Zetaris connection.':'Offline synthetic fixtures; no live data provider was queried.'},
    {name:'Meterless Nightshift',status:isLive?'unavailable':'sample',detail:'This deterministic research engine made no model requests. The API orchestrator records actual Nightshift calls separately.'},
    {name:'Meterless H-MEM',status:options.memoryLessons?.length?'configured':'sample',detail:options.memoryLessons?.length?'Caller supplied recalled lessons; current risk gates were recomputed.':'Previous committee decisions may provide context; no external memory service is asserted.'},
  ],memory:{reused:lessons.length>0,lessons},durationMs:Math.max(0,Date.now()-started),cost:{modelCalls:0,estimatedUsd:0,actualUsd:0},methodology:[
    isLive?'Source provenance accompanies the supplied financial inputs. Retrieved source content is untrusted evidence; the deterministic validator cannot establish that a provider’s claims are factually correct.':'All sample prices, financial metrics, catalysts and scenarios are synthetic assumptions. Investor-relations links are discovery references and do not substantiate fixture numbers. Sample mode replays the fixed fixture clock, independently of the current date.',
    'Risk uses daily adjusted closing prices: CAGR = (last / first)^(252 / return observations) − 1; annualized volatility = sample standard deviation of simple daily returns × √252; maximum drawdown = maximum peak-to-trough decline.',
    'At least 61 daily closes and dated evidence are required. Live snapshots and price-source dates must be no older than 45 days; live price and filing provenance cannot be dated more than one day in the future. Older annual filings are allowed as dated sources. Sample mode uses the fixed fixture clock. The sample contains 505 closes per security. 252 sessions is a calculation convention, not each exchange’s exact trading calendar.',
    'Hard volatility and drawdown gates use unrounded computed values. Sector exclusions, data quality and live/sample provenance cannot be overridden by commentary. Latest close must match the last adjusted price within 0.1%; contradictory source-ID collisions exclude every affected security and preserve quarantined evidence.',
    'Ranking weights: quality 30%, risk headroom 25%, growth and margins 20%, valuation heuristic 15%, historical aspiration comparison 10%, followed by explicit skeptic penalties. Scores are relative research priorities, not probabilities.',
    'A horizon of 12 months or less makes otherwise eligible equities watch-only. Conflicting return/risk preferences trigger abstention under an explicit product policy, not a modeled efficient frontier.',
    'Returns are local-currency price returns; dividends, withholding, fees, FX, taxes, market access, liquidity and portfolio correlations are not modeled. No portfolio optimization or order execution is provided.',
    'Stress scenarios apply stated hypothetical shocks. Historical maximum drawdown is an observation, never a stop-loss guarantee or a bound on future losses.',
  ],warnings:dedupe(warnings)};
}

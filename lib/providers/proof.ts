import type { ModelReceipt } from './nightshift';

interface SponsorProofInput {
  startedAt:string;
  finishedAt:string;
  syntheticInputs:boolean;
  dataProvider:string;
  stockCount:number;
  sourceRowsValidated:boolean;
  receipts:ModelReceipt[];
}
const identifier=(value:unknown):string|null=>typeof value==='string'&&/^[A-Za-z0-9._:/-]{1,240}$/.test(value)?value:null;
const counter=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const cost=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

/** Explicit allowlist: actual financial records and user mandates never enter public proof files. */
export function publicSponsorProof(input:SponsorProofInput){
  return {
    schema:'thesis.sponsor-proof.public-metadata.v1',
    startedAt:input.startedAt,
    finishedAt:input.finishedAt,
    dataMode:input.syntheticInputs?'synthetic':'actual_private',
    dataProvider:input.dataProvider==='Zetaris'?'Zetaris':'Bundled fixtures',
    counts:{stocks:counter(input.stockCount),modelRequests:input.receipts.length},
    checks:{sourceRowsValidated:input.sourceRowsValidated,structuredReviewReturned:input.receipts.length>0},
    receipts:input.receipts.map(receipt=>({
      provider:'Meterless Nightshift',
      requestedModel:identifier(receipt.requestedModel),
      responseModel:identifier(receipt.responseModel),
      resolvedModel:identifier(receipt.resolvedModel),
      requestId:identifier(receipt.requestId),
      receiptId:identifier(receipt.receiptId),
      inputTokens:counter(receipt.inputTokens),
      outputTokens:counter(receipt.outputTokens),
      latencyMs:counter(receipt.latencyMs),
      providerCostUsd:cost(receipt.providerCostUsd),
    })),
    limitations:[
      'Public metadata only. Financial source records, research narratives, risk metrics, user preferences, model prompts and runtime receipt bodies are intentionally omitted.',
      'The complete proof remains in the operator’s ignored work/private-proofs directory. This metadata grants no financial-data redistribution rights.',
      'Schema and citation checks do not independently verify financial facts or investment performance.',
    ],
  };
}

import type {AIUsageReceipt} from './types';
export class AIError extends Error {
 constructor(public readonly code:string,message:string,public readonly status=422,public receipt?:AIUsageReceipt){super(message);this.name='AIError'}
}

import { z } from 'zod';
import { markets } from '@/lib/contracts';
import { assertSameOrigin, errorResponse, json, readJson, requireUser, HttpError } from '@/lib/server/http';
import { listTheses, saveThesis } from '@/lib/server/store';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await requireUser();return json({items:await listTheses(user.userId)});}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
  assertSameOrigin(request);const user=await requireUser();
  const parsed=z.object({symbol:z.string().min(1).max(40),market:z.enum(markets),runId:z.string().uuid(),note:z.string().max(2000).default('')}).safeParse(await readJson(request));
  if(!parsed.success)throw new HttpError(400,'Provide a valid stock, market, research run, and note under 2,000 characters.','INVALID_INPUT');
  return json(await saveThesis(user.userId,parsed.data),201);
}catch(e){return errorResponse(e);}}

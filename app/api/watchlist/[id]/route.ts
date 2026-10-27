import { z } from 'zod';
import { assertSameOrigin,errorResponse,json,readJson,requireUser,HttpError,validId } from '@/lib/server/http';
import { deleteThesis,updateThesis } from '@/lib/server/store';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,context:Context){try{
  assertSameOrigin(request);const user=await requireUser();const {id}=await context.params;validId(id);
  const parsed=z.object({note:z.string().max(2000)}).safeParse(await readJson(request));
  if(!parsed.success)throw new HttpError(400,'Notes must be under 2,000 characters.','INVALID_INPUT');
  return json(await updateThesis(user.userId,id,parsed.data.note));
}catch(e){return errorResponse(e);}}
export async function DELETE(request:Request,context:Context){try{assertSameOrigin(request);const user=await requireUser();const {id}=await context.params;validId(id);await deleteThesis(user.userId,id);return json({ok:true});}catch(e){return errorResponse(e);}}

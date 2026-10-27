import { assertSameOrigin,errorResponse,json,requireUser,HttpError,validId } from '@/lib/server/http';
import { getRun,deleteRun } from '@/lib/server/store';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{const user=await requireUser();const {id}=await context.params;validId(id);const run=await getRun(user.userId,id);if(!run)throw new HttpError(404,'Research run not found.','NOT_FOUND');return json(run);}catch(e){return errorResponse(e);}}
export async function DELETE(request:Request,context:Context){try{assertSameOrigin(request);const user=await requireUser();const {id}=await context.params;validId(id);await deleteRun(user.userId,id);return json({ok:true});}catch(e){return errorResponse(e);}}

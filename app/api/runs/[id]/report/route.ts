import { errorResponse,requireUser,HttpError,validId } from '@/lib/server/http';
import { getRun } from '@/lib/server/store';
import { researchReport } from '@/lib/server/report';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){try{const user=await requireUser();const{id}=await context.params;validId(id);const run=await getRun(user.userId,id);if(!run)throw new HttpError(404,'Research run not found.','NOT_FOUND');return new Response(researchReport(run),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return errorResponse(e);}}

import { errorResponse,json,requireUser } from '@/lib/server/http';
import { listRuns } from '@/lib/server/store';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await requireUser();return json({runs:await listRuns(user.userId)});}catch(e){return errorResponse(e);}}

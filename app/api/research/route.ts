import { profileSchema } from '@/lib/contracts';
import { assertSameOrigin,errorResponse,json,readJson,requireUser,HttpError } from '@/lib/server/http';
import { checkRateLimit,completeRun,createRun,failRun,getIdempotentRun } from '@/lib/server/store';
import { executeResearch } from '@/lib/server/service';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  let pending:{userId:string;id:string}|undefined;
  try{
    assertSameOrigin(request);const user=await requireUser();
    const parsed=profileSchema.strict().safeParse(await readJson(request));
    if(!parsed.success)throw new HttpError(400,`Check your research preferences: ${parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')}`,'INVALID_PROFILE');
    const profile=parsed.data;
    const suppliedKey=request.headers.get('x-idempotency-key');
    if(suppliedKey&&!/^[a-zA-Z0-9_-]{8,100}$/.test(suppliedKey))throw new HttpError(400,'Invalid idempotency key.','INVALID_IDEMPOTENCY_KEY');
    const key=suppliedKey??crypto.randomUUID();
    const previous=await getIdempotentRun(user.userId,key);
    if(previous){
      if(previous.profile!==JSON.stringify(profile))throw new HttpError(409,'This request key was already used with different preferences.','IDEMPOTENCY_CONFLICT');
      if(previous.status==='completed'&&previous.result)return json(JSON.parse(previous.result));
      if(previous.status==='running')throw new HttpError(409,'This research is already in progress. Wait for its response or check run history.','RUN_IN_PROGRESS');
      throw new HttpError(409,'This request previously failed. Retry research with a new request key.','RUN_FAILED');
    }
    await checkRateLimit(`research:${user.userId}`);
    const id=crypto.randomUUID();
    if(!await createRun(user.userId,id,profile,key))throw new HttpError(409,'This research request is already in progress.','RUN_IN_PROGRESS');
    pending={userId:user.userId,id};
    const {run,memorySnapshot}=await executeResearch(user.userId,profile,id);
    await completeRun(user.userId,run,memorySnapshot);pending=undefined;
    return json(run,201);
  }catch(e){if(pending)try{await failRun(pending.userId,pending.id);}catch{}return errorResponse(e);}
}

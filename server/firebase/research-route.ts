import {profileSchema} from '../../lib/contracts';
import {assertSameOrigin,errorResponse,json,readJson,requireUser,HttpError} from '../../lib/server/http';
import {checkRateLimit,completeRun,createRun,failRun,getIdempotentRun} from '../../lib/server/store';
import {executeResearch} from '../../lib/server/service';
import {enqueueResearch} from './jobs';
export async function POST(request:Request){let pending:{userId:string;id:string}|undefined;
 try{assertSameOrigin(request);const user=await requireUser(),parsed=profileSchema.strict().safeParse(await readJson(request));if(!parsed.success)throw new HttpError(400,'Check your research preferences.','INVALID_PROFILE');
 const profile=parsed.data,supplied=request.headers.get('x-idempotency-key');if(supplied&&!/^[a-zA-Z0-9_-]{8,100}$/.test(supplied))throw new HttpError(400,'Invalid idempotency key.','INVALID_IDEMPOTENCY_KEY');const key=supplied??crypto.randomUUID(),previous=await getIdempotentRun(user.userId,key);
 if(previous){if(previous.profile!==JSON.stringify(profile))throw new HttpError(409,'This request key was already used with different preferences.','IDEMPOTENCY_CONFLICT');if(previous.status==='completed'&&previous.result)return json(JSON.parse(previous.result));if(previous.status==='running')return json({id:previous.id,status:'queued',pollUrl:'/api/runs/'+previous.id},202);throw new HttpError(409,'This request previously failed. Retry with a new request key.','RUN_FAILED');}
 await checkRateLimit('research:'+user.userId);if(profile.mode==='live')await checkRateLimit('provider:global',8,600_000);
 const id=crypto.randomUUID();if(!await createRun(user.userId,id,profile,key))throw new HttpError(409,'Your previous research is still in progress. Check its status first.','RUN_IN_PROGRESS');pending={userId:user.userId,id};
 if(profile.mode==='live'){await enqueueResearch(user.userId,id);pending=undefined;return json({id,status:'queued',pollUrl:'/api/runs/'+id},202);}
 const{run,memorySnapshot}=await executeResearch(user.userId,profile,id);await completeRun(user.userId,run,memorySnapshot);pending=undefined;return json(run,201);
 }catch(error){if(pending)try{await failRun(pending.userId,pending.id);}catch{}return errorResponse(error);}
}

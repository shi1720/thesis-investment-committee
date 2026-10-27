import { getChatGPTUser } from '@/app/chatgpt-auth';
import { json,errorResponse } from '@/lib/server/http';
import { listRuns,listTheses } from '@/lib/server/store';
import { providerEnv } from '@/lib/server/service';
import { getProviderStatuses } from '@/lib/providers';
import { sampleUniverse } from '@/lib/research/sample-data';
export const dynamic='force-dynamic';
export async function GET(){try{
  const user=await getChatGPTUser();
  const [recentRuns,watchlist]=user?await Promise.all([listRuns(user.userId),listTheses(user.userId)]):[[],[]];
  return json({user:{name:user?.fullName??user?.displayName??'Guest researcher',email:user?.email??null,signedIn:!!user},providers:getProviderStatuses(providerEnv()),universe:sampleUniverse,recentRuns,watchlist});
}catch(e){return errorResponse(e);}}

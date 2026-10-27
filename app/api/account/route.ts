import { assertSameOrigin,errorResponse,json,requireUser } from '@/lib/server/http';
import { eraseAccount,listTheses,getMemory,exportRunRecords,exportArchiveRecords } from '@/lib/server/store';
export const dynamic='force-dynamic';
export async function GET(){try{
  const user=await requireUser();
  const [watchlist,current]=await Promise.all([listTheses(user.userId),getMemory(user.userId)]);
  async function* records(){
    yield JSON.stringify({exportedAt:new Date().toISOString(),watchlist,memoryCurrent:current}).slice(0,-1)+',"runs":[';
    let comma='';for await(const row of exportRunRecords(user!.userId)){yield comma+row;comma=',';}
    yield '],"memoryArchives":[';comma='';
    for await(const row of exportArchiveRecords(user!.userId)){yield comma+row;comma=',';}
    yield ']}';
  }
  const iterator=records();const encoder=new TextEncoder();
  const stream=new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(next.value));}catch(e){controller.error(e);}},async cancel(){await iterator.return(undefined);}});
  return new Response(stream,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="thesis-account-export.json"','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return errorResponse(e);}}
export async function DELETE(request:Request){try{assertSameOrigin(request);const user=await requireUser();await eraseAccount(user.userId);return json({ok:true});}catch(e){return errorResponse(e);}}

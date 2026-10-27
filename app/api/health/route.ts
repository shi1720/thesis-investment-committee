export const dynamic='force-dynamic';
export async function GET(){return Response.json({status:'ok',service:'thesis',version:'1.0.0',time:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});}

import { env } from 'cloudflare:workers';
import type { Market, ResearchRun, SavedThesis } from '@/lib/contracts';
import { HttpError } from './http';

function db() {
  if (!env.DB) throw new HttpError(503, 'Research storage is temporarily unavailable. Please retry shortly.', 'STORAGE_UNAVAILABLE');
  return env.DB;
}
export async function listRuns(userId: string): Promise<ResearchRun[]> {
  const { results } = await db().prepare('SELECT result FROM research_runs WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 30').bind(userId,'completed').all<{result:string}>();
  return results.map(r => JSON.parse(r.result) as ResearchRun);
}
export async function getRun(userId: string, id: string): Promise<ResearchRun | null> {
  const row = await db().prepare('SELECT result FROM research_runs WHERE id = ? AND user_id = ? AND status = ?').bind(id,userId,'completed').first<{result:string}>();
  return row ? JSON.parse(row.result) : null;
}
export async function getIdempotentRun(userId: string, key: string) {
  return db().prepare('SELECT id, status, result, profile FROM research_runs WHERE user_id = ? AND idempotency_key = ?').bind(userId,key).first<{id:string;status:string;result:string|null;profile:string}>();
}
export async function createRun(userId: string, id: string, profile: unknown, key: string) {
  const result= await db().prepare('INSERT OR IGNORE INTO research_runs (id,user_id,created_at,status,profile,idempotency_key) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM research_runs WHERE user_id = ? AND status = ? AND created_at > ?)').bind(id,userId,new Date().toISOString(),'running',JSON.stringify(profile),key,userId,'running',new Date(Date.now()-300_000).toISOString()).run();
  return result.meta.changes === 1;
}
export async function completeRun(userId: string, run: ResearchRun, memorySnapshot?:unknown) {
  const statements=[db().prepare('UPDATE research_runs SET status = ?, result = ?, error = NULL WHERE id = ? AND user_id = ?').bind('completed',JSON.stringify(run),run.id,userId)];
  if(memorySnapshot)statements.push(...memoryStatements(userId,run.id,memorySnapshot));
  await db().batch(statements);
}
export async function failRun(userId: string, id: string) {
  await db().prepare('UPDATE research_runs SET status = ?, error = ? WHERE id = ? AND user_id = ?').bind('failed','Provider or analysis failure. Retry with a new request.',id,userId).run();
}
export async function deleteRun(userId: string,id:string) {
  await db().batch([
    db().prepare('DELETE FROM saved_theses WHERE user_id = ? AND run_id = ?').bind(userId,id),
    db().prepare('DELETE FROM committee_memories WHERE user_id = ?').bind(userId),
    db().prepare('DELETE FROM memory_audit_archives WHERE user_id = ?').bind(userId),
    db().prepare('DELETE FROM research_runs WHERE user_id = ? AND id = ?').bind(userId,id),
  ]);
}
export async function checkRateLimit(key: string, maximum = 8, windowMs = 600_000) {
  const window = Math.floor(Date.now() / windowMs);
  const row = await db().prepare('INSERT INTO rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, window_start = excluded.window_start RETURNING count').bind(key,window).first<{count:number}>();
  if (!row || row.count > maximum) throw new HttpError(429, 'Research limit reached. Try again in 10 minutes.', 'RATE_LIMITED');
}
export async function listTheses(userId:string):Promise<SavedThesis[]> {
  const {results}=await db().prepare('SELECT id,symbol,name,market,run_id AS runId,created_at AS createdAt,invalidation,note FROM saved_theses WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(userId).all<SavedThesis>();
  return results;
}
export async function saveThesis(userId:string, input:{symbol:string;market:Market;runId:string;note:string}):Promise<SavedThesis> {
  const run=await getRun(userId,input.runId);
  const stock=run?.opportunities.find(s=>s.symbol===input.symbol && s.market===input.market);
  if (!stock) throw new HttpError(404,'Research this stock before saving its thesis.','THESIS_NOT_FOUND');
  const existing=await db().prepare('SELECT id FROM saved_theses WHERE user_id = ? AND symbol = ? AND market = ?').bind(userId,stock.symbol,stock.market).first<{id:string}>();
  if (!existing) {
    const count=await db().prepare('SELECT count(*) AS total FROM saved_theses WHERE user_id = ?').bind(userId).first<{total:number}>();
    if ((count?.total??0)>=100) throw new HttpError(409,'Your saved thesis limit is 100. Remove one to save another.','SAVE_LIMIT');
  }
  const item:SavedThesis={id:existing?.id??crypto.randomUUID(),symbol:stock.symbol,name:stock.name,market:stock.market,runId:run!.id,createdAt:new Date().toISOString(),invalidation:stock.invalidation,note:input.note};
  await db().prepare('INSERT INTO saved_theses (id,user_id,symbol,name,market,run_id,created_at,invalidation,note) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,symbol,market) DO UPDATE SET run_id=excluded.run_id,created_at=excluded.created_at,invalidation=excluded.invalidation,note=excluded.note').bind(item.id,userId,item.symbol,item.name,item.market,item.runId,item.createdAt,item.invalidation,item.note).run();
  return item;
}
export async function updateThesis(userId:string,id:string,note:string) {
  const row=await db().prepare('UPDATE saved_theses SET note = ? WHERE id = ? AND user_id = ? RETURNING id,symbol,name,market,run_id AS runId,created_at AS createdAt,invalidation,note').bind(note,id,userId).first<SavedThesis>();
  if (!row) throw new HttpError(404,'Saved thesis not found.','NOT_FOUND');
  return row;
}
export async function deleteThesis(userId:string,id:string) {
  await db().prepare('DELETE FROM saved_theses WHERE id = ? AND user_id = ?').bind(id,userId).run();
}
export async function eraseAccount(userId:string) {
  await db().batch([
    db().prepare('DELETE FROM saved_theses WHERE user_id = ?').bind(userId),
    db().prepare('DELETE FROM research_runs WHERE user_id = ?').bind(userId),
    db().prepare('DELETE FROM committee_memories WHERE user_id = ?').bind(userId),
    db().prepare('DELETE FROM rate_limits WHERE key = ?').bind(`research:${userId}`),
    db().prepare('DELETE FROM memory_audit_archives WHERE user_id = ?').bind(userId),
  ]);
}
export async function getMemory(userId:string) {
  const row=await db().prepare('SELECT payload FROM committee_memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').bind(userId).first<{payload:string}>();
  return row?JSON.parse(row.payload):undefined;
}
function memoryStatements(userId:string,runId:string,payload:unknown) {
  const record=payload as {pendingArchive?:unknown};
  const {pendingArchive,...clean}=record;
  const archive=pendingArchive?[db().prepare('INSERT INTO memory_audit_archives (id,user_id,run_id,created_at,payload) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),userId,runId,new Date().toISOString(),JSON.stringify(pendingArchive))]:[];
  return [
    ...archive,
    db().prepare('DELETE FROM committee_memories WHERE user_id = ?').bind(userId),
    db().prepare('INSERT INTO committee_memories (id,user_id,run_id,created_at,payload) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),userId,runId,new Date().toISOString(),JSON.stringify(clean)),
  ];
}
export async function exportMemory(userId:string) {
  const current=await getMemory(userId);
  const archives=await db().prepare('SELECT created_at AS createdAt,payload FROM memory_audit_archives WHERE user_id = ? ORDER BY created_at ASC').bind(userId).all<{createdAt:string;payload:string}>();
  return {current,archives:archives.results.map(a=>({createdAt:a.createdAt,payload:JSON.parse(a.payload)}))};
}
export async function* exportRunRecords(userId:string):AsyncGenerator<string> {
  let after:{createdAt:string;id:string}|undefined;
  while(true){
    const sql='SELECT id,created_at AS createdAt,result FROM research_runs WHERE user_id = ? AND status = ?'+(after?' AND (created_at < ? OR (created_at = ? AND id < ?))':'')+' ORDER BY created_at DESC,id DESC LIMIT 10';
    const args: (string|number)[]=[userId,'completed'];if(after)args.push(after.createdAt,after.createdAt,after.id);
    const {results}=await db().prepare(sql).bind(...args).all<{id:string;createdAt:string;result:string}>();
    if(!results.length)break;
    for(const row of results)yield row.result;
    const last=results[results.length-1];after={createdAt:last.createdAt,id:last.id};
  }
}
export async function* exportArchiveRecords(userId:string):AsyncGenerator<string> {
  let after:{createdAt:string;id:string}|undefined;
  while(true){
    const sql='SELECT id,created_at AS createdAt,payload FROM memory_audit_archives WHERE user_id = ?'+(after?' AND (created_at > ? OR (created_at = ? AND id > ?))':'')+' ORDER BY created_at ASC,id ASC LIMIT 10';
    const args:string[]=[userId];if(after)args.push(after.createdAt,after.createdAt,after.id);
    const{results}=await db().prepare(sql).bind(...args).all<{id:string;createdAt:string;payload:string}>();
    if(!results.length)break;
    for(const row of results)yield JSON.stringify({createdAt:row.createdAt,payload:JSON.parse(row.payload)});
    const last=results[results.length-1];after={createdAt:last.createdAt,id:last.id};
  }
}

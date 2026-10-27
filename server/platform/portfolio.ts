import {z} from 'zod';
import {firebaseAdmin} from '../firebase/admin';
import {getUserRoot,assertAccount} from './persistence';
import {tradeSchema,instrumentSchema,instrumentKey,type PortfolioTrade,type InstrumentRef,type MarketQuote} from '../../lib/finance/contracts';
import {calculatePortfolio} from '../../lib/finance/math';
import {getPreferences} from './settings';
import {HttpError} from '../../lib/server/http';
const inputSchema=tradeSchema.omit({id:true}).strict().refine(t=>t.quantity*t.price+t.fees<=1e12,'The trade notional exceeds the supported limit.');
export async function listTrades(userId:string):Promise<PortfolioTrade[]>{const rows=await getUserRoot(userId).collection('portfolio_trades').orderBy('executedAt','asc').limit(2001).get();if(rows.size>2000)throw new HttpError(409,'This workspace exceeds the supported transaction count. Export and archive older records.','TRADE_LIMIT');return rows.docs.map(d=>d.data() as PortfolioTrade);}
export async function mutateTrade(userId:string,input:unknown,id?:string,remove=false){
 const parsed=remove?null:inputSchema.safeParse(input);if(parsed&&!parsed.success)throw new HttpError(400,'Check the symbol, trade date, currency, quantity, price and fees.','INVALID_TRADE');
 return firebaseAdmin().db.runTransaction(async tx=>{const root=getUserRoot(userId),account=await assertAccount(tx,userId),collection=root.collection('portfolio_trades'),snapshot=await tx.get(collection.limit(2001));if(snapshot.size>2000)throw new HttpError(409,'The transaction limit is2000.','TRADE_LIMIT');
 const trades=snapshot.docs.map(d=>d.data() as PortfolioTrade),existing=id?trades.find(t=>t.id===id):undefined;if(id&&!existing)throw new HttpError(404,'Transaction not found.','NOT_FOUND');
 const nextId=id??crypto.randomUUID(),next=remove?null:{...(parsed&&parsed.success?parsed.data:{}),id:nextId} as PortfolioTrade;const revised=trades.filter(t=>t.id!==nextId);if(next)revised.push(next);if(revised.length>2000)throw new HttpError(409,'The transaction limit is2000.','TRADE_LIMIT');
 try{calculatePortfolio(revised,[],{costBasis:'fifo'});}catch{throw new HttpError(400,'This change would make the recorded transaction ledger invalid. Check currency, dates and available shares before selling.','INVALID_LEDGER');}
 if(remove)tx.delete(collection.doc(nextId));else tx.set(collection.doc(nextId),JSON.parse(JSON.stringify(next)));
 tx.set(root,{portfolioRevision:(account.get('portfolioRevision')??0)+1},{merge:true});return {ok:true,trade:next};
 });
}
export async function portfolioSummary(userId:string,quotes:MarketQuote[]=[]){const[trades,prefs]=await Promise.all([listTrades(userId),getPreferences(userId)]);return {portfolio:calculatePortfolio(trades,quotes,{costBasis:prefs.costBasis}),trades,updatedAt:new Date().toISOString()};}
export interface WatchItem {id:string;instrument:InstrumentRef;note:string;createdAt:string}
export async function listWatchlist(userId:string):Promise<WatchItem[]>{const rows=await getUserRoot(userId).collection('platform_watchlist').orderBy('createdAt','desc').limit(200).get();return rows.docs.map(d=>d.data() as WatchItem);}
export async function saveWatchItem(userId:string,input:unknown){const parsed=z.object({instrument:instrumentSchema,note:z.string().max(2000).default('')}).strict().safeParse(input);if(!parsed.success)throw new HttpError(400,'Select a valid instrument to follow.','INVALID_WATCHLIST');const id=Buffer.from(instrumentKey(parsed.data.instrument)).toString('base64url');return firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);const ref=getUserRoot(userId).collection('platform_watchlist').doc(id),existing=await tx.get(ref);if(!existing.exists){const current=await tx.get(getUserRoot(userId).collection('platform_watchlist').limit(201));if(current.size>=200)throw new HttpError(409,'The watchlist limit is200.','WATCHLIST_LIMIT');}const item:WatchItem={id,...parsed.data,createdAt:existing.get('createdAt')??new Date().toISOString()};tx.set(ref,item);return item;});}
export async function deleteWatchItem(userId:string,id:string){await firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);tx.delete(getUserRoot(userId).collection('platform_watchlist').doc(id));});return {ok:true};}

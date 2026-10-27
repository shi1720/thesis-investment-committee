export interface QuotaState {day?:number;dayCount?:number;events?:{at:number;credits:number}[]}
/** Rolling minute plus UTC-day credit reservation; no automatic request retry. */
export function reserveCredits(state:QuotaState,now:number,credits:number,limits:{minute:number;day:number}){
 if(!Number.isFinite(now)||!Number.isInteger(credits)||credits<1)throw new Error('Invalid quota reservation.');
 const day=Math.floor(now/86400000),events=(state.events??[]).filter(e=>Number.isFinite(e.at)&&e.at>now-60000&&e.at<=now&&Number.isInteger(e.credits)&&e.credits>0).sort((a,b)=>a.at-b.at),dayCount=state.day===day?(state.dayCount??0):0;
 if(credits>limits.minute)return {allowed:false,retryAfterSeconds:60};
 if(dayCount+credits>limits.day)return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil(((day+1)*86400000-now)/1000))};
 let used=events.reduce((sum,e)=>sum+e.credits,0);
 if(used+credits>limits.minute){for(const event of events){used-=event.credits;if(used+credits<=limits.minute)return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((event.at+60000-now)/1000))};}return {allowed:false,retryAfterSeconds:60};}
 return {allowed:true,state:{day,dayCount:dayCount+credits,events:[...events,{at:now,credits}]} satisfies QuotaState};
}

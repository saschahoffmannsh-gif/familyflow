import { getDb } from '@/db'
import type { ChatData, ChatEntry, ChatMessage, EntryRef } from './discussions'
import type { PlannerEvent, PlannerPerson } from './planner'
export class ChatError extends Error { constructor(message:string,readonly status=400){super(message)} }
export type ThreadRow={id:string;source_kind:'event'|'todo';source_id:string}
type Source={entry:ChatEntry;groupId:string}
type ChatAccess={thread:ThreadRow;source:Source;member:boolean}
type EventRow={title:string;date:string;end_date:string|null;time:string|null;note:string|null;kind?:'event'|'task';event_type?:string;group_id?:string;waste_kind?:string}
export const chatReply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}})
export function chatFail(e:unknown){if(e instanceof ChatError)return chatReply({error:e.message},e.status);console.error('Done chat error',e);return chatReply({error:'Der Chat ist gerade nicht erreichbar. Bitte erneut versuchen.'},500)}
export function allowChatWrite(r:Request){const o=r.headers.get('origin');return r.headers.get('sec-fetch-site')!=='cross-site'&&(!o||o===new URL(r.url).origin)}
export const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):''
export async function chatIdentity(r:Request,optional=false){
 const token=r.headers.get('authorization')?.replace(/^Bearer /,'');if(!token&&optional)return null
 if(!token||!/^[a-f0-9]{64}$/.test(token))throw new ChatError('Bitte öffne dein Done-Profil.',401)
 const p=await getDb().prepare('SELECT id, name, color FROM planner_profiles WHERE access_key = ?').bind(token).first<PlannerPerson>()
 if(!p)throw new ChatError('Bitte melde dein Profil erneut an.',401);return p
}
export async function inGroup(group:string,person:string){return !!await getDb().prepare('SELECT group_id FROM planner_members WHERE group_id = ? AND profile_id = ?').bind(group,person).first()}
export async function sourceFor(kind:string,id:string):Promise<Source>{
 const db=getDb()
 if(kind==='todo'){
  const t=await db.prepare('SELECT title, kind, date, note FROM todo_items WHERE id = ?').bind(id).first<{title:string;kind:'event'|'task';date:string|null;note:string|null}>()
  if(t)return {groupId:'family',entry:{title:t.title,kind:t.kind,...(t.date?{date:t.date}:{}),...(t.note?{note:t.note}:{})}}
  return sourceFor('event',`todo-${id}`)
 }
 if(kind!=='event')throw new ChatError('Ungültiger Eintrag.')
 const row=await db.prepare('SELECT * FROM planner_events WHERE id = ?').bind(id).first<EventRow>()||await db.prepare('SELECT * FROM calendar_items WHERE id = ?').bind(id).first<EventRow>()
 if(!row)throw new ChatError('Dieser Eintrag wurde entfernt oder ist nicht mehr verfügbar.',404)
 if(row.waste_kind)throw new ChatError('Für Müllabholungen ist kein externer Chat vorgesehen.')
 return {groupId:row.group_id||'family',entry:{title:row.title,kind:row.kind==='task'||row.event_type==='task'?'task':'event',date:row.date,...(row.end_date?{endDate:row.end_date}:{}),...(row.time?{time:row.time}:{}),...(row.note?{note:row.note}:{})}}
}
export async function threadFromShare(token:string){
 if(!/^[a-f0-9]{64}$/.test(token))throw new ChatError('Dieser Terminlink ist ungültig.',404)
 const t=await getDb().prepare('SELECT t.id, t.source_kind, t.source_id FROM entry_threads t JOIN entry_shares s ON s.thread_id = t.id WHERE s.token = ? AND s.active = 1').bind(token).first<ThreadRow>()
 if(!t)throw new ChatError('Dieser Link wurde zurückgenommen oder ist nicht mehr gültig.',404)
 await sourceFor(t.source_kind,t.source_id);return t
}
export async function accessThread(id:string,p:PlannerPerson|null,token?:string){
 const t=await getDb().prepare('SELECT id, source_kind, source_id FROM entry_threads WHERE id = ?').bind(id).first<ThreadRow>()
 if(!t)throw new ChatError('Dieser Chat wurde nicht gefunden.',404)
 const source=await sourceFor(t.source_kind,t.source_id),member=!!p&&await inGroup(source.groupId,p.id)
 if(!member){
  const shared=token?await threadFromShare(token):null
  const guest=p?await getDb().prepare('SELECT g.profile_id FROM entry_guests g JOIN entry_shares s ON s.token = g.token WHERE g.profile_id = ? AND s.thread_id = ? AND s.active = 1').bind(p.id,id).first():null
  if(shared?.id!==id&&!guest)throw new ChatError('Du hast keinen Zugriff auf diesen Chat.',403)
 }
 return {thread:t,source,member}
}
export async function openThread(ref:EntryRef,p:PlannerPerson){
 const source=await sourceFor(ref.kind,ref.id);if(!await inGroup(source.groupId,p.id))throw new ChatError('Dieser Eintrag gehört nicht zu deinen Gruppen.',403)
 const db=getDb();let t=await db.prepare('SELECT id, source_kind, source_id FROM entry_threads WHERE source_kind = ? AND source_id = ?').bind(ref.kind,ref.id).first<ThreadRow>()
 if(!t&&ref.kind==='event'&&ref.id.startsWith('todo-'))t=await db.prepare("SELECT id, source_kind, source_id FROM entry_threads WHERE source_kind = 'todo' AND source_id = ?").bind(ref.id.slice(5)).first<ThreadRow>()
 if(!t){await db.prepare('INSERT OR IGNORE INTO entry_threads (id, source_kind, source_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(),ref.kind,ref.id,p.id,new Date().toISOString()).run();t=await db.prepare('SELECT id, source_kind, source_id FROM entry_threads WHERE source_kind = ? AND source_id = ?').bind(ref.kind,ref.id).first<ThreadRow>()}
 return {...t!,verified:{thread:t!,source,member:true}}
}
export async function chatBundle(id:string,p:PlannerPerson|null,token?:string,before?:string,verified?:ChatAccess):Promise<ChatData>{
 const {source,member}=verified?.thread.id===id?verified:await accessThread(id,p,token),db=getDb(),[beforeTime,beforeId]=before?.split('|')||[]
 // These reads share an already-verified access context and can run together.
 const [rows,share,reminders,guest]=await Promise.all([
  db.prepare(`SELECT m.id,m.author_id,p.name AS author,p.color,m.body,m.created_at,a.id AS attachment_id,a.name,a.mime,a.size,a.duration FROM entry_messages m JOIN planner_profiles p ON p.id=m.author_id LEFT JOIN entry_attachments a ON a.id=m.attachment_id WHERE m.thread_id=? ${beforeTime?'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))':''} ORDER BY m.created_at DESC,m.id DESC LIMIT 61`).bind(id,...(beforeTime?[beforeTime,beforeTime,beforeId||'']:[])).all<{id:string;author_id:string;author:string;color:string;body:string;created_at:string;attachment_id:string|null;name:string;mime:string;size:number;duration:number|null}>(),
  member?db.prepare('SELECT token FROM entry_shares WHERE thread_id=? AND active=1 ORDER BY created_at DESC LIMIT 1').bind(id).first<{token:string}>():Promise.resolve(null),
  p?db.prepare('SELECT id,remind_at,delivered FROM entry_reminders WHERE thread_id=? AND profile_id=? ORDER BY remind_at').bind(id,p.id).all<{id:string;remind_at:string;delivered:number}>():Promise.resolve(null),
  p?db.prepare(`SELECT g.group_id,g.calendar_date FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE g.profile_id=? AND s.thread_id=? AND s.active=1 ${token?'AND g.token=?':''} ORDER BY (g.group_id IS NULL),g.created_at LIMIT 1`).bind(p.id,id,...(token?[token]:[])).first<{group_id:string|null;calendar_date:string|null}>():Promise.resolve(null),
 ])
 const messages:ChatMessage[]=rows.results.slice(0,60).reverse().map(m=>({id:m.id,authorId:m.author_id,author:m.author,color:m.color,body:m.body,createdAt:m.created_at,...(m.attachment_id?{attachment:{id:m.attachment_id,name:m.name,mime:m.mime,size:m.size,...(m.duration?{duration:m.duration}:{})}}:{})}))
 return {id,entry:source.entry,messages,hasMore:rows.results.length>60,canWrite:!!p,canShare:member,reminders:reminders?.results.map(r=>({id:r.id,remindAt:r.remind_at,delivered:!!r.delivered}))||[],...(share?{shareToken:share.token}:{}),joined:member||!!guest,imported:!!guest?.group_id,...(guest?.group_id?{importedGroupId:guest.group_id}:{}),...(guest?.calendar_date?{importDate:guest.calendar_date}:{})}
}
export async function importedEntries(profileId:string):Promise<PlannerEvent[]>{
 const rows=await getDb().prepare('SELECT t.id,t.source_kind,t.source_id,g.group_id,g.calendar_date FROM entry_guests g JOIN entry_shares s ON s.token=g.token AND s.active=1 JOIN entry_threads t ON t.id=s.thread_id JOIN planner_members m ON m.group_id=g.group_id AND m.profile_id=g.profile_id WHERE g.profile_id=? AND g.group_id IS NOT NULL ORDER BY g.created_at').bind(profileId).all<ThreadRow&{group_id:string;calendar_date:string|null}>()
 const events:PlannerEvent[]=[],seen=new Set<string>()
 for(const row of rows.results){if(seen.has(row.id))continue;try{const {entry}=await sourceFor(row.source_kind,row.source_id);const date=entry.date||row.calendar_date;if(date){events.push({...entry,id:`shared-${row.id}`,groupId:row.group_id,date,person:profileId,eventType:entry.kind==='task'?'task':'private',revision:1,readonly:true,sharedThreadId:row.id});seen.add(row.id)}}catch(e){if(!(e instanceof ChatError&&e.status===404))throw e}}
 return events
}
export async function dueReminders(p:PlannerPerson){
 const rows=await getDb().prepare('SELECT r.id,r.thread_id,r.remind_at,t.source_kind,t.source_id FROM entry_reminders r JOIN entry_threads t ON t.id=r.thread_id WHERE r.profile_id=? AND r.delivered=0 AND r.remind_at<=? ORDER BY r.remind_at LIMIT 20').bind(p.id,new Date().toISOString()).all<ThreadRow&{thread_id:string;remind_at:string}>()
 const result:{id:string;threadId:string;title:string;remindAt:string}[]=[]
 for(const r of rows.results){try{const a=await accessThread(r.thread_id,p);result.push({id:r.id,threadId:r.thread_id,title:a.source.entry.title,remindAt:r.remind_at})}catch(e){if(!(e instanceof ChatError&&[403,404].includes(e.status)))throw e}}
 return result
}

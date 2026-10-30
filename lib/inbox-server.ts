import { getDb } from '@/db'
import { ChatError, inGroup, sourceFor, type ThreadRow } from './discussion-server'
import type { ChatEntry, EntryRef } from './discussions'
import { parseAudience, type PlannerPerson } from './planner'
import type { InboxData, InboxItem, InboxType } from './inbox'

type Snapshot = { entry: ChatEntry; groupId: string; people: string[] }
export async function entrySnapshot(ref: EntryRef): Promise<Snapshot> {
  const db = getDb(), source = await sourceFor(ref.kind, ref.id)
  let person: string | null = null, audience: string[] | undefined
  if (ref.kind === 'todo') {
    const todo = await db.prepare('SELECT created_by FROM todo_items WHERE id=?').bind(ref.id).first<{created_by:string}>()
    if (todo) person = todo.created_by
    else return entrySnapshot({kind:'event',id:`todo-${ref.id}`})
  } else {
    const row = await db.prepare('SELECT person, audience FROM planner_events WHERE id=?').bind(ref.id).first<{person:string;audience:string|null}>()
      || await db.prepare("SELECT CASE WHEN kind='task' THEN assignee ELSE COALESCE(person,'all') END AS person, audience FROM calendar_items WHERE id=?").bind(ref.id).first<{person:string;audience:string|null}>()
    person = row?.person || null
    audience = parseAudience(row?.audience)
  }
  const members = await db.prepare('SELECT profile_id FROM planner_members WHERE group_id=?').bind(source.groupId).all<{profile_id:string}>()
  return {...source, people:members.results.map(m=>m.profile_id).filter(id=>audience?audience.includes(id):person==='all'||id===person)}
}

async function threadFor(ref: EntryRef, actor: PlannerPerson) {
  const db=getDb()
  let thread=await db.prepare('SELECT id,source_kind,source_id FROM entry_threads WHERE source_kind=? AND source_id=?').bind(ref.kind,ref.id).first<ThreadRow>()
  if (!thread && ref.kind==='event' && ref.id.startsWith('todo-')) thread=await db.prepare("SELECT id,source_kind,source_id FROM entry_threads WHERE source_kind='todo' AND source_id=?").bind(ref.id.slice(5)).first<ThreadRow>()
  if (!thread) {
    await db.prepare('INSERT OR IGNORE INTO entry_threads (id,source_kind,source_id,created_by,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),ref.kind,ref.id,actor.id,new Date().toISOString()).run()
    thread=await db.prepare('SELECT id,source_kind,source_id FROM entry_threads WHERE source_kind=? AND source_id=?').bind(ref.kind,ref.id).first<ThreadRow>()
  }
  return thread!
}

export async function recordEntryChange(ref: EntryRef, actor: PlannerPerson, previous?: Snapshot, removed=false) {
  const next=removed?previous!:await entrySnapshot(ref), before=previous?.entry, after=next.entry
  const fields=[['title','Titel'],['date','Datum'],['endDate','Zeitraum'],['time','Uhrzeit'],['note','Notiz'],['kind','Art']] as const
  const changed=fields.filter(([key])=>(before?.[key]||'')!==(after[key]||''))
  const assigned=previous&&previous.people.slice().sort().join('|')!==next.people.slice().sort().join('|')
  if (previous&&!removed&&!changed.length&&!assigned) return
  const thread=await threadFor(ref,actor),db=getDb()
  const guests=await db.prepare('SELECT DISTINCT g.profile_id FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE s.thread_id=? AND s.active=1').bind(thread.id).all<{profile_id:string}>()
  const recipients=[...new Set([...next.people,...(previous?.people||[]),...guests.results.map(g=>g.profile_id)])].filter(id=>id!==actor.id)
  if (!recipients.length) return
  const display=(key:string,value:string|undefined)=>value&&(key==='date'||key==='endDate')?new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${value}T12:00:00Z`)):value||'offen'
  const label=after.kind==='task'?'Auftrag':'Termin'
  const summary=removed?`${label} wurde entfernt.`:!previous?`${label} für deinen Kalender angelegt.`:[...changed.map(([key,name])=>key==='date'||key==='time'||key==='endDate'?`${name}: ${display(key,before?.[key])} → ${display(key,after[key])}`:`${name} aktualisiert`),...(assigned?['Zuständigkeit geändert']:[])].join(' · ')
  await db.prepare('INSERT INTO entry_changes (id,thread_id,group_id,actor_id,kind,title,entry_kind,date,summary,recipients,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),thread.id,next.groupId,actor.id,removed?'cancelled':previous?'changed':'created',after.title,after.kind,after.date||null,summary,JSON.stringify(recipients),new Date().toISOString()).run()
}

type ActivityRow={thread_id:string;id:string;created_at:string;type:InboxType;preview:string;author:string;author_id:string;color:string;unread:number;messages:number;images:number;audio:number;shared:number;changes:number;change_preview:string}
export async function inboxFor(profile: PlannerPerson): Promise<InboxData> {
  const db=getDb()
  // Only personal entries, received links, and changes explicitly addressed to this profile.
  const candidates=await db.prepare(`WITH viewer AS (SELECT ? AS id)
    SELECT t.id,t.source_kind,t.source_id FROM entry_threads t CROSS JOIN viewer v WHERE
    EXISTS (SELECT 1 FROM planner_events e JOIN planner_members m ON m.group_id=e.group_id WHERE t.source_kind='event' AND t.source_id=e.id AND m.profile_id=v.id AND e.waste_kind IS NULL AND (e.person IN (v.id,'all') OR EXISTS (SELECT 1 FROM json_each(e.audience) WHERE value=v.id)))
    OR EXISTS (SELECT 1 FROM calendar_items c JOIN planner_members m ON m.group_id='family' WHERE c.id=CASE WHEN t.source_kind='todo' THEN 'todo-'||t.source_id ELSE t.source_id END AND m.profile_id=v.id AND ((CASE WHEN c.kind='task' THEN c.assignee ELSE COALESCE(c.person,'all') END) IN (v.id,'all') OR EXISTS (SELECT 1 FROM json_each(c.audience) WHERE value=v.id)))
    OR EXISTS (SELECT 1 FROM todo_items o JOIN planner_members m ON m.group_id='family' WHERE t.source_kind='todo' AND t.source_id=o.id AND m.profile_id=v.id AND o.created_by=v.id)
    OR EXISTS (SELECT 1 FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE s.thread_id=t.id AND s.active=1 AND g.profile_id=v.id)
    OR EXISTS (SELECT 1 FROM entry_changes c JOIN planner_members m ON m.group_id=c.group_id WHERE c.thread_id=t.id AND m.profile_id=v.id AND EXISTS (SELECT 1 FROM json_each(c.recipients) WHERE value=v.id))`).bind(profile.id).all<ThreadRow>()
  if (!candidates.results.length) return {items:[],unread:0}
  const entries=new Map<string,{entry:ChatEntry;canOpen:boolean;shareToken?:string}>()
  for (const t of candidates.results) {
    const guest=await db.prepare('SELECT s.token FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE g.profile_id=? AND s.thread_id=? AND s.active=1 ORDER BY g.created_at LIMIT 1').bind(profile.id,t.id).first<{token:string}>()
    try {
      const source=await sourceFor(t.source_kind,t.source_id)
      // Old change receipts stop exposing an entry after leaving its group or revoking a link.
      if (!guest&&!await inGroup(source.groupId,profile.id)) continue
      entries.set(t.id,{entry:source.entry,canOpen:true,...(guest?{shareToken:guest.token}:{})})
    } catch(e) {
      if (!(e instanceof ChatError&&e.status===404)) throw e
      const deleted=await db.prepare("SELECT c.* FROM entry_changes c WHERE c.thread_id=? AND c.kind='cancelled' AND (EXISTS (SELECT 1 FROM planner_members m WHERE m.group_id=c.group_id AND m.profile_id=?) OR ?=1) AND EXISTS (SELECT 1 FROM json_each(c.recipients) WHERE value=?) ORDER BY c.created_at DESC LIMIT 1").bind(t.id,profile.id,guest?1:0,profile.id).first<{title:string;entry_kind:'event'|'task';date:string|null}>()
      if (deleted) entries.set(t.id,{entry:{title:deleted.title,kind:deleted.entry_kind,...(deleted.date?{date:deleted.date}:{})},canOpen:false})
    }
  }
  const ids=[...entries.keys()],items:InboxItem[]=[]
  for (let offset=0;offset<ids.length;offset+=25) {
    const batch=ids.slice(offset,offset+25),slots=batch.map(()=>'?').join(',')
    const rows=await db.prepare(`WITH viewer AS (SELECT ? AS id), activity AS (
      SELECT 'message:'||m.id AS id,m.thread_id,m.created_at,CASE WHEN a.mime LIKE 'image/%' THEN 'image' WHEN a.mime LIKE 'audio/%' THEN 'audio' ELSE 'message' END AS type,m.body AS preview,p.name AS author,p.id AS author_id,p.color FROM entry_messages m JOIN planner_profiles p ON p.id=m.author_id LEFT JOIN entry_attachments a ON a.id=m.attachment_id WHERE m.thread_id IN (${slots}) AND m.author_id<>(SELECT id FROM viewer)
      UNION ALL SELECT 'change:'||c.id,c.thread_id,c.created_at,c.kind,c.summary,p.name,p.id,p.color FROM entry_changes c JOIN planner_profiles p ON p.id=c.actor_id WHERE c.thread_id IN (${slots}) AND c.actor_id<>(SELECT id FROM viewer) AND EXISTS (SELECT 1 FROM json_each(c.recipients) WHERE value=(SELECT id FROM viewer))
      UNION ALL SELECT 'shared:'||s.token,s.thread_id,g.created_at,'shared','Eintrag und gemeinsamer Chat mit dir geteilt.',p.name,p.id,p.color FROM entry_guests g JOIN entry_shares s ON s.token=g.token JOIN planner_profiles p ON p.id=s.created_by WHERE s.thread_id IN (${slots}) AND g.profile_id=(SELECT id FROM viewer) AND s.created_by<>(SELECT id FROM viewer) AND s.active=1
    ), ranked AS (SELECT a.*,
      SUM(CASE WHEN a.created_at>COALESCE(st.read_at,'') OR (a.created_at=st.read_at AND a.id>st.read_id) THEN 1 ELSE 0 END) OVER (PARTITION BY a.thread_id) AS unread,
      SUM(a.type='message') OVER (PARTITION BY a.thread_id) AS messages,SUM(a.type='image') OVER (PARTITION BY a.thread_id) AS images,SUM(a.type='audio') OVER (PARTITION BY a.thread_id) AS audio,SUM(a.type='shared') OVER (PARTITION BY a.thread_id) AS shared,SUM(a.type IN ('created','changed','cancelled')) OVER (PARTITION BY a.thread_id) AS changes,
      FIRST_VALUE(CASE WHEN a.type IN ('created','changed','cancelled') THEN a.preview ELSE '' END) OVER (PARTITION BY a.thread_id ORDER BY CASE WHEN a.type IN ('created','changed','cancelled') THEN a.created_at ELSE '' END DESC,a.id DESC) AS change_preview,
      ROW_NUMBER() OVER (PARTITION BY a.thread_id ORDER BY a.created_at DESC,a.id DESC) AS position FROM activity a LEFT JOIN inbox_states st ON st.thread_id=a.thread_id AND st.profile_id=(SELECT id FROM viewer)) SELECT * FROM ranked WHERE position=1`).bind(profile.id,...batch,...batch,...batch).all<ActivityRow>()
    for (const row of rows.results) {
      const entry=entries.get(row.thread_id)!
      const type=entry.canOpen?row.type:'cancelled',preview=entry.canOpen?row.preview:`${entry.entry.kind==='task'?'Auftrag':'Termin'} wurde entfernt.`
      items.push({...entry,threadId:row.thread_id,activityId:row.id,createdAt:row.created_at,type,preview,author:row.author,authorId:row.author_id,color:row.color,unread:row.unread,types:[...(row.messages?['message' as const]:[]),...(row.images?['image' as const]:[]),...(row.audio?['audio' as const]:[]),...(row.shared?['shared' as const]:[]),...(row.changes?['changed' as const]:[])],...(row.change_preview?{changePreview:row.change_preview}:{})})
    }
  }
  items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.activityId.localeCompare(a.activityId))
  return {items,unread:items.filter(item=>item.unread>0).length}
}

export async function markInboxRead(profile:PlannerPerson,threadId?:string) {
  const inbox=await inboxFor(profile),items=inbox.items.filter(item=>item.unread&&(!threadId||item.threadId===threadId)),db=getDb()
  for(let offset=0;offset<items.length;offset+=50) await db.batch(items.slice(offset,offset+50).map(item=>db.prepare('INSERT INTO inbox_states (profile_id,thread_id,read_at,read_id) VALUES (?,?,?,?) ON CONFLICT(profile_id,thread_id) DO UPDATE SET read_at=excluded.read_at,read_id=excluded.read_id WHERE excluded.read_at>inbox_states.read_at OR (excluded.read_at=inbox_states.read_at AND excluded.read_id>inbox_states.read_id)').bind(profile.id,item.threadId,item.createdAt,item.activityId)))
  return inboxFor(profile)
}

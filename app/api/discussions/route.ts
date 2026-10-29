import {isCalendarDate} from '@/lib/discussions'
import {getDb} from '@/db'
import {accessThread,allowChatWrite,ChatError,chatBundle,chatFail,chatIdentity,chatReply,clean,dueReminders,inGroup,openThread,threadFromShare} from '@/lib/discussion-server'
export const dynamic='force-dynamic'
export async function GET(request:Request){try{
 const url=new URL(request.url),token=url.searchParams.get('share')||undefined,p=await chatIdentity(request,!!token)
 if(url.searchParams.get('reminders')==='due'){if(!p)throw new ChatError('Bitte öffne dein Profil.',401);return chatReply({reminders:await dueReminders(p)})}
 const id=token?(await threadFromShare(token)).id:clean(url.searchParams.get('thread'),100)
 return chatReply(await chatBundle(id,p,token,clean(url.searchParams.get('before'),140)||undefined))
}catch(e){return chatFail(e)}}
export async function POST(request:Request){
 if(!allowChatWrite(request))return chatReply({error:'Unzulässige Anfrage.'},403)
 try{
  if(Number(request.headers.get('content-length'))>20000)throw new ChatError('Die Nachricht ist zu groß.',413)
  const p=(await chatIdentity(request))!,input=await request.json() as Record<string,unknown>,db=getDb(),action=clean(input.action,30),token=clean(input.shareToken,64)||undefined
  if(action==='open'){if(input.kind!=='todo'&&input.kind!=='event')throw new ChatError('Ungültiger Eintrag.');const t=await openThread({kind:input.kind,id:clean(input.id,100)},p);return chatReply(await chatBundle(t.id,p,undefined,undefined,t.verified))}
  if(action==='dismiss-reminder'){await db.prepare('UPDATE entry_reminders SET delivered=1 WHERE id=? AND profile_id=?').bind(clean(input.id,100),p.id).run();return chatReply({saved:true})}
  const id=token?(await threadFromShare(token)).id:clean(input.threadId,100),{member,source}=await accessThread(id,p,token)
  if(action==='share'){
   if(!member)throw new ChatError('Nur Gruppenmitglieder können einen Terminlink erstellen.',403)
   const old=await db.prepare('SELECT token FROM entry_shares WHERE thread_id=? AND active=1 ORDER BY created_at DESC LIMIT 1').bind(id).first<{token:string}>(),next=old?.token||crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')
   if(!old)await db.prepare('INSERT INTO entry_shares (token,thread_id,created_by,active,created_at) VALUES (?,?,?,1,?)').bind(next,id,p.id,new Date().toISOString()).run()
   return chatReply({token:next})
  }
  if(action==='revoke-share'){if(!member)throw new ChatError('Nur Gruppenmitglieder können die Freigabe zurücknehmen.',403);await db.prepare('UPDATE entry_shares SET active=0 WHERE thread_id=?').bind(id).run()}
  else if(action==='join'||action==='import'){
   if(!token)throw new ChatError('Bitte öffne den Terminlink erneut.')
   const calendarDate=action==='import'?(source.entry.date||clean(input.date,10)):null
   if(action==='import'&&!isCalendarDate(calendarDate))throw new ChatError('Bitte wähle einen Tag für deinen Kalender.')
   let group=action==='import'?clean(input.groupId,100):null
   if(action==='import'&&!group){const old=await db.prepare('SELECT group_id FROM planner_members WHERE profile_id=? LIMIT 1').bind(p.id).first<{group_id:string}>();if(old)group=old.group_id;else{group=crypto.randomUUID();await db.batch([db.prepare('INSERT INTO planner_groups (id,name,category,color,invite_code,created_by) VALUES (?,?,?,?,?,?)').bind(group,'Mein Kalender','Sonstiges','#6335dc',crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),p.id),db.prepare('INSERT INTO planner_members (group_id,profile_id) VALUES (?,?)').bind(group,p.id)])}}
   if(group&&!await inGroup(group,p.id))throw new ChatError('Bitte wähle einen eigenen Kalender.',403)
   await db.prepare('INSERT INTO entry_guests (token,profile_id,group_id,calendar_date,created_at) VALUES (?,?,?,?,?) ON CONFLICT(token,profile_id) DO UPDATE SET group_id=COALESCE(excluded.group_id,entry_guests.group_id),calendar_date=COALESCE(excluded.calendar_date,entry_guests.calendar_date)').bind(token,p.id,group,calendarDate,new Date().toISOString()).run()
  }else if(action==='message'){
   const body=clean(input.body,4001),messageId=clean(input.messageId,100)
   if(!body||body.length>4000)throw new ChatError('Eine Nachricht darf 1 bis 4.000 Zeichen enthalten.')
   if(!/^[a-f0-9-]{36}$/.test(messageId))throw new ChatError('Ungültige Nachricht.')
   const count=await db.prepare('SELECT COUNT(*) AS count FROM entry_messages WHERE author_id=? AND created_at>?').bind(p.id,new Date(Date.now()-60000).toISOString()).first<{count:number}>()
   if((count?.count||0)>=40)throw new ChatError('Einen Moment bitte. Du hast gerade sehr viele Nachrichten gesendet.',429)
   if(token&&!member)await db.prepare('INSERT OR IGNORE INTO entry_guests (token,profile_id,created_at) VALUES (?,?,?)').bind(token,p.id,new Date().toISOString()).run()
   const old=await db.prepare('SELECT author_id,thread_id FROM entry_messages WHERE id=?').bind(messageId).first<{author_id:string;thread_id:string}>()
   if(old&&(old.author_id!==p.id||old.thread_id!==id))throw new ChatError('Ungültige Nachricht.',409)
   await db.prepare('INSERT OR IGNORE INTO entry_messages (id,thread_id,author_id,body,created_at) VALUES (?,?,?,?,?)').bind(messageId,id,p.id,body,new Date().toISOString()).run()
  }else if(action==='reminder'){
   const date=new Date(clean(input.remindAt,40));if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()-30000||date.getTime()>Date.now()+366*86400000)throw new ChatError('Bitte wähle eine zukünftige Zeit innerhalb des nächsten Jahres.')
   if(token&&!member)await db.prepare('INSERT OR IGNORE INTO entry_guests (token,profile_id,created_at) VALUES (?,?,?)').bind(token,p.id,new Date().toISOString()).run()
   const count=await db.prepare('SELECT COUNT(*) AS count FROM entry_reminders WHERE profile_id=? AND delivered=0').bind(p.id).first<{count:number}>();if((count?.count||0)>=100)throw new ChatError('Du kannst bis zu 100 offene Erinnerungen anlegen.')
   await db.prepare('INSERT INTO entry_reminders (id,thread_id,profile_id,remind_at,delivered) VALUES (?,?,?,?,0)').bind(crypto.randomUUID(),id,p.id,date.toISOString()).run()
  }else if(action==='remove-reminder'){await db.prepare('DELETE FROM entry_reminders WHERE id=? AND thread_id=? AND profile_id=?').bind(clean(input.id,100),id,p.id).run()}
  else throw new ChatError('Unbekannte Chat-Aktion.')
  return chatReply(await chatBundle(id,p,token))
 }catch(e){return chatFail(e)}
}

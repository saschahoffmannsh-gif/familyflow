import {env} from 'cloudflare:workers'
import {getDb} from '@/db'
import {accessThread,allowChatWrite,ChatError,chatBundle,chatFail,chatIdentity,chatReply,clean,threadFromShare} from '@/lib/discussion-server'
import {MAX_AUDIO_BYTES,validateAttachment} from '@/lib/discussions'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 if(!allowChatWrite(request))return chatReply({error:'Unzulässige Anfrage.'},403)
 try{
  if(Number(request.headers.get('content-length'))>MAX_AUDIO_BYTES+100000)throw new ChatError('Die Datei ist zu groß.',413)
  const p=(await chatIdentity(request))!,form=await request.formData(),file=form.get('file'),token=clean(form.get('shareToken'),64)||undefined
  if(!(file instanceof File))throw new ChatError('Bitte wähle eine Datei.')
  const threadId=token?(await threadFromShare(token)).id:clean(form.get('threadId'),100),{member}=await accessThread(threadId,p,token)
  let mime:string;try{mime=validateAttachment(file.type,file.size,new Uint8Array(await file.slice(0,16).arrayBuffer()))}catch(e){throw new ChatError((e as Error).message)}
  const db=getDb(),now=new Date().toISOString(),recent=await db.prepare('SELECT COUNT(*) AS count FROM entry_attachments WHERE author_id=? AND created_at>?').bind(p.id,new Date(Date.now()-60000).toISOString()).first<{count:number}>()
  if((recent?.count||0)>=12)throw new ChatError('Bitte warte kurz vor dem nächsten Upload.',429)
  const total=await db.prepare('SELECT COALESCE(SUM(size),0) AS size FROM entry_attachments WHERE thread_id=?').bind(threadId).first<{size:number}>()
  if((total?.size||0)+file.size>250*1024*1024)throw new ChatError('Dieser Chat hat sein Dateilimit von 250 MB erreicht.',413)
  if(!env.BUCKET)throw new ChatError('Der Dateispeicher ist noch nicht bereit. Bitte erneut versuchen.',503)
  const id=crypto.randomUUID(),key=`discussions/${threadId}/${id}`,duration=Math.round(Number(form.get('duration')))
  await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:mime}})
  try{const statements=[db.prepare('INSERT INTO entry_attachments (id,thread_id,author_id,object_key,name,mime,size,duration,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,threadId,p.id,key,clean(file.name,150)||'Anhang',mime,file.size,Number.isFinite(duration)&&duration>0&&duration<=300?duration:null,now),db.prepare('INSERT INTO entry_messages (id,thread_id,author_id,body,attachment_id,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),threadId,p.id,clean(form.get('caption'),4000),id,now)];if(token&&!member)statements.push(db.prepare('INSERT OR IGNORE INTO entry_guests (token,profile_id,created_at) VALUES (?,?,?)').bind(token,p.id,now));await db.batch(statements)}catch(e){await env.BUCKET.delete(key);throw e}
  return chatReply(await chatBundle(threadId,p,token))
 }catch(e){return chatFail(e)}
}

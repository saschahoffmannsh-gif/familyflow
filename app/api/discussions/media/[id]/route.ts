import {env} from 'cloudflare:workers'
import {getDb} from '@/db'
import {accessThread,ChatError,chatFail,chatIdentity,clean} from '@/lib/discussion-server'
export const dynamic='force-dynamic'
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{
 const {id}=await context.params,token=clean(new URL(request.url).searchParams.get('share'),64)||undefined,p=await chatIdentity(request,!!token)
 const file=await getDb().prepare('SELECT thread_id,object_key,mime FROM entry_attachments WHERE id=?').bind(id).first<{thread_id:string;object_key:string;mime:string}>()
 if(!file)throw new ChatError('Dieser Anhang wurde nicht gefunden.',404)
 await accessThread(file.thread_id,p,token);const object=await env.BUCKET?.get(file.object_key)
 if(!object)throw new ChatError('Dieser Anhang ist nicht mehr verfügbar.',404)
 return new Response(object.body,{headers:{'Content-Type':file.mime,'Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}})
}catch(e){return chatFail(e)}}

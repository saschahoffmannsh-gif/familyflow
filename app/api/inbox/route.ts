import { allowChatWrite, chatFail, chatIdentity, chatReply, ChatError, clean } from '@/lib/discussion-server'
import { inboxFor, markInboxRead } from '@/lib/inbox-server'
export const dynamic='force-dynamic'
export async function GET(request:Request) {
  try { return chatReply(await inboxFor((await chatIdentity(request))!)) } catch(e) { return chatFail(e) }
}
export async function POST(request:Request) {
  if(!allowChatWrite(request))return chatReply({error:'Unzulässige Anfrage.'},403)
  try {
    const profile=(await chatIdentity(request))!,input=await request.json() as Record<string,unknown>
    if(input.action!=='read'&&input.action!=='read-all')throw new ChatError('Unbekannte Aktion.')
    const threadId=input.action==='read'?clean(input.threadId,100):undefined
    if(input.action==='read'&&!threadId)throw new ChatError('Bitte wähle einen Eintrag.')
    return chatReply(await markInboxRead(profile,threadId))
  } catch(e) { return chatFail(e) }
}

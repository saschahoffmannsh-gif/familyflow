import { allowChatWrite, chatFail, chatIdentity, chatReply, ChatError } from '@/lib/discussion-server'
import { markNoticesSeen, noticesFor } from '@/lib/notices-server'
export const dynamic='force-dynamic'
export async function GET(request:Request) {
  try { return chatReply(await noticesFor((await chatIdentity(request))!, new URL(request.url).searchParams.get('count')==='1')) } catch(e) { return chatFail(e) }
}
export async function POST(request:Request) {
  if(!allowChatWrite(request))return chatReply({error:'Unzulässige Anfrage.'},403)
  try {
    const profile=(await chatIdentity(request))!,input=await request.json() as Record<string,unknown>
    if(input.action!=='seen')throw new ChatError('Unbekannte Aktion.')
    await markNoticesSeen(profile)
    return chatReply(await noticesFor(profile))
  } catch(e) { return chatFail(e) }
}

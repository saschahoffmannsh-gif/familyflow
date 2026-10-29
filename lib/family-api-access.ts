import {chatFail,chatIdentity,chatReply,inGroup} from './discussion-server'
export async function familyApiAccess(request:Request){try{const p=(await chatIdentity(request))!;return await inGroup('family',p.id)?null:chatReply({error:'Diese Liste gehört zur Familiengruppe.'},403)}catch(e){return chatFail(e)}}

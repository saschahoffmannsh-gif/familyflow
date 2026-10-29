type Draft={id?:string;groupId?:string;title?:string;date?:string;endDate?:string;time?:string;note?:string;person?:string;kind?:'event'|'task';eventType?:string}
export function unchangedChatDraft(saved:Draft,draft:Draft) {
  if(!saved.id||saved.id!==draft.id)return false
  const category=(entry:Draft)=>entry.kind==='task'||entry.eventType==='task'?'task':entry.eventType||'private'
  return category(saved)===category(draft)&&(['groupId','title','date','endDate','time','note','person'] as const).every(key=>(saved[key]||'')===(draft[key]||''))
}

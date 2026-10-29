'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlannerIdentity } from '@/lib/planner'
import type { InboxData } from '@/lib/inbox'
const empty:InboxData={items:[],unread:0}

export function useInbox(identity:PlannerIdentity|null) {
  const [data,setData]=useState<InboxData>(empty),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const sequence=useRef(0)
  const request=useCallback(async(body?:unknown)=>{
    if(!identity)return
    const current=++sequence.current
    setLoading(true)
    try {
      const r=await fetch('/api/inbox',{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${identity.key}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
      const result=await r.json() as InboxData&{error?:string}
      if(!r.ok)throw new Error(result.error||'Deine Nachrichten konnten nicht geladen werden.')
      if(current===sequence.current){setData(result);setError('')}
    } catch(e) { if(current===sequence.current)setError((e as Error).message) }
    finally { if(current===sequence.current)setLoading(false) }
  },[identity?.key])
  const refresh=useCallback(()=>request(),[request])
  const markRead=useCallback((threadId?:string)=>request(threadId?{action:'read',threadId}:{action:'read-all'}),[request])
  useEffect(()=>{
    setData(empty)
    if(!identity)return
    void refresh()
    const visible=()=>{if(document.visibilityState==='visible')void refresh()},timer=setInterval(visible,10000)
    document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible)
    return()=>{sequence.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible)}
  },[identity?.key,refresh])
  return {data,loading,error,refresh,markRead}
}

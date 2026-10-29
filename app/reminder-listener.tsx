'use client'
import {useEffect,useRef} from 'react'
import {toast} from 'sonner'
import type {PlannerIdentity} from '@/lib/planner'
export default function ReminderListener({identity,onOpen}:{identity:PlannerIdentity;onOpen:(threadId:string)=>void}){
 const open=useRef(onOpen);open.current=onOpen
 useEffect(()=>{let active=true,checking=false;const seen=new Set<string>();const check=async()=>{if(checking||document.visibilityState!=='visible')return;checking=true;try{const r=await fetch('/api/discussions?reminders=due',{cache:'no-store',headers:{Authorization:`Bearer ${identity.key}`}});if(!r.ok)return;const {reminders}=await r.json() as {reminders:{id:string;threadId:string;title:string}[]};if(!active)return;for(const item of reminders){if(seen.has(item.id))continue;seen.add(item.id);toast(item.title,{description:'Deine Erinnerung in Done',duration:15000,action:{label:'Öffnen',onClick:()=>open.current(item.threadId)}});await fetch('/api/discussions',{method:'POST',headers:{Authorization:`Bearer ${identity.key}`,'Content-Type':'application/json'},body:JSON.stringify({action:'dismiss-reminder',id:item.id})})}}catch{}finally{checking=false}};void check();const timer=setInterval(()=>void check(),30000),again=()=>void check();document.addEventListener('visibilitychange',again);window.addEventListener('online',again);return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',again);window.removeEventListener('online',again)}},[identity.key]);return null
}

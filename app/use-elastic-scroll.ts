'use client'
import {useEffect,type RefObject} from 'react'
import {elasticScrollOffset} from '@/lib/elastic-scroll'

export function useElasticScroll(viewport:RefObject<HTMLDivElement|null>,content:RefObject<HTMLDivElement|null>,ready=true) {
  useEffect(()=>{
    if(!ready)return
    const node=viewport.current,body=content.current
    if(!node||!body)return
    let start:{x:number;y:number;lastY:number}|null=null,raw=0,offset=0,animation:Animation|null=null,timer:ReturnType<typeof setTimeout>|null=null
    const cancel=()=>{animation?.cancel();animation=null;if(timer)clearTimeout(timer);timer=null}
    const move=(distance:number)=>{raw=distance;offset=elasticScrollOffset(raw,node.clientHeight);body.style.transform=`translate3d(0,${offset}px,0)`}
    const release=()=>{
      const y=offset;raw=0;offset=0;start=null;body.style.transform='translate3d(0,0,0)'
      if(!y||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return
      animation=body.animate([{transform:`translate3d(0,${y}px,0)`},{transform:`translate3d(0,${-y*.12}px,0)`,offset:.64},{transform:`translate3d(0,${y*.025}px,0)`,offset:.84},{transform:'translate3d(0,0,0)'}],{duration:460,easing:'cubic-bezier(.2,.7,.3,1)'})
    }
    const touchStart=(event:TouchEvent)=>{cancel();move(0);if(event.touches.length!==1){start=null;return}const t=event.touches[0];start={x:t.clientX,y:t.clientY,lastY:t.clientY}}
    const touchMove=(event:TouchEvent)=>{
      if(!start||event.touches.length!==1)return
      const t=event.touches[0],dy=t.clientY-start.lastY;start.lastY=t.clientY
      if(Math.abs(t.clientX-start.x)>Math.abs(t.clientY-start.y)*1.2)return
      const top=node.scrollTop<=.5,bottom=node.scrollHeight-node.clientHeight-node.scrollTop<=.5
      if(raw||(top&&dy>0)||(bottom&&dy<0)){
        if(event.cancelable)event.preventDefault()
        const next=raw+dy
        move(raw&&Math.sign(next)!==Math.sign(raw)?0:next)
      }
    }
    const wheel=(event:WheelEvent)=>{
      if(Math.abs(event.deltaX)>Math.abs(event.deltaY))return
      const top=node.scrollTop<=.5,bottom=node.scrollHeight-node.clientHeight-node.scrollTop<=.5
      if((top&&event.deltaY<0)||(bottom&&event.deltaY>0)){
        if(event.cancelable)event.preventDefault()
        cancel();move(raw-event.deltaY*.65);timer=setTimeout(release,90)
      }
    }
    node.addEventListener('touchstart',touchStart,{passive:true});node.addEventListener('touchmove',touchMove,{passive:false});node.addEventListener('touchend',release);node.addEventListener('touchcancel',release);node.addEventListener('wheel',wheel,{passive:false})
    return()=>{cancel();body.style.transform='';node.removeEventListener('touchstart',touchStart);node.removeEventListener('touchmove',touchMove);node.removeEventListener('touchend',release);node.removeEventListener('touchcancel',release);node.removeEventListener('wheel',wheel)}
  },[viewport,content,ready])
}

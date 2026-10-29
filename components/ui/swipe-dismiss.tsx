"use client"

import { createContext, useContext, useEffect, useRef, type PointerEvent } from "react"
import { shouldDismissSwipe } from "@/lib/swipe-dismiss"
import "./swipe-dismiss.css"

export const SwipeDismissContext = createContext<() => void>(() => {})

export function useSwipeDismiss(enabled: boolean) {
  const dismiss = useContext(SwipeDismissContext)
  const gesture = useRef<{ id: number; x: number; y: number; at: number; locked: boolean; node: HTMLElement; translate: string; transition: string; opacity: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settling = useRef(false)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function restore(animate = true) {
    const g = gesture.current
    if (!g) return
    settling.current = true
    g.node.style.transition = animate ? "translate 180ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease" : g.transition
    g.node.style.translate = g.translate
    g.node.style.opacity = g.opacity
    timer.current = setTimeout(() => { g.node.style.transition = g.transition; gesture.current = null; settling.current = false }, animate ? 180 : 0)
  }

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled || settling.current || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return
      const node = event.currentTarget, target = event.target as Element
      if (target.closest('[data-slot="dialog-content"],[data-slot="sheet-content"]') !== node) return
      if (target.closest('input,textarea,select,button,a,audio,video,img,[role="slider"],[data-no-swipe]')) return
      // The leading edge and headers act as grab areas; form editing and scrolling stay native.
      if (event.clientX - node.getBoundingClientRect().left > 48 && !target.closest('[data-slot="dialog-header"],[data-slot="sheet-header"],.done-chat__header,.p-day-heading')) return
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), locked: false, node, translate: node.style.translate, transition: node.style.transition, opacity: node.style.opacity }
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g || settling.current || event.pointerId !== g.id) return
      const dx = event.clientX - g.x, dy = event.clientY - g.y
      if (!g.locked) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { gesture.current = null; return }
        if (dx < -12) { gesture.current = null; return }
        if (dx < 10 || dx < Math.abs(dy) * 1.5) return
        g.locked = true
        g.node.setPointerCapture(event.pointerId)
        g.node.style.transition = "none"
      }
      event.preventDefault()
      const distance = Math.max(0, dx)
      g.node.style.translate = `${distance}px 0`
      g.node.style.opacity = String(1 - Math.min(.22, distance / g.node.clientWidth * .2))
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g || settling.current || event.pointerId !== g.id) return
      if (g.node.hasPointerCapture(event.pointerId)) g.node.releasePointerCapture(event.pointerId)
      if (!g.locked) { gesture.current = null; return }
      const dx = event.clientX - g.x, dy = event.clientY - g.y
      if (!shouldDismissSwipe(dx, dy, g.node.clientWidth, performance.now() - g.at)) { restore(); return }
      settling.current = true
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160
      g.node.style.transition = `translate ${duration}ms ease-out, opacity ${duration}ms ease-out`
      g.node.style.translate = `${window.innerWidth - g.node.getBoundingClientRect().left + dx}px 0`
      g.node.style.opacity = "0"
      timer.current = setTimeout(() => {
        dismiss()
        // A parent may veto dismissal while saving. Restore that window after React commits.
        timer.current = setTimeout(() => { if (g.node.isConnected && g.node.dataset.state === 'open') restore(); else { gesture.current = null; settling.current = false } }, 32)
      }, duration)
    },
    onPointerCancel() { if (!settling.current) restore() },
  }
}

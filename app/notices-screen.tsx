'use client'
import { Bell, CalendarDays, CircleCheck } from 'lucide-react'
import type { Notice } from '@/lib/notices'

const day = (date: string) => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
function ago(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'gerade'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.round(hours / 24)
  return days === 1 ? 'gestern' : `vor ${days} Tagen`
}

export default function NoticesScreen({ items, loading, onOpen }: { items: Notice[]; loading: boolean; onOpen: (item: Notice) => void }) {
  return <section className="p-notices" aria-labelledby="notices-title">
    <div className="p-section-heading"><div><span className="p-eyebrow">Von anderen eingetragen</span><h1 id="notices-title">Mitteilungen</h1></div></div>
    {items.length ? <ul className="p-notice-list">{items.map(item => <li key={item.id}>
      <button type="button" className={`p-notice ${item.unread ? 'is-new' : ''}`} onClick={() => onOpen(item)} aria-label={`${item.entryKind === 'task' ? 'Auftrag' : 'Termin'} ${item.title}, eingetragen von ${item.actor}${item.unread ? ', neu' : ''}`}>
        <span className="p-notice__icon">{item.entryKind === 'task' ? <CircleCheck size={18} /> : <CalendarDays size={18} />}</span>
        <span className="p-notice__copy"><strong>{item.title}</strong><span>{item.date ? day(item.date) : 'Offen'}{item.time ? ` · ${item.time}` : ''} · {item.entryKind === 'task' ? 'Auftrag' : 'Termin'}</span><small><i style={{ background: item.actorColor }} />{item.actor} · {ago(item.createdAt)}</small></span>
        {item.unread && <span className="p-notice__dot" aria-hidden="true" />}
      </button></li>)}</ul>
      : <div className="p-notice-empty"><Bell /><p>{loading ? 'Wird geladen …' : 'Nichts Neues.'}</p></div>}
  </section>
}

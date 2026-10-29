'use client'
import { Bell, ChevronRight, Image, MessageCircle, Mic } from 'lucide-react'
import type { EntryActivity } from '@/lib/discussions'

export default function ChatLaunch({ onClick, disabled = false, fresh = false, activity }: { onClick: () => void; disabled?: boolean; fresh?: boolean; activity?: EntryActivity }) {
  const types = [
    { Icon: MessageCircle, kind: 'messages', label: 'Nachrichten', singular: 'Nachricht', count: activity?.messages ?? 0 },
    { Icon: Image, kind: 'images', label: 'Bilder', singular: 'Bild', count: activity?.images ?? 0 },
    { Icon: Mic, kind: 'audio', label: 'Sprachnachrichten', singular: 'Sprachnachricht', count: activity?.audio ?? 0 },
    { Icon: Bell, kind: 'reminders', label: 'Erinnerungen', singular: 'Erinnerung', count: 0 },
  ]
  const action = fresh ? 'Eintrag speichern und Chat öffnen' : 'Chat öffnen'
  const content = types.filter(type => type.count > 0).map(type => `${type.count} ${type.count === 1 ? type.singular : type.label}`).join(', ')
  return <button type="button" className="done-chat-launch" onClick={onClick} disabled={disabled} aria-label={`${action}${content ? `. ${content}` : ''}`} title={fresh && disabled ? 'Gib dem Eintrag zuerst einen Titel.' : action}>
    <span className="done-chat-launch__icon" aria-hidden="true"><MessageCircle size={23}/></span>
    <span className="done-chat-launch__content">
      <span className="done-chat-launch__title"><strong>Chat</strong>{fresh && <small>Speichern & öffnen</small>}</span>
      <span className="done-chat-launch__symbols" aria-hidden="true">{types.map(({ Icon, kind, label, singular, count }) => <span key={kind} className={`done-chat-launch__${kind} ${count ? 'is-populated' : ''}`} title={count ? `${count} ${count === 1 ? singular : label}` : label}><Icon/>{count > 0 && <span>{count > 99 ? '99+' : count}</span>}</span>)}</span>
    </span>
    <ChevronRight className="done-chat-launch__arrow" size={18} aria-hidden="true"/>
  </button>
}

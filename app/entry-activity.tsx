import { Image, MessageCircle, Mic } from 'lucide-react'
import type { EntryActivity } from '@/lib/discussions'

export default function ActivityBadges({ activity, compact = false }: { activity?: EntryActivity; compact?: boolean }) {
  if (!activity || !Object.values(activity).some(count => count > 0)) return null
  const items = [
    { count: activity.messages, Icon: MessageCircle, kind: 'messages', label: activity.messages === 1 ? '1 Nachricht' : `${activity.messages} Nachrichten` },
    { count: activity.images, Icon: Image, kind: 'images', label: activity.images === 1 ? '1 Bild' : `${activity.images} Bilder` },
    { count: activity.audio, Icon: Mic, kind: 'audio', label: activity.audio === 1 ? '1 Sprachnachricht' : `${activity.audio} Sprachnachrichten` },
  ].filter(item => item.count > 0)
  return <span className={`done-activity ${compact ? 'done-activity--compact' : ''}`} role="img" aria-label={items.map(item => item.label).join(', ')}>
    {items.map(({ count, Icon, kind, label }) => <span className={`done-activity__${kind}`} key={kind} title={label}><Icon aria-hidden="true"/>{!compact && <span aria-hidden="true">{count}</span>}</span>)}
  </span>
}

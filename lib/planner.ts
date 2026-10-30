import type { WasteKind } from './waste-calendar'
import type { EntryActivity } from './discussions'
export type PlannerPerson = { id: string; name: string; color: string }
export type PlannerSubgroup = { id: string; name: string; members: string[] }
export type PlannerGroup = { id: string; name: string; category: string; color: string; inviteCode: string; members: PlannerPerson[]; subgroups?: PlannerSubgroup[] }
export type PlannerEvent = { id: string; groupId: string; title: string; date: string; endDate?: string; time?: string; note?: string; person: string; eventType: string; revision: number; kind?: 'event' | 'task'; completed?: boolean; wasteKind?: WasteKind; audience?: string[]; readonly?: boolean; sharedThreadId?: string; activity?: EntryActivity }
export type PlannerData = { profile: PlannerPerson; groups: PlannerGroup[]; events: PlannerEvent[] }
export type PlannerIdentity = { id: string; key: string }
export const LEGACY_PEOPLE: PlannerPerson[] = [
  { id: 'sascha', name: 'Sascha', color: '#467ba6' },
  { id: 'katharina', name: 'Katharina', color: '#d9778f' },
  { id: 'arjen', name: 'Arjen', color: '#36a78a' },
]
export function belongsTo(event: PlannerEvent, person: string) { return event.audience ? event.audience.includes(person) : event.person === person || event.person === 'all' }
export function coversDay(event: PlannerEvent, day: string) { return event.date <= day && (event.endDate || event.date) >= day }
export function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export function fromDay(day: string) { return new Date(`${day}T12:00:00`) }
export function monthDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  const offset = (start.getDay() + 6) % 7
  const count = Math.ceil((offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7
  return Array.from({ length: count }, (_, i) => { const date = new Date(start); date.setDate(i - offset + 1); return { key: dayKey(date), date, outside: date.getMonth() !== month.getMonth() } })
}
export function dayContext(events: PlannerEvent[], groupId: string, selected: string, self: string, day: string) {
  const current = events.filter(e => e.groupId === groupId && coversDay(e, day) && (!e.wasteKind || belongsTo(e, selected)))
  return {
    selected: current.filter(e => belongsTo(e, selected)),
    others: current.filter(e => !belongsTo(e, selected)),
    external: events.filter(e => e.groupId !== groupId && belongsTo(e, self) && coversDay(e, day)),
  }
}

export const PLANNER_CATEGORIES = [
  { id: 'private', label: 'Privat', color: '#22835c', background: '#d9f3e7', ink: '#195f44' },
  { id: 'work', label: 'Arbeit', color: '#d44c68', background: '#ffe0e4', ink: '#92263c' },
  { id: 'task', label: 'Auftrag', color: '#159f78', background: '#d5f4e9', ink: '#12634c' },
  { id: 'vacation', label: 'Urlaub', color: '#d7a300', background: '#ffef9e', ink: '#685100' },
  { id: 'holidays', label: 'Ferien / Feiertage', color: '#a96ccf', background: 'linear-gradient(100deg, #ffd7e5, #ffe8a9 34%, #d9f3cc 67%, #cfe9ff)', ink: '#384960' },
  { id: 'birthday', label: 'Geburtstag', color: '#c34e9c', background: '#f7dff0', ink: '#853266' },
  { id: 'other', label: 'Sonstiges', color: '#63849c', background: '#e4edf3', ink: '#3b5c72' },
] as const
export type PlannerCategoryId = typeof PLANNER_CATEGORIES[number]['id']
export function plannerCategory(event: Pick<PlannerEvent, 'kind' | 'eventType' | 'wasteKind'>) {
  if (event.wasteKind) return PLANNER_WASTE_CATEGORIES[event.wasteKind]
  const id = event.kind === 'task' ? 'task' : event.eventType
  return PLANNER_CATEGORIES.find(category => category.id === id) || PLANNER_CATEGORIES[0]
}

export const PLANNER_WASTE_CATEGORIES = {
  rest: { id: 'waste-rest', label: 'Restabfall', color: '#62717b', background: '#e3e8eb', ink: '#3b4c56' },
  bio: { id: 'waste-bio', label: 'Bioabfall', color: '#9a7752', background: '#f1e5d4', ink: '#705135' },
  yellow: { id: 'waste-yellow', label: 'Gelbe Tonne', color: '#c6a22c', background: '#fff1a5', ink: '#72600c' },
  paper: { id: 'waste-paper', label: 'Altpapier', color: '#398bb6', background: '#d7effb', ink: '#24617f' },
} as const
export function swipeMonthOffset(dx: number, dy: number, duration: number) {
  return Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && duration >= 0 ? (dx < 0 ? 1 : -1) : 0
}

// Mehrere Personen pro Eintrag: audience = Liste von Profil-IDs (mind. 2). person bleibt die erste Person
// (bzw. 'all' für alle Mitglieder), damit ältere Abfragen und Geräte weiter funktionieren.
export function parseAudience(value: unknown): string[] | undefined {
  let list: unknown = value
  if (typeof value === 'string') { try { list = JSON.parse(value) } catch { return undefined } }
  if (!Array.isArray(list)) return undefined
  const ids = [...new Set(list.filter((id): id is string => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)))]
  return ids.length >= 2 ? ids : undefined
}
export function normalizeSelection(ids: string[], memberIds: string[], allowAll = true): { person: string; audience?: string[] } | null {
  const chosen = memberIds.filter(id => ids.includes(id))
  if (!chosen.length) return null
  if (chosen.length === 1) return { person: chosen[0] }
  if (allowAll && memberIds.length > 1 && chosen.length === memberIds.length) return { person: 'all' }
  return { person: chosen[0], audience: chosen }
}
export function selectionOf(event: Pick<PlannerEvent, 'person' | 'audience'>, memberIds: string[]): string[] {
  if (event.audience?.length) return event.audience.filter(id => memberIds.includes(id))
  if (event.person === 'all') return [...memberIds]
  return memberIds.includes(event.person) ? [event.person] : []
}
export function selectionLabel(ids: string[], members: PlannerPerson[], subgroups: PlannerSubgroup[] = []): string {
  if (!ids.length) return 'Niemand'
  if (members.length > 1 && members.every(m => ids.includes(m.id))) return 'Alle Mitglieder'
  const exact = subgroups.find(g => g.members.length === ids.length && g.members.every(id => ids.includes(id)))
  if (exact) return exact.name
  const names = members.filter(m => ids.includes(m.id)).map(m => m.name)
  return names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}
export function offeredTo(item: { audience?: string[] }, person: string) { return !item.audience?.length || item.audience.includes(person) }

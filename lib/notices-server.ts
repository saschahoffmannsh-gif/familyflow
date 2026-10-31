import { getDb } from '@/db'
import { ChatError } from './discussion-server'
import type { PlannerPerson } from './planner'
import type { Notice, NoticeData } from './notices'

type Snapshot = { entry: { title: string; kind: 'event' | 'task'; date?: string; time?: string }; groupId: string; people: string[] }
type Row = { id: string; actor_id: string; source_kind: 'event' | 'todo'; source_id: string; group_id: string; title: string; entry_kind: 'event' | 'task'; date: string | null; time: string | null; created_at: string; actor: string | null; color: string | null }

/** Legt für Personen, die neu für einen Eintrag zuständig sind, eine Mitteilung an (nicht für die eintragende Person). */
export async function recordNotices(kind: 'event' | 'todo', id: string, actor: PlannerPerson, next: Snapshot, previous?: Snapshot) {
  const before = new Set(previous?.people || [])
  const people = next.people.filter(person => person !== actor.id && !before.has(person))
  if (!people.length) return
  const db = getDb(), now = new Date().toISOString()
  await db.batch(people.map(person => db.prepare('INSERT INTO planner_notices (id,profile_id,actor_id,source_kind,source_id,group_id,title,entry_kind,date,time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), person, actor.id, kind, id, next.groupId, next.entry.title, next.entry.kind, next.entry.date || null, next.entry.time || null, now)))
}

async function stillMine(row: Row, profileId: string, snapshot: (ref: { kind: 'event' | 'todo'; id: string }) => Promise<Snapshot>) {
  try { const s = await snapshot({ kind: row.source_kind, id: row.source_id }); return s.people.includes(profileId) ? s : null }
  catch (e) { if (e instanceof ChatError && e.status === 404) return null; throw e }
}

export async function noticesFor(profile: PlannerPerson, countOnly = false): Promise<NoticeData> {
  const { entrySnapshot } = await import('./inbox-server')
  const db = getDb()
  const seen = (await db.prepare('SELECT seen_at FROM planner_notice_seen WHERE profile_id=?').bind(profile.id).first<{ seen_at: string }>())?.seen_at || ''
  const since = new Date(Date.now() - 60 * 864e5).toISOString()
  const rows = (await db.prepare(`SELECT n.*, p.name AS actor, p.color FROM planner_notices n LEFT JOIN planner_profiles p ON p.id=n.actor_id
    WHERE n.profile_id=? AND n.actor_id<>? AND n.created_at>? ${countOnly ? 'AND n.created_at>?' : ''} ORDER BY n.created_at DESC LIMIT 60`)
    .bind(profile.id, profile.id, since, ...(countOnly ? [seen] : [])).all<Row>()).results
  const items: Notice[] = [], done = new Set<string>()
  for (const row of rows) {
    const key = `${row.source_kind}:${row.source_id}`
    if (done.has(key)) continue
    done.add(key)
    const current = await stillMine(row, profile.id, entrySnapshot)
    if (!current) continue
    const entry = current.entry
    items.push({ id: row.id, sourceKind: row.source_kind, sourceId: row.source_id, groupId: current.groupId, title: entry.title, entryKind: entry.kind, ...(entry.date ? { date: entry.date } : {}), ...(entry.time ? { time: entry.time } : {}), actor: row.actor || 'Jemand', actorColor: row.color || '#7446c5', createdAt: row.created_at, unread: row.created_at > seen })
  }
  return { items: countOnly ? [] : items, unread: items.filter(item => item.unread).length }
}

export async function markNoticesSeen(profile: PlannerPerson) {
  await getDb().prepare('INSERT INTO planner_notice_seen (profile_id,seen_at) VALUES (?,?) ON CONFLICT(profile_id) DO UPDATE SET seen_at=excluded.seen_at').bind(profile.id, new Date().toISOString()).run()
}

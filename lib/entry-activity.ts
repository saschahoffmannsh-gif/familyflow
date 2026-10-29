import { getDb } from '@/db'
import type { EntryActivity } from './discussions'

type Target = { id: string; sharedThreadId?: string; wasteKind?: unknown }
type ActivityRow = EntryActivity & { id: string; source_kind: string; source_id: string }

// The caller supplies only entries already filtered by its access rules.
export async function withEntryActivity<T extends Target>(entries: T[], kind: 'event' | 'todo' = 'event'): Promise<(T & { activity?: EntryActivity })[]> {
  const ids = [...new Set(entries.filter(entry => !entry.wasteKind).flatMap(entry => entry.sharedThreadId ? [entry.sharedThreadId] : [entry.id, ...(kind === 'event' && entry.id.startsWith('todo-') ? [entry.id.slice(5)] : [])]))]
  if (!ids.length) return entries
  const bySource = new Map<string, EntryActivity>(), byThread = new Map<string, EntryActivity>()
  for (let offset = 0; offset < ids.length; offset += 40) {
    const batch = ids.slice(offset, offset + 40), placeholders = batch.map(() => '?').join(',')
    const rows = await getDb().prepare(`
      SELECT t.id, t.source_kind, t.source_id,
        SUM(CASE WHEN LENGTH(TRIM(m.body)) > 0 THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN a.mime LIKE 'image/%' THEN 1 ELSE 0 END) AS images,
        SUM(CASE WHEN a.mime LIKE 'audio/%' THEN 1 ELSE 0 END) AS audio
      FROM entry_threads t JOIN entry_messages m ON m.thread_id = t.id
      LEFT JOIN entry_attachments a ON a.id = m.attachment_id
      WHERE t.source_id IN (${placeholders}) OR t.id IN (${placeholders})
      GROUP BY t.id, t.source_kind, t.source_id
    `).bind(...batch, ...batch).all<ActivityRow>()
    for (const row of rows.results) {
      const activity = { messages: row.messages, images: row.images, audio: row.audio }
      bySource.set(`${row.source_kind}:${row.source_id}`, activity)
      byThread.set(row.id, activity)
    }
  }
  return entries.map(entry => {
    const activity = entry.wasteKind ? undefined : entry.sharedThreadId ? byThread.get(entry.sharedThreadId)
      : bySource.get(`${kind}:${entry.id}`) || (kind === 'event' && entry.id.startsWith('todo-') ? bySource.get(`todo:${entry.id.slice(5)}`) : undefined)
    return activity ? { ...entry, activity } : entry
  })
}

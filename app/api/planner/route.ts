import { entrySnapshot, recordEntryChange } from '@/lib/inbox-server'
import { importedEntries } from '@/lib/discussion-server'
import { withEntryActivity } from '@/lib/entry-activity'
import { getDb } from '@/db'
import { WASTE_PICKUPS, WASTE_CALENDAR_SOURCE, type WasteKind } from '@/lib/waste-calendar'
import { isValidProfileChangeCode } from '@/lib/family-access'
import { PLANNER_CATEGORIES, LEGACY_PEOPLE, parseAudience, type PlannerData, type PlannerEvent, type PlannerGroup, type PlannerPerson } from '@/lib/planner'
import { PUT as saveFamilyEvent, DELETE as deleteFamilyEvent } from '@/app/api/calendar/route'

export const dynamic = 'force-dynamic'
type GroupRow = { id: string; name: string; category: string; color: string; invite_code: string }
type EventRow = { id: string; group_id: string; title: string; date: string; end_date: string | null; time: string | null; note: string | null; person: string; event_type: string; revision: number; waste_kind?: WasteKind | null; completed?: number; audience?: string | null }
const PARENTS = ['sascha', 'katharina']
const WASTE_KINDS = new Set(['rest', 'bio', 'yellow', 'paper'])
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
class ApiError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
const uid = () => crypto.randomUUID()
const secret = () => uid().replaceAll('-', '') + uid().replaceAll('-', '')
function allowed(request: Request) { const origin = request.headers.get('origin'); return request.headers.get('sec-fetch-site') !== 'cross-site' && (!origin || origin === new URL(request.url).origin) }
function text(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
async function identify(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '')
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError('Bitte wähle dein Profil.', 401)
  const profile = await getDb().prepare('SELECT id, name, color FROM planner_profiles WHERE access_key = ?').bind(token).first<PlannerPerson>()
  if (!profile) throw new ApiError('Bitte melde dein Profil erneut an.', 401)
  return profile
}
async function membership(groupId: string, profileId: string) {
  if (!await getDb().prepare('SELECT group_id FROM planner_members WHERE group_id = ? AND profile_id = ?').bind(groupId, profileId).first()) throw new ApiError('Diese Gruppe gehört nicht zu deinem Profil.', 403)
}
function eventFrom(row: EventRow): PlannerEvent {
  return { kind: row.event_type === 'task' ? 'task' : 'event', id: row.id, groupId: row.group_id, title: row.title, date: row.date, person: row.person, eventType: row.event_type, revision: row.revision, completed: !!row.completed, ...(row.waste_kind ? { wasteKind: row.waste_kind, ...(row.group_id === 'family' && row.person === 'parents' ? { audience: PARENTS } : {}) } : {}), ...(!row.waste_kind && parseAudience(row.audience) ? { audience: parseAudience(row.audience) } : {}), ...(row.end_date ? { endDate: row.end_date } : {}), ...(row.time ? { time: row.time } : {}), ...(row.note ? { note: row.note } : {}) }
}
async function bundle(profile: PlannerPerson): Promise<PlannerData> {
  const db = getDb()
  const result = await db.prepare('SELECT g.* FROM planner_groups g JOIN planner_members m ON m.group_id = g.id WHERE m.profile_id = ? ORDER BY CASE WHEN g.id = \'family\' THEN 0 ELSE 1 END, g.name').bind(profile.id).all<GroupRow>()
  const groups: PlannerGroup[] = await Promise.all(result.results.map(async group => {
    const members = await db.prepare('SELECT p.id, p.name, p.color FROM planner_profiles p JOIN planner_members m ON m.profile_id = p.id WHERE m.group_id = ? ORDER BY p.name').bind(group.id).all<PlannerPerson>()
    const subs = await db.prepare('SELECT s.id, s.name, sm.profile_id FROM planner_subgroups s LEFT JOIN planner_subgroup_members sm ON sm.subgroup_id = s.id LEFT JOIN planner_members m ON m.group_id = s.group_id AND m.profile_id = sm.profile_id WHERE s.group_id = ? AND (sm.profile_id IS NULL OR m.profile_id IS NOT NULL) ORDER BY s.name, s.id').bind(group.id).all<{ id: string; name: string; profile_id: string | null }>()
    const subgroups: NonNullable<PlannerGroup['subgroups']> = []
    for (const row of subs.results) { let sub = subgroups.find(s => s.id === row.id); if (!sub) subgroups.push(sub = { id: row.id, name: row.name, members: [] }); if (row.profile_id) sub.members.push(row.profile_id) }
    return { id: group.id, name: group.name, category: group.category, color: group.color, inviteCode: group.invite_code, members: members.results, subgroups }
  }))
  const rows = await db.prepare('SELECT e.* FROM planner_events e JOIN planner_members m ON m.group_id = e.group_id WHERE m.profile_id = ? ORDER BY e.date, e.time').bind(profile.id).all<EventRow>()
  const events = rows.results.filter(row => !row.waste_kind || row.group_id !== 'family' || PARENTS.includes(profile.id)).map(eventFrom)
  if (groups.some(g => g.id === 'family')) {
    const legacy = await db.prepare('SELECT * FROM calendar_items ORDER BY date, time').all<{ id: string; title: string; date: string; end_date: string | null; time: string | null; note: string | null; person: string | null; assignee: string | null; event_type: string | null; revision: number; kind: 'event' | 'task'; completed: number }>()
    events.push(...legacy.results.map(row => ({ ...eventFrom({ ...row, group_id: 'family', person: row.kind === 'task' ? row.assignee || 'sascha' : row.person || 'all', event_type: row.event_type || 'private' }), kind: row.kind, completed: !!row.completed })))
    if (PARENTS.includes(profile.id)) {
      const statuses = await db.prepare('SELECT pickup_id, completed FROM waste_pickup_status').all<{ pickup_id: string; completed: number }>()
      const completed = new Set(statuses.results.filter(row => row.completed).map(row => row.pickup_id))
      events.push(...WASTE_PICKUPS.map(pickup => ({ id: pickup.id, groupId: 'family', title: pickup.title, date: pickup.date, person: 'parents', audience: PARENTS, eventType: 'other', kind: 'event' as const, wasteKind: pickup.kind, revision: 1, readonly: true, completed: completed.has(pickup.id), note: WASTE_CALENDAR_SOURCE.area })))
    }
  }
  events.push(...await importedEntries(profile.id))
  return { profile, groups, events: await withEntryActivity(events) }
}
async function bootstrapLegacy() {
  const db = getDb()
  await db.batch([
    ...LEGACY_PEOPLE.map(p => db.prepare('INSERT OR IGNORE INTO planner_profiles (id, name, color, access_key) VALUES (?, ?, ?, ?)').bind(p.id, p.name, p.color, secret())),
    db.prepare('INSERT OR IGNORE INTO planner_groups (id, name, category, color, invite_code, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind('family', 'Familie', 'Familie', '#6b73d6', secret().slice(0, 12).toUpperCase(), 'sascha'),
    ...LEGACY_PEOPLE.map(p => db.prepare('INSERT OR IGNORE INTO planner_members (group_id, profile_id) VALUES (?, ?)').bind('family', p.id)),
  ])
}
function fail(error: unknown) { if (error instanceof ApiError) return reply({ error: error.message }, error.status); console.error('Planner API failed', error); return reply({ error: 'Der Kalender ist gerade nicht erreichbar. Bitte erneut versuchen.' }, 500) }
export async function GET(request: Request) { try { return reply(await bundle(await identify(request))) } catch (e) { return fail(e) } }
export async function POST(request: Request) {
  if (!allowed(request)) return reply({ error: 'Unzulässige Anfrage' }, 403)
  try {
    const input = await request.json() as Record<string, unknown>
    const db = getDb()
    if (input.action === 'legacy') {
      if (!isValidProfileChangeCode(typeof input.code === 'string' ? input.code : null)) throw new ApiError('Bitte gib den bisherigen Änderungscode ein, um dein Profil zu öffnen.', 401)
      const person = LEGACY_PEOPLE.find(p => p.id === input.id)
      if (!person) throw new ApiError('Unbekanntes Profil.')
      await bootstrapLegacy()
      const row = await db.prepare('SELECT access_key FROM planner_profiles WHERE id = ?').bind(person.id).first<{ access_key: string }>()
      return reply({ identity: { id: person.id, key: row!.access_key }, ...await bundle(person) })
    }
    if (input.action === 'profile') {
      const name = text(input.name, 50)
      if (!name) throw new ApiError('Bitte gib deinen Namen ein.')
      const profile = { id: uid(), name, color: '#6973d6' }
      const key = secret()
      await db.prepare('INSERT INTO planner_profiles (id, name, color, access_key) VALUES (?, ?, ?, ?)').bind(profile.id, name, profile.color, key).run()
      return reply({ identity: { id: profile.id, key }, ...await bundle(profile) })
    }
    const profile = await identify(request)
    if (input.action === 'waste-status') {
      const id = text(input.id, 120)
      if (typeof input.completed !== 'boolean') throw new ApiError('Ungültiger Status.')
      if (WASTE_PICKUPS.some(pickup => pickup.id === id)) {
        await membership('family', profile.id)
        if (!PARENTS.includes(profile.id)) throw new ApiError('Die Mülltermine sind für Sascha und Katharina.', 403)
        await db.prepare("INSERT INTO waste_pickup_status (pickup_id, completed, completed_by, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(pickup_id) DO UPDATE SET completed=excluded.completed, completed_by=excluded.completed_by, updated_at=excluded.updated_at").bind(id, input.completed ? 1 : 0, input.completed ? profile.id : null).run()
      } else {
        const row = await db.prepare('SELECT * FROM planner_events WHERE id = ?').bind(id).first<EventRow>()
        if (!row?.waste_kind) throw new ApiError('Dieser Mülltermin wurde nicht gefunden.', 404)
        await membership(row.group_id, profile.id)
        if (row.group_id === 'family' && !PARENTS.includes(profile.id)) throw new ApiError('Die Mülltermine sind für Sascha und Katharina.', 403)
        await db.prepare('UPDATE planner_events SET completed = ?, revision = revision + 1 WHERE id = ?').bind(input.completed ? 1 : 0, id).run()
      }
      return reply(await bundle(profile))
    }
    if (input.action === 'import') {
      const groupId = text(input.groupId, 100)
      await membership(groupId, profile.id)
      const waste = input.mode === 'waste'
      if (waste && groupId === 'family' && !PARENTS.includes(profile.id)) throw new ApiError('Mülltermine sind nur für Sascha und Katharina.', 403)
      const person = waste && groupId === 'family' ? 'parents' : text(input.person, 100) || profile.id
      if (person === 'parents' && !(waste && groupId === 'family')) throw new ApiError('Bitte wähle einen gültigen Kalender.')
      if (person !== 'all' && person !== 'parents') await membership(groupId, person)
      if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 2000) throw new ApiError('Bitte wähle zwischen 1 und 2.000 Termine aus.')
      const existing = (await bundle(profile)).events.filter(event => event.groupId === groupId)
      const statements: D1PreparedStatement[] = []
      let duplicates = 0
      const contentKey = (e: { title: string; date: string; time?: string; endDate?: string; wasteKind?: string; person: string }) => waste ? `${e.date}|${e.wasteKind}` : `${e.title}|${e.date}|${e.time || ''}|${e.endDate || ''}|${e.person}`
      const seen = new Set(existing.map(contentKey))
      for (const value of input.entries) {
        if (!value || typeof value !== 'object') throw new ApiError('Ungültiger Importeintrag.')
        const entry = value as Record<string, unknown>
        const title = text(entry.title, 120), date = text(entry.date, 10), endDate = text(entry.endDate, 10), time = waste ? '' : text(entry.time, 5), note = text(entry.note, 1000)
        const eventType = waste ? 'other' : text(entry.eventType, 20) || 'private'
        const wasteKind = waste ? text(entry.wasteKind, 20) : ''
        if (!title || !validDay(date) || (endDate && (!validDay(endDate) || endDate < date)) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new ApiError('Bitte prüfe Datum und Uhrzeit in der Importvorschau.')
        if (!PLANNER_CATEGORIES.some(c => c.id === eventType) || (waste && !WASTE_KINDS.has(wasteKind))) throw new ApiError('Bitte prüfe die Kategorien und Tonnenarten.')
        if (eventType === 'task' && person === 'all') throw new ApiError('Bitte wähle für Aufträge eine Person aus.')
        const fingerprint = contentKey({ title, date, time, endDate, wasteKind, person })
        if (seen.has(fingerprint)) { duplicates++; continue }
        seen.add(fingerprint)
        const sourceUid = text(entry.sourceUid, 1000) || fingerprint
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${groupId}|${person}|${waste ? 'waste' : 'event'}|${sourceUid}|${date}`))
        const sourceKey = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
        statements.push(db.prepare('INSERT OR IGNORE INTO planner_events (id, group_id, title, date, end_date, time, note, person, event_type, revision, waste_kind, source_key, completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)').bind(`import-${sourceKey}`, groupId, title, date, waste ? null : endDate || null, time || null, note || null, person, eventType, wasteKind || null, sourceKey))
      }
      let imported = 0
      for (let index = 0; index < statements.length; index += 100) {
        const results = await db.batch(statements.slice(index, index + 100))
        for (const result of results) { imported += result.meta.changes; if (!result.meta.changes) duplicates++ }
      }
      return reply({ ...await bundle(profile), importSummary: { imported, duplicates } })
    }
    if (input.action === 'create-group') {
      const name = text(input.name, 60)
      if (!name) throw new ApiError('Bitte gib einen Gruppennamen ein.')
      const id = uid(), category = text(input.category, 30) || 'Sonstiges'
      const colors: Record<string, string> = { Familie: '#6b73d6', Arbeit: '#4279aa', Team: '#279b86', Freunde: '#b77947', Sonstiges: '#8b69ad' }
      await db.batch([
        db.prepare('INSERT INTO planner_groups (id, name, category, color, invite_code, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, category, colors[category] || colors.Sonstiges, secret().slice(0, 12).toUpperCase(), profile.id),
        db.prepare('INSERT INTO planner_members (group_id, profile_id) VALUES (?, ?)').bind(id, profile.id),
      ])
      return reply({ ...await bundle(profile), selectedGroupId: id })
    }
    if (input.action === 'subgroup-save' || input.action === 'subgroup-delete') {
      const groupId = text(input.groupId, 100)
      await membership(groupId, profile.id)
      const id = text(input.id, 100)
      if (id && !/^[\w-]+$/.test(id)) throw new ApiError('Ungültige Untergruppe.')
      const existing = id ? await db.prepare('SELECT id FROM planner_subgroups WHERE id = ? AND group_id = ?').bind(id, groupId).first<{ id: string }>() : null
      if (id && !existing && input.action === 'subgroup-delete') return reply(await bundle(profile))
      if (input.action === 'subgroup-delete') {
        await db.batch([db.prepare('DELETE FROM planner_subgroup_members WHERE subgroup_id = ?').bind(id), db.prepare('DELETE FROM planner_subgroups WHERE id = ? AND group_id = ?').bind(id, groupId)])
        return reply(await bundle(profile))
      }
      const name = text(input.name, 50)
      if (!name) throw new ApiError('Bitte gib einen Namen ein.')
      const members = Array.isArray(input.members) ? [...new Set(input.members.filter((m): m is string => typeof m === 'string'))].slice(0, 200) : []
      for (const member of members) await membership(groupId, member)
      if (id && !existing) throw new ApiError('Diese Untergruppe gibt es nicht mehr.', 404)
      const subId = existing?.id || uid()
      await db.batch([
        existing ? db.prepare('UPDATE planner_subgroups SET name = ? WHERE id = ?').bind(name, subId) : db.prepare('INSERT INTO planner_subgroups (id, group_id, name, created_by) VALUES (?, ?, ?, ?)').bind(subId, groupId, name, profile.id),
        db.prepare('DELETE FROM planner_subgroup_members WHERE subgroup_id = ?').bind(subId),
        ...members.map(member => db.prepare('INSERT INTO planner_subgroup_members (subgroup_id, profile_id) VALUES (?, ?)').bind(subId, member)),
      ])
      return reply({ ...await bundle(profile), subgroupId: subId })
    }
    if (input.action === 'join') {
      const code = text(input.code, 30).toUpperCase().replace(/[\s-]/g, '')
      if (!/^[A-F0-9]{12}$/.test(code)) throw new ApiError('Bitte gib den zwölfstelligen Einladungscode ein.')
      const group = await db.prepare('SELECT id FROM planner_groups WHERE invite_code = ?').bind(code).first<{ id: string }>()
      if (!group) throw new ApiError('Dieser Einladungscode wurde nicht gefunden.', 404)
      await db.prepare('INSERT OR IGNORE INTO planner_members (group_id, profile_id) VALUES (?, ?)').bind(group.id, profile.id).run()
      return reply({ ...await bundle(profile), selectedGroupId: group.id })
    }
    throw new ApiError('Unbekannte Aktion.')
  } catch (e) { return fail(e) }
}
function validDay(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
export async function PUT(request: Request) {
  if (!allowed(request)) return reply({ error: 'Unzulässige Anfrage' }, 403)
  try {
    const profile = await identify(request)
    const input = await request.json() as Record<string, unknown>
    const groupId = text(input.groupId, 100)
    await membership(groupId, profile.id)
    const title = text(input.title, 120), date = text(input.date, 10), endDate = text(input.endDate, 10), time = text(input.time, 5), note = text(input.note, 1000)
    const audience = parseAudience(input.audience) || null
    if (Array.isArray(input.audience) && input.audience.length > 200) throw new ApiError('Zu viele Personen.')
    const person = audience ? audience[0] : text(input.person, 100)
    if (audience) for (const member of audience) await membership(groupId, member)
    const eventType = input.kind === 'task' ? 'task' : text(input.eventType, 20) || 'private'
    if (!PLANNER_CATEGORIES.some(category => category.id === eventType)) throw new ApiError('Die Art des Eintrags ist ungültig.')
    if (!title || !validDay(date) || (endDate && (!validDay(endDate) || endDate < date))) throw new ApiError('Bitte prüfe Titel und Zeitraum.')
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError('Bitte prüfe die Uhrzeit.')
    if (person !== 'all' && person !== 'parents') await membership(groupId, person)
    const id = text(input.id, 100) || uid()
    if (!/^[\w-]+$/.test(id)) throw new ApiError('Ungültiger Eintrag.')
    if (WASTE_PICKUPS.some(pickup => pickup.id === id)) throw new ApiError('Diese Müllabholung kann als rausgestellt bestätigt werden.')
    const imported = await getDb().prepare('SELECT * FROM planner_events WHERE id = ?').bind(id).first<EventRow>()
    if (audience && imported?.waste_kind) throw new ApiError('Ungültiger Kalender.')
    if (person === 'parents' && (!imported?.waste_kind || groupId !== 'family' || !PARENTS.includes(profile.id))) throw new ApiError('Ungültiger Kalender.', 403)
    if (imported?.waste_kind && groupId === 'family' && !PARENTS.includes(profile.id)) throw new ApiError('Die Mülltermine sind für Sascha und Katharina.', 403)
    if (groupId === 'family' && !imported) {
      const headers = new Headers(request.headers)
      headers.set('x-familyflow-actor', profile.id)
      const result = await saveFamilyEvent(new Request(request.url, { method: 'PUT', headers, body: JSON.stringify({ id, kind: input.kind === 'task' ? 'task' : 'event', title, date, endDate, time, note, person, assignee: person, ...(audience ? { audience } : {}), completed: input.completed, eventType: input.eventType || 'private', revision: input.revision }) }))
      if (!result.ok) return result
      return reply(request.headers.get('prefer')?.includes('return=minimal')?{saved:true}:await bundle(profile))
    }
    const db = getDb()
    const old = await db.prepare('SELECT group_id, revision FROM planner_events WHERE id = ?').bind(id).first<{ group_id: string; revision: number }>()
    if (old && old.group_id !== groupId) throw new ApiError('Dieser Eintrag gehört zu einer anderen Gruppe.', 403)
    if (old && old.revision !== input.revision) throw new ApiError('Dieser Termin wurde inzwischen geändert. Bitte neu laden.', 409)
    const previous = old && !imported?.waste_kind ? await entrySnapshot({kind:'event',id}) : undefined
    const write = await db.prepare(`INSERT INTO planner_events (id, group_id, title, date, end_date, time, note, person, event_type, revision, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date, end_date=excluded.end_date, time=excluded.time, note=excluded.note, person=excluded.person, event_type=excluded.event_type, audience=excluded.audience, revision=excluded.revision WHERE planner_events.revision=excluded.revision-1 AND planner_events.group_id=excluded.group_id`).bind(id, groupId, title, date, endDate || null, time || null, note || null, person, eventType, old ? old.revision + 1 : 1, audience ? JSON.stringify(audience) : null).run()
    if (!write.meta.changes) throw new ApiError('Der Termin wurde inzwischen geändert. Bitte neu laden.', 409)
    if (!imported?.waste_kind) await recordEntryChange({kind:'event',id},profile,previous)
    return reply(request.headers.get('prefer')?.includes('return=minimal')?{saved:true}:await bundle(profile))
  } catch (e) { return fail(e) }
}
export async function DELETE(request: Request) {
  if (!allowed(request)) return reply({ error: 'Unzulässige Anfrage' }, 403)
  try {
    const profile = await identify(request)
    const input = await request.json() as Record<string, unknown>
    const groupId = text(input.groupId, 100)
    await membership(groupId, profile.id)
    if (WASTE_PICKUPS.some(pickup => pickup.id === input.id)) throw new ApiError('Die bestehenden Müllabholungen bleiben erhalten.')
    const imported = await getDb().prepare('SELECT * FROM planner_events WHERE id = ?').bind(input.id).first<EventRow>()
    if (imported?.waste_kind && groupId === 'family' && !PARENTS.includes(profile.id)) throw new ApiError('Die Mülltermine sind für Sascha und Katharina.', 403)
    if (groupId === 'family' && !imported) {
      const result = await deleteFamilyEvent(new Request(request.url, { method: 'DELETE', headers: request.headers, body: JSON.stringify({ id: input.id, revision: input.revision }) }))
      if (!result.ok) return result
    } else {
      const db = getDb()
      const old = await db.prepare('SELECT revision FROM planner_events WHERE id = ? AND group_id = ?').bind(input.id, groupId).first<{ revision: number }>()
      if (old && old.revision !== input.revision) throw new ApiError('Dieser Termin wurde inzwischen geändert. Bitte neu laden.', 409)
      if (old) { const previous = !imported?.waste_kind ? await entrySnapshot({kind:'event',id:String(input.id)}) : undefined; const deleted = await db.prepare('DELETE FROM planner_events WHERE id = ? AND group_id = ? AND revision = ?').bind(input.id, groupId, old.revision).run(); if (!deleted.meta.changes) throw new ApiError('Dieser Termin wurde inzwischen geändert. Bitte neu laden.', 409); if (previous) await recordEntryChange({kind:'event',id:String(input.id)},profile,previous,true) }
    }
    return reply(await bundle(profile))
  } catch (e) { return fail(e) }
}

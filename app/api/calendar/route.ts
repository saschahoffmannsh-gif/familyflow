import { entrySnapshot, recordEntryChange } from "@/lib/inbox-server"
import { chatIdentity } from "@/lib/discussion-server"
import { familyApiAccess } from "@/lib/family-api-access"
import { getDb } from "@/db"
import type { CalendarItem, EventType, PersonId } from "@/lib/familyflow-storage"
import { notifyPeople } from "@/lib/push-server"

export const dynamic = "force-dynamic"

type CalendarRow = {
  id: string
  kind: "event" | "task"
  title: string
  date: string
  end_date: string | null
  event_type: EventType | null
  time: string | null
  note: string | null
  person: PersonId | "all" | null
  assignee: PersonId | null
  completed: number
  revision: number
  updated_at: string
}

type AssignmentRow = Pick<CalendarRow, "kind" | "person" | "assignee">

const PEOPLE = new Set<PersonId>(["sascha", "katharina", "arjen"])
const EVENT_TYPES = new Set<EventType>(["private", "work", "vacation", "holidays", "birthday", "other"])
const UNASSIGNED_EVENT_TYPES = new Set<EventType>(["holidays", "birthday", "other"])

class ValidationError extends Error {}
class ConflictError extends Error {
  constructor(readonly current: CalendarItem) {
    super("Der Eintrag wurde inzwischen auf einem anderen Gerät geändert.")
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error"
  return message.includes("no such table")
    ? "Die FamilyFlow-Cloud wird gerade eingerichtet. Bitte gleich noch einmal versuchen."
    : "Die FamilyFlow-Cloud ist gerade nicht erreichbar."
}

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function allowWrite(request: Request) {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  return fetchSite !== "cross-site" && (!origin || origin === url.origin)
}

function deviceFromRequest(request: Request) {
  const value = request.headers.get("x-familyflow-device")
  return value && /^[a-zA-Z0-9-]{20,80}$/.test(value) ? value : null
}

function fromRow(row: CalendarRow): CalendarItem {
  const eventType = row.event_type ?? "private"
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    date: row.date,
    ...(row.end_date && row.end_date !== row.date ? { endDate: row.end_date } : {}),
    ...(row.time ? { time: row.time } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.kind === "event"
      ? { ...(!UNASSIGNED_EVENT_TYPES.has(eventType) ? { person: row.person ?? "all" } : {}), eventType }
      : { assignee: row.assignee ?? "sascha", completed: row.completed === 1 }),
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

function recipients(item: CalendarItem): PersonId[] {
  if (item.kind === "task") return item.assignee ? [item.assignee] : []
  if (UNASSIGNED_EVENT_TYPES.has(item.eventType ?? "private")) return []
  if (item.person === "all") return ["sascha", "katharina", "arjen"]
  return item.person ? [item.person] : []
}

function assignmentKey(value: CalendarItem | AssignmentRow) {
  return value.kind === "task" ? value.assignee : value.person
}

function notificationFor(item: CalendarItem) {
  const formatter = new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Berlin",
  })
  const start = formatter.format(new Date(`${item.date}T12:00:00Z`))
  const range = item.endDate ? `${start} bis ${formatter.format(new Date(`${item.endDate}T12:00:00Z`))}` : start
  const when = item.time ? `${range} um ${item.time} Uhr` : range
  return {
    title: item.kind === "task" ? "Neuer Auftrag für dich" : item.person === "all" ? "Neuer Familientermin" : "Neuer Termin für dich",
    body: `${item.title} · ${when}`,
    tag: `new-${item.id}`,
    url: "/",
  }
}

function parseItem(value: unknown, allowedPeople = PEOPLE): CalendarItem {
  if (!value || typeof value !== "object") throw new ValidationError("Ungültiger Eintrag")
  const input = value as Record<string, unknown>
  const id = typeof input.id === "string" ? input.id : ""
  const kind = input.kind
  const title = typeof input.title === "string" ? input.title.trim() : ""
  const date = typeof input.date === "string" ? input.date : ""
  const endDate = typeof input.endDate === "string" && input.endDate ? input.endDate : undefined
  const eventType = typeof input.eventType === "string" && input.eventType ? input.eventType : "private"
  const time = typeof input.time === "string" && input.time ? input.time : undefined
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : undefined
  const revision = typeof input.revision === "number" && Number.isInteger(input.revision) && input.revision > 0 ? input.revision : undefined

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError("Ungültige ID")
  if (kind !== "event" && kind !== "task") throw new ValidationError("Ungültige Art")
  if (!title || title.length > 120) throw new ValidationError("Der Titel ist ungültig")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("Das Datum ist ungültig")
  if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < date)) {
    throw new ValidationError("Das Bis-Datum darf nicht vor dem Von-Datum liegen")
  }
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ValidationError("Die Uhrzeit ist ungültig")
  if (note && note.length > 1000) throw new ValidationError("Die Notiz ist zu lang")

  if (kind === "event") {
    const person = input.person
    if (!EVENT_TYPES.has(eventType as EventType)) throw new ValidationError("Die Terminart ist ungültig")
    if (UNASSIGNED_EVENT_TYPES.has(eventType as EventType)) {
      return { id, kind, title, date, ...(endDate && endDate !== date ? { endDate } : {}), eventType: eventType as EventType, ...(time ? { time } : {}), ...(note ? { note } : {}), ...(revision ? { revision } : {}) }
    }
    if (person !== "all" && (typeof person !== "string" || !allowedPeople.has(person as PersonId))) {
      throw new ValidationError("Die Person ist ungültig")
    }
    return { id, kind, title, date, ...(endDate && endDate !== date ? { endDate } : {}), eventType: eventType as EventType, ...(time ? { time } : {}), ...(note ? { note } : {}), person: person as PersonId | "all", ...(revision ? { revision } : {}) }
  }

  const assignee = input.assignee
  if (typeof assignee !== "string" || !allowedPeople.has(assignee as PersonId)) throw new ValidationError("Die Zuständigkeit ist ungültig")
  return {
    id,
    kind,
    title,
    date,
    ...(endDate && endDate !== date ? { endDate } : {}),
    ...(time ? { time } : {}),
    ...(note ? { note } : {}),
    assignee: assignee as PersonId,
    completed: input.completed === true,
    ...(revision ? { revision } : {}),
  }
}

export async function GET(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  try {
    const result = await getDb().prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at
      FROM calendar_items
      ORDER BY date ASC, COALESCE(time, '99:99') ASC, title ASC
    `).all<CalendarRow>()

    return response({ items: result.results.map(fromRow) })
  } catch (error) {
    console.error("FamilyFlow calendar GET failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

export async function PUT(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)

  try {
    const inboxProfile = (await chatIdentity(request))!
    const actorDevice = deviceFromRequest(request)
    const db = getDb()
    const familyMembers = await db.prepare("SELECT profile_id FROM planner_members WHERE group_id = 'family'").all<{ profile_id: string }>()
    const item = parseItem(await request.json(), new Set<PersonId>([...PEOPLE, ...familyMembers.results.map(member => member.profile_id as PersonId)]))
    const previous = await db.prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at
      FROM calendar_items
      WHERE id = ?
    `).bind(item.id).first<CalendarRow>()

    if (previous && item.revision !== previous.revision) {
      throw new ConflictError(fromRow(previous))
    }

    const previousSnapshot = previous ? await entrySnapshot({kind:"event",id:item.id}) : undefined
    const nextRevision = previous ? previous.revision + 1 : 1

    const write = await db.prepare(`
      INSERT INTO calendar_items (id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        date = excluded.date,
        end_date = excluded.end_date,
        event_type = excluded.event_type,
        time = excluded.time,
        note = excluded.note,
        person = excluded.person,
        assignee = excluded.assignee,
        completed = excluded.completed,
        revision = excluded.revision,
        updated_at = excluded.updated_at
      WHERE calendar_items.revision = excluded.revision - 1
    `).bind(
      item.id,
      item.kind,
      item.title,
      item.date,
      item.endDate ?? null,
      item.kind === "event" ? item.eventType ?? "private" : null,
      item.time ?? null,
      item.note ?? null,
      item.kind === "event" ? item.person ?? null : null,
      item.kind === "task" ? item.assignee ?? null : null,
      item.completed ? 1 : 0,
      nextRevision,
    ).run()

    if (write.meta.changes === 0) {
      const current = await db.prepare(`
        SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at
        FROM calendar_items
        WHERE id = ?
      `).bind(item.id).first<CalendarRow>()
      if (current) throw new ConflictError(fromRow(current))
      throw new Error("Der Eintrag konnte nicht gespeichert werden.")
    }

    await recordEntryChange({kind:"event",id:item.id},inboxProfile,previousSnapshot)

    if (!previous || previous.kind !== item.kind || assignmentKey(previous) !== assignmentKey(item)) {
      await notifyPeople(db, recipients(item).filter((person) => person !== inboxProfile.id), notificationFor(item), actorDevice)
    }

    if (request.headers.get("prefer")?.includes("return=minimal")) return response({saved:true})

    const saved = await db.prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at
      FROM calendar_items
      WHERE id = ?
    `).bind(item.id).first<CalendarRow>()
    return response({ item: saved ? fromRow(saved) : item })
  } catch (error) {
    if (error instanceof ConflictError) {
      return response({ error: error.message, code: "version_conflict", current: error.current }, 409)
    }
    if (error instanceof ValidationError) {
      return response({ error: error.message }, 400)
    }
    console.error("FamilyFlow calendar PUT failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

export async function DELETE(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)

  try {
    const payload = await request.json() as { id?: unknown; revision?: unknown }
    if (typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.id)) {
      return response({ error: "Ungültige ID" }, 400)
    }

    const db = getDb()
    const current = await db.prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at
      FROM calendar_items WHERE id = ?
    `).bind(payload.id).first<CalendarRow>()
    if (!current) return response({ deleted: true })
    if (payload.revision !== current.revision) {
      return response({ error: "Der Eintrag wurde inzwischen auf einem anderen Gerät geändert.", code: "version_conflict", current: fromRow(current) }, 409)
    }
    const inboxProfile = (await chatIdentity(request))!
    const previousSnapshot = await entrySnapshot({kind:"event",id:payload.id})
    const deleted = await db.prepare("DELETE FROM calendar_items WHERE id = ? AND revision = ?").bind(payload.id, current.revision).run()
    if (deleted.meta.changes) await recordEntryChange({kind:"event",id:payload.id},inboxProfile,previousSnapshot,true)
    return response({ deleted: true })
  } catch (error) {
    console.error("FamilyFlow calendar DELETE failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

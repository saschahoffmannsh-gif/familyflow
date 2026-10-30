import { entrySnapshot, recordEntryChange } from "@/lib/inbox-server"
import { chatIdentity } from "@/lib/discussion-server"
import { familyApiAccess } from "@/lib/family-api-access"
import { withEntryActivity } from '@/lib/entry-activity'
import { isCalendarDate } from "@/lib/discussions"
import { getDb } from "@/db"
import type { CalendarItem, PersonId, TodoItem } from "@/lib/familyflow-storage"
import { notifyPeople } from "@/lib/push-server"

export const dynamic = "force-dynamic"

type TodoRow = {
  id: string
  kind: "event" | "task"
  title: string
  date: string | null
  note: string | null
  created_by: PersonId
  created_at: string
  audience?: string | null
}

const PEOPLE = new Set<PersonId>(["sascha", "katharina", "arjen"])

class ValidationError extends Error {}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function allowWrite(request: Request) {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  return fetchSite !== "cross-site" && (!origin || origin === url.origin)
}

function fromRow(row: TodoRow): TodoItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    ...(row.date ? { date: row.date } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...(todoAudience(row.audience) ? { audience: todoAudience(row.audience) } : {}),
  }
}

// Offene Aufträge können einzelnen Personen oder Untergruppen angeboten werden (NULL = ganze Familie).
function todoAudience(value: unknown): PersonId[] | undefined {
  let list = value
  if (typeof value === "string") { try { list = JSON.parse(value) } catch { return undefined } }
  if (!Array.isArray(list)) return undefined
  const ids = [...new Set(list.filter((id): id is PersonId => typeof id === "string" && PEOPLE.has(id as PersonId)))]
  return ids.length && ids.length < PEOPLE.size ? ids : undefined
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error"
  return message.includes("no such table")
    ? "Die gemeinsame To-do-Liste wird gerade eingerichtet. Bitte gleich noch einmal versuchen."
    : "Die gemeinsame To-do-Liste ist gerade nicht erreichbar."
}

function parseTodo(value: unknown): TodoItem {
  if (!value || typeof value !== "object") throw new ValidationError("Ungültiger Eintrag")
  const input = value as Record<string, unknown>
  const id = typeof input.id === "string" ? input.id : ""
  const kind = input.kind
  const title = typeof input.title === "string" ? input.title.trim() : ""
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : undefined
  const date = input.date == null || input.date === "" ? undefined : input.date
  if (date !== undefined && !isCalendarDate(date)) throw new ValidationError("Bitte wähle ein gültiges Datum")
  const createdBy = input.createdBy

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError("Ungültige ID")
  if (kind !== "event" && kind !== "task") throw new ValidationError("Ungültige Art")
  if (!title || title.length > 120) throw new ValidationError("Der Titel ist ungültig")
  if (note && note.length > 1000) throw new ValidationError("Die Notiz ist zu lang")
  if (typeof createdBy !== "string" || !PEOPLE.has(createdBy as PersonId)) throw new ValidationError("Die Person ist ungültig")

  if (Array.isArray(input.audience) && input.audience.some((person) => typeof person !== "string" || !PEOPLE.has(person as PersonId))) throw new ValidationError("Die Person ist ungültig")
  const audience = todoAudience(input.audience)
  return { id, kind, title, ...(date ? { date: date as string } : {}), ...(note ? { note } : {}), createdBy: createdBy as PersonId, ...(audience ? { audience } : {}) }
}

export async function GET(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  try {
    const result = await getDb().prepare(`
      SELECT id, kind, title, date, note, created_by, created_at, audience
      FROM todo_items
      ORDER BY created_at DESC, title ASC
    `).all<TodoRow>()
    return response({ items: await withEntryActivity(result.results.map(fromRow), 'todo') })
  } catch (error) {
    console.error("FamilyFlow todo GET failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

export async function PUT(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)
  try {
    const item = parseTodo(await request.json())
    await getDb().prepare(`
      INSERT INTO todo_items (id, kind, title, date, note, created_by, created_at, audience)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
    `).bind(item.id, item.kind, item.title, item.date ?? null, item.note ?? null, item.createdBy, item.audience ? JSON.stringify(item.audience) : null).run()

    const saved = await getDb().prepare(`
      SELECT id, kind, title, date, note, created_by, created_at, audience
      FROM todo_items WHERE id = ?
    `).bind(item.id).first<TodoRow>()
    const actor = (await chatIdentity(request))!
    await recordEntryChange({kind:"todo",id:item.id},actor)
    if (item.audience) await notifyPeople(getDb(), item.audience.filter((person) => person !== actor.id), { title: item.kind === "task" ? "Offener Auftrag für dich" : "Offener Termin für dich", body: `${item.title} · Kannst du übernehmen?`, tag: `todo-${item.id}`, url: "/" }, request.headers.get("x-familyflow-device"))
    return response({ item: saved ? fromRow(saved) : item })
  } catch (error) {
    if (error instanceof ValidationError) return response({ error: error.message }, 400)
    console.error("FamilyFlow todo PUT failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

export async function POST(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)
  try {
    const input = await request.json() as { id?: unknown; person?: unknown; date?: unknown; completed?: unknown }
    const id = typeof input.id === "string" ? input.id : ""
    const person = input.person
    const completed = input.completed === true
    let date = typeof input.date === "string" ? input.date : ""
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError("Ungültige ID")
    if (typeof person !== "string" || !PEOPLE.has(person as PersonId)) throw new ValidationError("Die Person ist ungültig")

    const db = getDb()
    const row = await db.prepare(`
      SELECT id, kind, title, date, note, created_by, created_at, audience
      FROM todo_items WHERE id = ?
    `).bind(id).first<TodoRow>()
    if (!row) return response({ error: "Dieser Eintrag wurde bereits übernommen." }, 409)
    const offered = todoAudience(row.audience)
    if (!completed && offered && !offered.includes(person as PersonId)) throw new ValidationError("Dieser Auftrag ist für andere Personen gedacht.")

    date = row.date || date
    if (!completed && !isCalendarDate(date)) throw new ValidationError("Bitte wähle einen gültigen Tag")

    const inboxProfile = (await chatIdentity(request))!
    const previousSnapshot = await entrySnapshot({kind:"todo",id})
    if (completed) {
      await db.prepare("DELETE FROM todo_items WHERE id = ?").bind(id).run()
      await recordEntryChange({kind:"todo",id},inboxProfile,previousSnapshot,true)
      return response({ removedId: id })
    }

    const calendarId = `todo-${id}`
    const calendarItem: CalendarItem = row.kind === "task"
      ? { id: calendarId, kind: "task", title: row.title, date, ...(row.note ? { note: row.note } : {}), assignee: person as PersonId, completed: false }
      : { id: calendarId, kind: "event", title: row.title, date, ...(row.note ? { note: row.note } : {}), eventType: "private", person: person as PersonId }

    await db.batch([
      db.prepare(`
        INSERT OR IGNORE INTO calendar_items (id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).bind(
        calendarItem.id,
        calendarItem.kind,
        calendarItem.title,
        calendarItem.date,
        calendarItem.kind === "event" ? "private" : null,
        calendarItem.note ?? null,
        calendarItem.kind === "event" ? calendarItem.person ?? null : null,
        calendarItem.kind === "task" ? calendarItem.assignee ?? null : null,
      ),
      db.prepare("DELETE FROM todo_items WHERE id = ?").bind(id),
    ])

    await recordEntryChange({kind:"todo",id},inboxProfile,previousSnapshot)
    return response({ removedId: id, calendarItem })
  } catch (error) {
    if (error instanceof ValidationError) return response({ error: error.message }, 400)
    console.error("FamilyFlow todo POST failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

export async function DELETE(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)
  try {
    const input = await request.json() as { id?: unknown }
    if (typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)) {
      return response({ error: "Ungültige ID" }, 400)
    }
    const current = await getDb().prepare("SELECT id FROM todo_items WHERE id=?").bind(input.id).first()
    if (!current) return response({deleted:true})
    const inboxProfile = (await chatIdentity(request))!
    const previousSnapshot = await entrySnapshot({kind:"todo",id:input.id})
    await getDb().prepare("DELETE FROM todo_items WHERE id = ?").bind(input.id).run()
    await recordEntryChange({kind:"todo",id:input.id},inboxProfile,previousSnapshot,true)
    return response({ deleted: true })
  } catch (error) {
    console.error("FamilyFlow todo DELETE failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

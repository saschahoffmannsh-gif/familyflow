import { familyApiAccess } from "@/lib/family-api-access"
import { getDb } from "@/db"
import type { PersonId, WasteCompletion } from "@/lib/familyflow-storage"
import { WASTE_PICKUPS } from "@/lib/waste-calendar"

export const dynamic = "force-dynamic"

type WasteStatusRow = {
  pickup_id: string
  completed: number
  completed_by: PersonId | null
  updated_at: string
}

const PEOPLE = new Set<PersonId>(["sascha", "katharina", "arjen"])
const PICKUP_IDS = new Set(WASTE_PICKUPS.map((pickup) => pickup.id))

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function allowWrite(request: Request) {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  return fetchSite !== "cross-site" && (!origin || origin === url.origin)
}

function actorFromRequest(request: Request): PersonId | null {
  const actor = request.headers.get("x-familyflow-actor")
  return actor && PEOPLE.has(actor as PersonId) ? actor as PersonId : null
}

function fromRow(row: WasteStatusRow): WasteCompletion {
  return {
    pickupId: row.pickup_id,
    completed: row.completed === 1,
    ...(row.completed_by ? { completedBy: row.completed_by } : {}),
    updatedAt: row.updated_at,
  }
}

export async function GET(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied

  try {
    const result = await getDb().prepare(`
      SELECT pickup_id, completed, completed_by, updated_at
      FROM waste_pickup_status
      ORDER BY pickup_id
    `).all<WasteStatusRow>()
    return response({ completions: result.results.map(fromRow) })
  } catch (error) {
    console.error("Waste status GET failed", error)
    return response({ error: "Der Müllkalender konnte nicht synchronisiert werden." }, 500)
  }
}

export async function PUT(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)

  try {
    const actor = actorFromRequest(request)
    if (!actor) return response({ error: "Bitte zuerst ein Familienprofil auswählen." }, 400)

    const value = await request.json() as { pickupId?: unknown; completed?: unknown }
    if (typeof value.pickupId !== "string" || !PICKUP_IDS.has(value.pickupId)) {
      return response({ error: "Unbekannter Mülltermin" }, 400)
    }
    if (typeof value.completed !== "boolean") {
      return response({ error: "Ungültiger Status" }, 400)
    }

    const db = getDb()
    await db.prepare(`
      INSERT INTO waste_pickup_status (pickup_id, completed, completed_by, updated_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(pickup_id) DO UPDATE SET
        completed = excluded.completed,
        completed_by = excluded.completed_by,
        updated_at = excluded.updated_at
    `).bind(value.pickupId, value.completed ? 1 : 0, value.completed ? actor : null).run()

    const saved = await db.prepare(`
      SELECT pickup_id, completed, completed_by, updated_at
      FROM waste_pickup_status
      WHERE pickup_id = ?
    `).bind(value.pickupId).first<WasteStatusRow>()

    if (!saved) throw new Error("Waste status was not saved")
    return response({ completion: fromRow(saved) })
  } catch (error) {
    console.error("Waste status PUT failed", error)
    return response({ error: "Der Status konnte nicht für alle Geräte gespeichert werden." }, 500)
  }
}

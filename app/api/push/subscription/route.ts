import { getDb } from "@/db"
import type { PersonId } from "@/lib/familyflow-storage"

export const dynamic = "force-dynamic"

const PEOPLE = new Set<PersonId>(["sascha", "katharina", "arjen"])

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function allowWrite(request: Request) {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  return fetchSite !== "cross-site" && (!origin || origin === url.origin)
}

function parseSubscription(value: unknown) {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  const keys = input.keys as Record<string, unknown> | undefined
  if (
    typeof input.endpoint !== "string" ||
    !input.endpoint.startsWith("https://") ||
    input.endpoint.length > 2048 ||
    !keys ||
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string" ||
    keys.p256dh.length > 256 ||
    keys.auth.length > 256
  ) return null
  return { endpoint: input.endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

export async function POST(request: Request) {
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)
  try {
    const input = await request.json() as { person?: unknown; deviceId?: unknown; subscription?: unknown; previousEndpoint?: unknown }
    if (typeof input.person !== "string" || !PEOPLE.has(input.person as PersonId)) {
      return response({ error: "Ungültiges Familienprofil" }, 400)
    }
    const subscription = parseSubscription(input.subscription)
    if (!subscription) return response({ error: "Ungültige Push-Verbindung" }, 400)
    if (typeof input.deviceId !== "string" || !/^[a-zA-Z0-9-]{20,80}$/.test(input.deviceId)) {
      return response({ error: "Ungültige Gerätekennung" }, 400)
    }

    const previousEndpoint = typeof input.previousEndpoint === "string" && input.previousEndpoint.startsWith("https://")
      ? input.previousEndpoint
      : null

    const db = getDb()
    const existing = await db.prepare(
      "SELECT reminder_token FROM push_subscriptions WHERE endpoint = ?",
    ).bind(subscription.endpoint).first<{ reminder_token: string }>()
    const previous = previousEndpoint && previousEndpoint !== subscription.endpoint
      ? await db.prepare("SELECT reminder_token FROM push_subscriptions WHERE endpoint = ?")
        .bind(previousEndpoint).first<{ reminder_token: string }>()
      : null
    const reminderToken = existing?.reminder_token ?? previous?.reminder_token ?? crypto.randomUUID().replace(/-/g, "")

    if (previousEndpoint && previousEndpoint !== subscription.endpoint) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(previousEndpoint).run()
    }

    await db.prepare(`
      INSERT INTO push_subscriptions (endpoint, device_id, person, p256dh, auth, reminder_token, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(endpoint) DO UPDATE SET
        device_id = excluded.device_id,
        person = excluded.person,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        updated_at = excluded.updated_at
    `).bind(subscription.endpoint, input.deviceId, input.person, subscription.p256dh, subscription.auth, reminderToken).run()

    const reminderUrl = new URL("/api/push/daily", request.url)
    reminderUrl.searchParams.set("token", reminderToken)
    return response({ subscribed: true, reminderUrl: reminderUrl.toString() })
  } catch (error) {
    console.error("FamilyFlow push subscription failed", error)
    return response({ error: "Die Mitteilungen konnten nicht verbunden werden." }, 500)
  }
}

export async function DELETE(request: Request) {
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)
  try {
    const input = await request.json() as { endpoint?: unknown }
    if (typeof input.endpoint !== "string" || !input.endpoint.startsWith("https://")) {
      return response({ error: "Ungültige Push-Verbindung" }, 400)
    }
    await getDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(input.endpoint).run()
    return response({ deleted: true })
  } catch (error) {
    console.error("FamilyFlow push unsubscribe failed", error)
    return response({ error: "Die Mitteilungen konnten nicht deaktiviert werden." }, 500)
  }
}

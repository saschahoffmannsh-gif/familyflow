import { getDb } from "@/db"
import { sendPushToSubscription } from "@/lib/push-server"
import { wastePickupsForDate } from "@/lib/waste-calendar"
import { env } from "cloudflare:workers"

export const dynamic = "force-dynamic"

type DailySubscription = {
  endpoint: string
  person: "sascha" | "katharina" | "arjen"
  p256dh: string
  auth: string
  last_daily_sent: string | null
}

function berlinDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

async function sendDailySummary(db: D1Database, subscription: DailySubscription) {
  const date = berlinDateKey()
  if (subscription.last_daily_sent === date) return { sent: false, reason: "already-sent" }

  const counts = await db.prepare(`
    SELECT
      SUM(CASE WHEN kind = 'event' AND (person = ? OR person = 'all' OR audience LIKE ?) THEN 1 ELSE 0 END) AS events,
      SUM(CASE WHEN kind = 'task' AND (assignee = ? OR audience LIKE ?) AND completed = 0 THEN 1 ELSE 0 END) AS tasks
    FROM calendar_items
    WHERE date <= ? AND COALESCE(end_date, date) >= ?
  `).bind(subscription.person, `%"${subscription.person}"%`, subscription.person, `%"${subscription.person}"%`, date, date).first<{ events: number | null; tasks: number | null }>()
  const events = Number(counts?.events ?? 0)
  const tasks = Number(counts?.tasks ?? 0)
  const completedWaste = await db.prepare(`
    SELECT pickup_id
    FROM waste_pickup_status
    WHERE completed = 1
  `).all<{ pickup_id: string }>()
  const completedWasteIds = new Set(completedWaste.results.map((row) => row.pickup_id))
  const wastePickups = subscription.person === "arjen" ? [] : wastePickupsForDate(date).filter((pickup) => !completedWasteIds.has(pickup.id))
  const importedWaste = subscription.person === "arjen" ? [] : (await db.prepare("SELECT title FROM planner_events WHERE group_id = 'family' AND waste_kind IS NOT NULL AND date = ? AND completed = 0 AND (person = 'parents' OR person = ? OR person = 'all')").bind(date, subscription.person).all<{ title: string }>()).results
  const wasteLabels = [...wastePickups.map(pickup => pickup.shortTitle), ...importedWaste.map(pickup => pickup.title)]
  if (!events && !tasks && !wasteLabels.length) return { sent: false, reason: "empty" }

  const parts = [
    events ? countLabel(events, "Termin", "Termine") : "",
    tasks ? countLabel(tasks, "offener Auftrag", "offene Aufträge") : "",
    wasteLabels.length ? `Müll: ${wasteLabels.join(" + ")}` : "",
  ].filter(Boolean)
  const sent = await sendPushToSubscription(db, subscription, {
    title: "Done · Heute",
    body: `Heute: ${parts.join(" · ")}.`,
    tag: `daily-${date}`,
    url: "/",
  })
  if (sent) {
    await db.prepare("UPDATE push_subscriptions SET last_daily_sent = ? WHERE endpoint = ?")
      .bind(date, subscription.endpoint).run()
  }
  return { sent, reason: sent ? "sent" : "push-failed" }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return Response.json({ sent: false, error: "Ungültiger Erinnerungslink" }, { status: 400 })
  }

  try {
    const db = getDb()
    const subscription = await db.prepare(`
      SELECT endpoint, person, p256dh, auth, last_daily_sent
      FROM push_subscriptions
      WHERE reminder_token = ?
    `).bind(token).first<DailySubscription>()
    if (!subscription) return Response.json({ sent: false, error: "Erinnerungslink nicht mehr gültig" }, { status: 404 })

    return Response.json(await sendDailySummary(db, subscription), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("FamilyFlow daily reminder failed", error)
    return Response.json({ sent: false, error: "Tageserinnerung nicht erreichbar" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const expected = (env as unknown as { DAILY_PUSH_TOKEN?: string }).DAILY_PUSH_TOKEN
  const supplied = request.headers.get("authorization")
  if (!expected || supplied !== `Bearer ${expected}`) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const db = getDb()
    const subscriptions = await db.prepare(`
      SELECT endpoint, person, p256dh, auth, last_daily_sent
      FROM push_subscriptions
      ORDER BY person, endpoint
    `).all<DailySubscription>()
    const results = await Promise.all(subscriptions.results.map((subscription) => sendDailySummary(db, subscription)))
    return Response.json({ checked: results.length, sent: results.filter((result) => result.sent).length }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Daily push dispatch failed", error)
    return Response.json({ error: "Tageserinnerungen konnten nicht versendet werden" }, { status: 500 })
  }
}

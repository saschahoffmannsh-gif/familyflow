import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push"
import { env } from "cloudflare:workers"

import type { PersonId } from "@/lib/familyflow-storage"
import { VAPID_PUBLIC_KEY } from "@/lib/push-config"

type SubscriptionRow = {
  endpoint: string
  device_id?: string | null
  p256dh: string
  auth: string
}

export type FamilyFlowNotification = {
  title: string
  body: string
  tag: string
  url?: string
}

function asSubscription(row: SubscriptionRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    expirationTime: null,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }
}

export async function sendPushToSubscription(db: D1Database, row: SubscriptionRow, notification: FamilyFlowNotification) {
  if (!env.VAPID_PRIVATE_KEY) {
    console.error("FamilyFlow push skipped: VAPID_PRIVATE_KEY is missing")
    return false
  }

  try {
    const payload = await buildPushPayload({
      data: {
        ...notification,
        icon: "/branding/handoff-v1-icon-192.png",
        badge: "/branding/handoff-v1-icon-192.png",
      },
      options: { ttl: 60 * 60 },
    }, asSubscription(row), {
      subject: "https://saschahoffmannsh-gif.github.io/familyflow/",
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    })

    const result = await fetch(row.endpoint, payload)
    if (result.status === 404 || result.status === 410) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run()
    }
    if (!result.ok) {
      const detail = await result.text().catch(() => "")
      console.error("FamilyFlow push service rejected a message", result.status, detail.slice(0, 300))
    }
    return result.ok
  } catch (error) {
    console.error("FamilyFlow push failed", error)
    return false
  }
}

export async function notifyPeople(db: D1Database, people: PersonId[], notification: FamilyFlowNotification, excludeDeviceId?: string | null) {
  const uniquePeople = [...new Set(people)]
  if (!uniquePeople.length) return
  const placeholders = uniquePeople.map(() => "?").join(", ")
  const subscriptions = await db.prepare(`
    SELECT endpoint, device_id, p256dh, auth
    FROM push_subscriptions
    WHERE person IN (${placeholders})
  `).bind(...uniquePeople).all<SubscriptionRow>()

  await Promise.allSettled(subscriptions.results
    .filter((row) => !excludeDeviceId || row.device_id !== excludeDeviceId)
    .map((row) => sendPushToSubscription(db, row, notification)))
}

import { getOrCreateDeviceId, type PersonId } from "@/lib/familyflow-storage"
import { VAPID_PUBLIC_KEY } from "@/lib/push-config"

export type PushState = "checking" | "enabled" | "available" | "needs-install" | "denied" | "unsupported"

const REMINDER_URL_KEY = "familyflow:reminder-url:v1"

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true
}

function decodeApplicationKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0))
}

function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

async function registerSubscription(person: PersonId, subscription: PushSubscription, previousEndpoint?: string) {
  const response = await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person, deviceId: getOrCreateDeviceId(), subscription: subscription.toJSON(), previousEndpoint }),
  })
  const result = await response.json().catch(() => ({})) as { error?: string; reminderUrl?: string }
  if (!response.ok || !result.reminderUrl) throw new Error(result.error || "Die Mitteilungen konnten nicht verbunden werden.")
  window.localStorage.setItem(REMINDER_URL_KEY, result.reminderUrl)
  return result.reminderUrl
}

function subscriptionUsesCurrentKey(subscription: PushSubscription) {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const actual = new Uint8Array(current)
  const expected = decodeApplicationKey(VAPID_PUBLIC_KEY)
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

async function getCurrentSubscription(registration: ServiceWorkerRegistration) {
  const existing = await registration.pushManager.getSubscription()
  if (!existing || subscriptionUsesCurrentKey(existing)) return { subscription: existing }

  const previousEndpoint = existing.endpoint
  await existing.unsubscribe()
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeApplicationKey(VAPID_PUBLIC_KEY),
  })
  return { subscription, previousEndpoint }
}

export async function readPushState(): Promise<PushState> {
  if (!supported()) return "unsupported"
  if (!isStandalone()) return "needs-install"
  if (Notification.permission === "denied") return "denied"
  if (Notification.permission !== "granted") return "available"
  const registration = await navigator.serviceWorker.ready
  return await registration.pushManager.getSubscription() ? "enabled" : "available"
}

export async function enablePush(person: PersonId) {
  if (!supported()) throw new Error("Dieses Gerät unterstützt keine Web-Mitteilungen.")
  if (!isStandalone()) throw new Error("Füge „Done“ zuerst zum Home-Bildschirm hinzu und öffne die App von dort.")

  const permission = await Notification.requestPermission()
  if (permission !== "granted") throw new Error("Mitteilungen wurden nicht erlaubt. Du kannst das später in den iPhone-Einstellungen ändern.")

  const registration = await navigator.serviceWorker.ready
  const current = await getCurrentSubscription(registration)
  const subscription = current.subscription ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeApplicationKey(VAPID_PUBLIC_KEY),
  })
  return registerSubscription(person, subscription, current.previousEndpoint)
}

export async function refreshPushPerson(person: PersonId) {
  if (!supported() || Notification.permission !== "granted") return null
  const registration = await navigator.serviceWorker.ready
  const current = await getCurrentSubscription(registration)
  return current.subscription ? registerSubscription(person, current.subscription, current.previousEndpoint) : null
}

export async function disablePush() {
  if (!supported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    await fetch("/api/push/subscription", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
    await subscription.unsubscribe()
  }
  window.localStorage.removeItem(REMINDER_URL_KEY)
}

export function loadReminderUrl() {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(REMINDER_URL_KEY)
}

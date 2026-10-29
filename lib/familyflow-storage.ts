import { clientId, type EntryActivity } from "./discussions"
export type PersonId = "sascha" | "katharina" | "arjen"
export type EventType = "private" | "work" | "vacation" | "holidays" | "birthday" | "other"

export type CalendarItem = {
  id: string
  kind: "event" | "task"
  title: string
  date: string
  endDate?: string
  eventType?: EventType
  time?: string
  note?: string
  person?: PersonId | "all"
  assignee?: PersonId
  completed?: boolean
  revision?: number
  updatedAt?: string
}

export type WasteCompletion = {
  pickupId: string
  completed: boolean
  completedBy?: PersonId
  updatedAt?: string
}

export type TodoItem = {
  activity?: EntryActivity
  id: string
  kind: "event" | "task"
  title: string
  date?: string
  note?: string
  createdBy: PersonId
  createdAt?: string
}

export type ShoppingItem = {
  id: string
  label: string
  productKey: string
  addedBy: PersonId
  createdAt?: string
}

export type FamilyFlowState = {
  version: 2
  items: CalendarItem[]
  avatars: Partial<Record<PersonId, string>>
}

const LEGACY_STATE_KEY = "familyflow:state:v1"
const AVATARS_KEY = "familyflow:avatars:v1"
const DEVICE_USER_KEY = "familyflow:device-user:v1"
const DEVICE_ID_KEY = "familyflow:device-id:v1"
const LOCAL_ITEMS_KEY = "du-machst-das-jetzt:local-items:v1"
const LOCAL_WASTE_KEY = "du-machst-das-jetzt:local-waste:v1"
const LOCAL_TODO_KEY = "du-machst-das-jetzt:local-todo:v1"
const LOCAL_SHOPPING_KEY = "du-machst-das-jetzt:local-shopping:v1"

export class CloudRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly current?: CalendarItem) {
    super(message)
  }
}

export function createEmptyState(): FamilyFlowState {
  return { version: 2, items: [], avatars: {} }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionHeaders: Record<string, string> = {}
  try {
    const session = JSON.parse(window.localStorage.getItem("dmd:planner-identity:v1") || "null") as { key?: string } | null
    if (session?.key) sessionHeaders.Authorization = `Bearer ${session.key}`
  } catch { /* A missing session is handled by the server. */ }
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...sessionHeaders,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string; current?: CalendarItem }

  if (!response.ok) {
    throw new CloudRequestError(payload.error || "Die Familien-Cloud ist gerade nicht erreichbar.", payload.code, payload.current)
  }

  return payload as T
}

export const familyFlowCloudStorage = {
  async loadItems() {
    const result = await requestJson<{ items: CalendarItem[] }>("/api/calendar")
    return result.items
  },

  async saveItem(item: CalendarItem, actor?: PersonId | null) {
    const result = await requestJson<{ item: CalendarItem }>("/api/calendar", {
      method: "PUT",
      headers: {
        ...(actor ? { "X-FamilyFlow-Actor": actor } : {}),
        "X-FamilyFlow-Device": getOrCreateDeviceId(),
      },
      body: JSON.stringify(item),
    })
    return result.item
  },

  async deleteItem(item: Pick<CalendarItem, "id" | "revision">) {
    await requestJson<{ deleted: boolean }>("/api/calendar", {
      method: "DELETE",
      headers: { "X-FamilyFlow-Device": getOrCreateDeviceId() },
      body: JSON.stringify(item),
    })
  },

  async loadWasteCompletions() {
    const result = await requestJson<{ completions: WasteCompletion[] }>("/api/waste")
    return result.completions
  },

  async saveWasteCompletion(pickupId: string, completed: boolean, actor: PersonId) {
    const result = await requestJson<{ completion: WasteCompletion }>("/api/waste", {
      method: "PUT",
      headers: {
        "X-FamilyFlow-Actor": actor,
        "X-FamilyFlow-Device": getOrCreateDeviceId(),
      },
      body: JSON.stringify({ pickupId, completed }),
    })
    return result.completion
  },

  async loadTodoItems() {
    const result = await requestJson<{ items: TodoItem[] }>("/api/todo")
    return result.items
  },

  async saveTodoItem(item: TodoItem) {
    const result = await requestJson<{ item: TodoItem }>("/api/todo", {
      method: "PUT",
      body: JSON.stringify(item),
    })
    return result.item
  },

  async takeTodoItem(id: string, person: PersonId, date: string | undefined, completed: boolean) {
    return requestJson<{ removedId: string; calendarItem?: CalendarItem }>("/api/todo", {
      method: "POST",
      body: JSON.stringify({ id, person, date, completed }),
    })
  },

  async deleteTodoItem(id: string) {
    await requestJson<{ deleted: boolean }>("/api/todo", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    })
  },

  async loadShoppingItems() {
    const result = await requestJson<{ items: ShoppingItem[] }>("/api/shopping")
    return result.items
  },

  async saveShoppingItem(item: ShoppingItem) {
    const result = await requestJson<{ item: ShoppingItem }>("/api/shopping", {
      method: "PUT",
      body: JSON.stringify(item),
    })
    return result.item
  },

  async deleteShoppingItem(id: string) {
    await requestJson<{ deleted: boolean }>("/api/shopping", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    })
  },
}

// Unlinked devices use a separate, device-only calendar. These records are never
// sent to the shared family API, which still requires the private family link.
export const familyFlowLocalStorage = {
  loadItems(): CalendarItem[] {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_ITEMS_KEY) || "[]") as unknown
    return Array.isArray(value) ? value as CalendarItem[] : []
  },

  saveItem(item: CalendarItem): CalendarItem {
    const items = this.loadItems()
    const saved = { ...item, revision: (item.revision ?? 0) + 1, updatedAt: new Date().toISOString() }
    window.localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify([...items.filter((entry) => entry.id !== item.id), saved]))
    return saved
  },

  deleteItem(item: Pick<CalendarItem, "id">) {
    window.localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(this.loadItems().filter((entry) => entry.id !== item.id)))
  },

  loadWasteCompletions(): WasteCompletion[] {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_WASTE_KEY) || "[]") as unknown
    return Array.isArray(value) ? value as WasteCompletion[] : []
  },

  saveWasteCompletion(pickupId: string, completed: boolean, actor: PersonId): WasteCompletion {
    const saved: WasteCompletion = { pickupId, completed, ...(completed ? { completedBy: actor } : {}), updatedAt: new Date().toISOString() }
    const completions = this.loadWasteCompletions().filter((entry) => entry.pickupId !== pickupId)
    window.localStorage.setItem(LOCAL_WASTE_KEY, JSON.stringify([...completions, saved]))
    return saved
  },

  loadTodoItems(): TodoItem[] {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_TODO_KEY) || "[]") as unknown
    return Array.isArray(value) ? value as TodoItem[] : []
  },

  saveTodoItem(item: TodoItem): TodoItem {
    const saved = { ...item, createdAt: item.createdAt ?? new Date().toISOString() }
    const items = this.loadTodoItems().filter((entry) => entry.id !== item.id)
    window.localStorage.setItem(LOCAL_TODO_KEY, JSON.stringify([...items, saved]))
    return saved
  },

  deleteTodoItem(id: string) {
    window.localStorage.setItem(LOCAL_TODO_KEY, JSON.stringify(this.loadTodoItems().filter((entry) => entry.id !== id)))
  },

  loadShoppingItems(): ShoppingItem[] {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_SHOPPING_KEY) || "[]") as unknown
    return Array.isArray(value) ? value as ShoppingItem[] : []
  },

  saveShoppingItem(item: ShoppingItem): ShoppingItem {
    const saved = { ...item, createdAt: item.createdAt ?? new Date().toISOString() }
    const items = this.loadShoppingItems().filter((entry) => entry.id !== item.id)
    window.localStorage.setItem(LOCAL_SHOPPING_KEY, JSON.stringify([...items, saved]))
    return saved
  },

  deleteShoppingItem(id: string) {
    window.localStorage.setItem(LOCAL_SHOPPING_KEY, JSON.stringify(this.loadShoppingItems().filter((entry) => entry.id !== id)))
  },
}

export function clearLegacyCalendarData() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(LEGACY_STATE_KEY)
}

export function loadLocalAvatars(): FamilyFlowState["avatars"] {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AVATARS_KEY) || "{}") as FamilyFlowState["avatars"]
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function saveLocalAvatars(avatars: FamilyFlowState["avatars"]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(AVATARS_KEY, JSON.stringify(avatars))
}

export function loadDeviceUser(): PersonId | null {
  if (typeof window === "undefined") return null
  const value = window.localStorage.getItem(DEVICE_USER_KEY)
  return value === "sascha" || value === "katharina" || value === "arjen" ? value : null
}

export function saveDeviceUser(person: PersonId) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(DEVICE_USER_KEY, person)
}

export function getOrCreateDeviceId() {
  if (typeof window === "undefined") return "server"
  const existing = window.localStorage.getItem(DEVICE_ID_KEY)
  if (existing && /^[a-zA-Z0-9-]{20,80}$/.test(existing)) return existing
  const value = clientId()
  window.localStorage.setItem(DEVICE_ID_KEY, value)
  return value
}

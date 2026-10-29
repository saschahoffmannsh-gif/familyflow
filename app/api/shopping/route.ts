import { familyApiAccess } from "@/lib/family-api-access"
import { getDb } from "@/db"
import type { PersonId, ShoppingItem } from "@/lib/familyflow-storage"

export const dynamic = "force-dynamic"

type ShoppingRow = {
  id: string
  label: string
  product_key: string
  added_by: PersonId
  created_at: string
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

function fromRow(row: ShoppingRow): ShoppingItem {
  return { id: row.id, label: row.label, productKey: row.product_key, addedBy: row.added_by, createdAt: row.created_at }
}

function parseItem(value: unknown): ShoppingItem {
  if (!value || typeof value !== "object") throw new ValidationError("Ungültiger Artikel")
  const input = value as Record<string, unknown>
  const id = typeof input.id === "string" ? input.id : ""
  const label = typeof input.label === "string" ? input.label.trim() : ""
  const productKey = typeof input.productKey === "string" ? input.productKey : ""
  const addedBy = input.addedBy
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError("Ungültige ID")
  if (!label || label.length > 120) throw new ValidationError("Der Artikelname ist ungültig")
  if (!/^[a-z0-9_]{1,60}$/.test(productKey)) throw new ValidationError("Die Artikelart ist ungültig")
  if (typeof addedBy !== "string" || !PEOPLE.has(addedBy as PersonId)) throw new ValidationError("Die Person ist ungültig")
  return { id, label, productKey, addedBy: addedBy as PersonId }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error"
  return message.includes("no such table")
    ? "Die Einkaufsliste wird gerade eingerichtet. Bitte gleich noch einmal versuchen."
    : "Die Einkaufsliste ist gerade nicht erreichbar."
}

export async function GET(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  try {
    const result = await getDb().prepare(`
      SELECT id, label, product_key, added_by, created_at
      FROM shopping_items
      ORDER BY created_at DESC, label ASC
    `).all<ShoppingRow>()
    return response({ items: result.results.map(fromRow) })
  } catch (error) {
    console.error("FamilyFlow shopping GET failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

export async function PUT(request: Request) {
  const denied = await familyApiAccess(request)
  if (denied) return denied
  if (!allowWrite(request)) return response({ error: "Unzulässige Anfrage" }, 403)
  try {
    const item = parseItem(await request.json())
    await getDb().prepare(`
      INSERT INTO shopping_items (id, label, product_key, added_by, created_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).bind(item.id, item.label, item.productKey, item.addedBy).run()
    const saved = await getDb().prepare(`
      SELECT id, label, product_key, added_by, created_at
      FROM shopping_items WHERE id = ?
    `).bind(item.id).first<ShoppingRow>()
    return response({ item: saved ? fromRow(saved) : item })
  } catch (error) {
    if (error instanceof ValidationError) return response({ error: error.message }, 400)
    console.error("FamilyFlow shopping PUT failed", error)
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
    await getDb().prepare("DELETE FROM shopping_items WHERE id = ?").bind(input.id).run()
    return response({ deleted: true })
  } catch (error) {
    console.error("FamilyFlow shopping DELETE failed", error)
    return response({ error: errorMessage(error) }, 500)
  }
}

import { isValidProfileChangeCode } from "@/lib/family-access"

export const dynamic = "force-dynamic"

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function allowRequest(request: Request) {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  return fetchSite !== "cross-site" && (!origin || origin === url.origin)
}

export async function POST(request: Request) {
  if (!allowRequest(request)) return response({ error: "Unzulässige Anfrage" }, 403)

  try {
    const input = await request.json() as { code?: unknown }
    if (typeof input.code !== "string" || input.code.length > 100) {
      return response({ error: "Der Änderungscode ist ungültig." }, 403)
    }
    if (!isValidProfileChangeCode(input.code)) {
      return response({ error: "Der Änderungscode ist falsch." }, 403)
    }
    return response({ valid: true })
  } catch {
    return response({ error: "Der Änderungscode konnte nicht geprüft werden." }, 400)
  }
}

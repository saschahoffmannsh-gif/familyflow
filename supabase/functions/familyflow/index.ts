// FamilyFlow (Done) – Backend als Supabase Edge Function "familyflow".
// Ersetzt den Cloudflare Worker: die ursprünglichen API-Routen (app/api/**) laufen unverändert aus
// routes.bundle.js (scripts/build-function.mjs). D1 -> Postgres (Schema "familyflow", D1-Adapter),
// R2 -> Supabase Storage (privater Bucket "familyflow-media"), Secrets über Function-Secrets.
// Datenbank: public.familyflow_exec (RPC), Schema familyflow. Deploy: supabase functions deploy familyflow --project-ref <ref> --no-verify-jwt --use-api
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { D1OnPostgres, routes, rpcExecutor } from './routes.bundle.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const PUBLIC_BASE = `${SUPABASE_URL}/functions/v1/familyflow`
const MEDIA_BUCKET = 'familyflow-media'
const ALLOWED_ORIGINS = new Set((Deno.env.get('FF_ALLOWED_ORIGINS') || 'https://saschahoffmannsh-gif.github.io').split(',').map(s => s.trim()).filter(Boolean))
const isAllowedOrigin = (origin: string | null) => !!origin && (ALLOWED_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))

// Datenbankzugriff über PostgREST-RPC (HTTPS, wie bei den anderen Apps) statt einer direkten
// Postgres-Verbindung: public.familyflow_exec (supabase/rpc.sql) führt die übersetzten Anweisungen
// im Schema "familyflow" aus; ein Aufruf = eine Transaktion. Nur mit service_role-Schlüssel nutzbar.
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DB = new D1OnPostgres(rpcExecutor(async (statements: unknown[]) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/familyflow_exec`, {
      method: 'POST', signal: controller.signal,
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ statements }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(`Datenbankfehler: ${body?.message || res.status}`)
    return body
  } finally { clearTimeout(timer) }
}))

const storage = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from(MEDIA_BUCKET)
// R2-kompatibler Ausschnitt (put/get/delete), wie ihn die Chat-Anhänge verwenden.
const BUCKET = {
  async put(key: string, body: BodyInit, options?: { httpMetadata?: { contentType?: string } }) {
    const data = await new Response(body).arrayBuffer()
    const { error } = await storage.upload(key, data, { contentType: options?.httpMetadata?.contentType, upsert: true })
    if (error) throw error
  },
  async get(key: string) {
    const { data, error } = await storage.download(key)
    if (error || !data) return null
    return { body: data.stream(), size: data.size }
  },
  async delete(key: string) { await storage.remove([key]) },
}

;(globalThis as unknown as { __familyflowEnv: unknown }).__familyflowEnv = {
  DB, BUCKET,
  VAPID_PRIVATE_KEY: Deno.env.get('VAPID_PRIVATE_KEY'),
  PROFILE_CHANGE_CODE: Deno.env.get('PROFILE_CHANGE_CODE'),
  DAILY_PUSH_TOKEN: Deno.env.get('DAILY_PUSH_TOKEN'),
}

function cors(origin: string | null) {
  const h = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, prefer, x-familyflow-device, x-familyflow-actor, x-client-info, apikey, x-region',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  })
  if (isAllowedOrigin(origin)) h.set('Access-Control-Allow-Origin', origin!)
  return h
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  const index = url.pathname.indexOf('/api/')
  const apiPath = index >= 0 ? url.pathname.slice(index) : url.pathname.replace(/^.*\/familyflow/, '') || '/'
  let response: Response
  if (apiPath === '/' || apiPath === '/health') {
    const info: Record<string, unknown> = { ok: true, app: 'familyflow', region: Deno.env.get('SB_REGION') || null, }
    if (url.searchParams.has('db')) {
      const started = Date.now()
      try { const row = await DB.prepare('SELECT COUNT(*) AS n FROM calendar_items').first() as { n: number } | null; info.db = { ok: true, ms: Date.now() - started, calendarItems: row?.n } }
      catch (error) { info.ok = false; info.db = { ok: false, ms: Date.now() - started, error: String(error).slice(0, 200) } }
    }
    response = Response.json(info, { status: info.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
  } else {
    const route = routes.find(r => r.pattern.test(apiPath))
    // deno-lint-ignore no-explicit-any
    const handler = (route?.module as any)?.[req.method] as ((r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>) | undefined
    if (!route || !handler) {
      response = Response.json({ error: 'Nicht gefunden' }, { status: route ? 405 : 404 })
    } else {
      // Die Routen prüfen gleiche Herkunft (Origin == eigene URL). Die GitHub-Pages-Seite ist eine
      // erlaubte Herkunft: für sie werden Origin/Sec-Fetch-Site entfernt, fremde Herkünfte bleiben gesperrt.
      const headers = new Headers(req.headers)
      if (isAllowedOrigin(origin)) { headers.delete('origin'); headers.delete('sec-fetch-site') }
      const hasBody = !['GET', 'HEAD'].includes(req.method)
      const forwarded = new Request(`${PUBLIC_BASE}${apiPath}${url.search}`, { method: req.method, headers, ...(hasBody ? { body: req.body, duplex: 'half' } : {}) } as RequestInit)
      const match = apiPath.match(route.pattern)!
      const params = Object.fromEntries(((route as { params?: string[] }).params || []).map((name: string, i: number) => [name, decodeURIComponent(match[i + 1])]))
      try {
        response = await handler(forwarded, { params: Promise.resolve(params) })
      } catch (error) {
        console.error('FamilyFlow route failed', apiPath, error)
        response = Response.json({ error: 'Die FamilyFlow-Cloud ist gerade nicht erreichbar.' }, { status: 500 })
      }
      // Der Erinnerungslink wird relativ zur Host-Wurzel gebildet; hier auf die Function-URL umbiegen.
      if (apiPath === '/api/push/subscription' && response.ok && req.method === 'POST') {
        const body = await response.json() as { reminderUrl?: string }
        if (body.reminderUrl) body.reminderUrl = body.reminderUrl.replace(`${new URL(SUPABASE_URL).origin}/api/`, `${PUBLIC_BASE}/api/`)
        response = Response.json(body, { status: response.status, headers: response.headers })
      }
    }
  }
  const out = new Response(response.body, response)
  cors(origin).forEach((v, k) => out.headers.set(k, v))
  return out
})

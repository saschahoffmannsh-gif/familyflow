// Provider-Adapter: Aufrufe gehen direkt vom Browser zum gewählten KI-Anbieter (Schlüssel bleibt auf dem Gerät).
import { AI_RESPONSE_SCHEMA, parseAiResult, type AiResult } from './schema.ts'
import type { AiProviderId, AiSettings } from './settings.ts'

export type AiImage = { mime: string; base64: string }
type Fetch = typeof fetch
export type AiErrorKind = 'auth' | 'quota' | 'model' | 'network' | 'blocked' | 'parse' | 'server' | 'unknown'
export class AiError extends Error {
  kind: AiErrorKind
  status?: number
  constructor(kind: AiErrorKind, message: string, status?: number) { super(message); this.kind = kind; this.status = status }
}

export const AI_ERROR_TEXT: Record<AiErrorKind, string> = {
  auth: 'Der API-Schlüssel wurde abgelehnt. Bitte prüfe ihn in den Einstellungen.',
  quota: 'Das Kontingent beim Anbieter ist aufgebraucht oder es kamen zu viele Anfragen. Bitte später erneut versuchen oder Guthaben prüfen.',
  model: 'Das gewählte Modell ist nicht verfügbar. Bitte prüfe den Modellnamen.',
  network: 'Keine Verbindung zum KI-Anbieter. Bitte prüfe deine Internetverbindung.',
  blocked: 'Der Anbieter hat die Anfrage abgelehnt (Inhaltsfilter).',
  parse: 'Die Antwort der KI war nicht lesbar. Bitte erneut versuchen.',
  server: 'Der KI-Anbieter hat gerade Probleme. Bitte später erneut versuchen.',
  unknown: 'Das hat nicht geklappt. Bitte erneut versuchen.',
}

export function classifyStatus(status: number, body = ''): AiErrorKind {
  const b = body.toLowerCase()
  if (status === 401 || status === 403 || /api[_ ]?key|invalid.*key|permission|unauthori[sz]ed|authentication/.test(b) && status < 500 && status !== 429 && status !== 404) return 'auth'
  if (status === 429 || /quota|rate.?limit|insufficient|billing|credit|resource_exhausted/.test(b)) return 'quota'
  if (status === 404 || /model.*(not found|does not exist|not supported)|unknown model|invalid model/.test(b)) return 'model'
  if (status >= 500) return 'server'
  return 'unknown'
}

async function call(f: Fetch, url: string, init: RequestInit): Promise<unknown> {
  let res: Response
  try { res = await f(url, init) } catch { throw new AiError('network', AI_ERROR_TEXT.network) }
  const text = await res.text().catch(() => '')
  if (!res.ok) { const kind = classifyStatus(res.status, text); throw new AiError(kind, AI_ERROR_TEXT[kind], res.status) }
  try { return JSON.parse(text) } catch { throw new AiError('parse', AI_ERROR_TEXT.parse) }
}

type Adapter = { test: (s: AiSettings, f: Fetch) => Promise<void>; extract: (s: AiSettings, prompt: string, images: AiImage[], f: Fetch) => Promise<AiResult> }
const SCHEMA_NAME = 'done_calendar_entries'
const schemaHint = `\n\nJSON-Schema:\n${JSON.stringify(AI_RESPONSE_SCHEMA)}`

const openai: Adapter = {
  async test(s, f) { await call(f, `https://api.openai.com/v1/models/${encodeURIComponent(s.model)}`, { headers: { Authorization: `Bearer ${s.apiKey}` } }) },
  async extract(s, prompt, images, f) {
    const body = { model: s.model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(i => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.base64}`, detail: 'high' }))] }], text: { format: { type: 'json_schema', name: SCHEMA_NAME, schema: AI_RESPONSE_SCHEMA, strict: true } } }
    const json = await call(f, 'https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as { output_text?: string; output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[] }
    const parts = (json.output || []).flatMap(o => o.content || [])
    if (parts.some(p => p.type === 'refusal')) throw new AiError('blocked', AI_ERROR_TEXT.blocked)
    return parseOrThrow(json.output_text ?? parts.filter(p => p.type === 'output_text').map(p => p.text).join(''))
  },
}

const gemini: Adapter = {
  async test(s, f) { await call(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}`, { headers: { 'x-goog-api-key': s.apiKey } }) },
  async extract(s, prompt, images, f) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`
    const contents = [{ role: 'user', parts: [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mime, data: i.base64 } }))] }]
    const send = (generationConfig: Record<string, unknown>, text = prompt) => call(f, url, { method: 'POST', headers: { 'x-goog-api-key': s.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ ...contents[0], parts: [{ text }, ...contents[0].parts.slice(1)] }], generationConfig }) })
    let json: unknown
    try { json = await send({ responseMimeType: 'application/json', responseJsonSchema: AI_RESPONSE_SCHEMA }) }
    catch (e) { if (!(e instanceof AiError) || e.status !== 400 || e.kind === 'auth') throw e; json = await send({ responseMimeType: 'application/json' }, prompt + schemaHint) }
    const r = json as { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string } }
    if (r.promptFeedback?.blockReason || r.candidates?.[0]?.finishReason === 'SAFETY') throw new AiError('blocked', AI_ERROR_TEXT.blocked)
    return parseOrThrow((r.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''))
  },
}

const anthropicHeaders = (s: AiSettings) => ({ 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json' })
const anthropic: Adapter = {
  async test(s, f) { await call(f, `https://api.anthropic.com/v1/models/${encodeURIComponent(s.model)}`, { headers: anthropicHeaders(s) }) },
  async extract(s, prompt, images, f) {
    // Structured output über ein erzwungenes Tool – das Tool-Input folgt dem JSON-Schema.
    const body = { model: s.model, max_tokens: 4096, tools: [{ name: SCHEMA_NAME, description: 'Gibt die erkannten Kalendereinträge zurück.', input_schema: AI_RESPONSE_SCHEMA }], tool_choice: { type: 'tool', name: SCHEMA_NAME },
      messages: [{ role: 'user', content: [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })), { type: 'text', text: prompt }] }] }
    const json = await call(f, 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: anthropicHeaders(s), body: JSON.stringify(body) }) as { stop_reason?: string; content?: { type: string; input?: unknown; text?: string }[] }
    if (json.stop_reason === 'refusal') throw new AiError('blocked', AI_ERROR_TEXT.blocked)
    const tool = json.content?.find(c => c.type === 'tool_use')
    return parseOrThrow(tool?.input ?? (json.content || []).map(c => c.text || '').join(''))
  },
}

function parseOrThrow(v: unknown): AiResult { try { return parseAiResult(v) } catch { throw new AiError('parse', AI_ERROR_TEXT.parse) } }

export const AI_ADAPTERS: Record<AiProviderId, Adapter> = { openai, gemini, anthropic }
export function testAiKey(s: AiSettings, f: Fetch = fetch.bind(globalThis)) { return AI_ADAPTERS[s.provider].test(s, f) }
export function extractEntries(s: AiSettings, prompt: string, images: AiImage[], f: Fetch = fetch.bind(globalThis)) { return AI_ADAPTERS[s.provider].extract(s, prompt, images, f) }

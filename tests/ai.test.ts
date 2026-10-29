import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_RESPONSE_SCHEMA, AI_CATEGORY_LABELS, applyAnswer, buildAiPrompt, categoryFromLabel, draftProblem, draftToEvent, mapAiResult, parseAiResult, personFromName } from '../lib/ai/schema.ts'
import { AiError, classifyStatus, extractEntries, testAiKey } from '../lib/ai/providers.ts'
import { analyzeGray, judgeQuality } from '../lib/ai/image.ts'
import { AI_SETTINGS_KEY, clearAiSettings, loadAiSettings, saveAiSettings } from '../lib/ai/settings.ts'

const members = [{ id: 'sascha', name: 'Sascha', color: '#000' }, { id: 'katharina', name: 'Katharina', color: '#000' }, { id: 'arjen', name: 'Arjen', color: '#000' }]
const sample = {
  entries: [
    { title: 'Elternabend', date: '2026-11-12', endDate: null, time: '19:30', category: 'Privat', person: 'Arjen', confidence: { title: 0.9, date: 0.95, time: 0.9, category: 0.8, person: 0.9 }, sourceText: 'Elternabend 12.11. 19:30' },
    { title: 'Zahnarzt', date: '2026-11-20', endDate: null, time: '8:15', category: 'Sonstiges', person: null, confidence: { title: 0.9, date: 0.9, time: 0.4, category: 0.5, person: 0.1 }, sourceText: null },
    { title: 'Anmeldung abgeben', date: null, endDate: null, time: null, category: 'Auftrag', person: 'Alle', confidence: { title: 0.8, date: 0.1, time: 0, category: 0.9, person: 0.3 }, sourceText: null },
  ],
  questions: [{ entryIndex: 1, field: 'person', question: 'Für wen ist der Zahnarzttermin?', options: ['Sascha', 'Arjen'] }, { entryIndex: null, field: 'general', question: 'Welches Jahr?', options: [] }],
  imageQuality: { readable: true, issue: 'none', note: null },
}

function walk(schema: any, path = '$'): void {
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    assert.equal(schema.additionalProperties, false, `${path} additionalProperties`)
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} required`)
    for (const [k, v] of Object.entries(schema.properties)) walk(v, `${path}.${k}`)
  }
  if (schema.items) walk(schema.items, `${path}[]`)
}

test('schema is strict (OpenAI structured output) and uses exactly the app categories', () => {
  walk(AI_RESPONSE_SCHEMA)
  assert.deepEqual(AI_RESPONSE_SCHEMA.properties.entries.items.properties.category.enum, ['Privat', 'Arbeit', 'Auftrag', 'Urlaub', 'Ferien / Feiertage', 'Geburtstag', 'Sonstiges'])
})

test('prompt contains today, time zone, members and categories', () => {
  const p = buildAiPrompt({ today: '2026-10-29', timeZone: 'Europe/Berlin', members, groupName: 'Familie' })
  for (const s of ['2026-10-29', 'Europe/Berlin', '„Sascha“', '„Katharina“', '„Arjen“', 'Familie', ...AI_CATEGORY_LABELS.map(l => `„${l}“`)]) assert.ok(p.includes(s), s)
})

test('parse accepts objects, fenced JSON and drops broken items', () => {
  assert.equal(parseAiResult(sample).entries.length, 3)
  const fenced = parseAiResult('Hier:\n```json\n' + JSON.stringify({ entries: [{ title: 'X', confidence: { date: 3 } }, { date: '2026-01-01' }], questions: [{ entryIndex: 9, field: 'nonsense', question: 'Wer?' }] }) + '\n```')
  assert.equal(fenced.entries.length, 1)
  assert.equal(fenced.entries[0].confidence.date, 1)
  assert.equal(fenced.entries[0].category, 'Sonstiges')
  assert.deepEqual(fenced.questions[0], { entryIndex: null, field: 'general', question: 'Wer?', options: [] })
  assert.equal(fenced.imageQuality.readable, true)
  assert.throws(() => parseAiResult('kein json'))
})

test('category and person mapping', () => {
  assert.equal(categoryFromLabel('Ferien / Feiertage'), 'holidays')
  assert.equal(categoryFromLabel('geburtstag'), 'birthday')
  assert.equal(categoryFromLabel('Feiertage'), 'holidays')
  assert.equal(categoryFromLabel('???'), 'other')
  assert.equal(personFromName('arjen', members), 'arjen')
  assert.equal(personFromName('Katharina Hammel', members), 'katharina')
  assert.equal(personFromName('Alle', members), 'all')
  assert.equal(personFromName('Oma', members), null)
})

test('mapping to drafts and follow-up questions', () => {
  const { drafts, questions } = mapAiResult(parseAiResult(sample), members, 't')
  assert.deepEqual(drafts.map(d => [d.title, d.date, d.time, d.categoryId, d.person]), [
    ['Elternabend', '2026-11-12', '19:30', 'private', 'arjen'],
    ['Zahnarzt', '2026-11-20', '08:15', 'other', ''],
    ['Anmeldung abgeben', '', '', 'task', ''],
  ])
  const ids = questions.map(q => q.id)
  assert.ok(!ids.some(id => id.startsWith('t-0')), 'sicherer Eintrag ohne Rückfrage')
  const who = questions.find(q => q.id === 't-1-person')!
  assert.equal(who.question, 'Für wen ist der Zahnarzttermin?')
  assert.equal(who.required, true)
  assert.deepEqual(who.options.map(o => o.value), ['sascha', 'katharina', 'arjen', 'all'])
  assert.ok(ids.includes('t-1-time') && ids.includes('t-1-category'))
  assert.ok(ids.includes('t-2-person') && ids.includes('t-2-date'))
  assert.ok(!questions.find(q => q.id === 't-2-person')!.options.some(o => o.value === 'all'), 'Auftrag nicht für alle')
  assert.equal(questions.at(-1)!.field, 'general')
  assert.equal(draftProblem(drafts[0]), null)
  assert.equal(draftProblem(drafts[1]), 'Kalender fehlt')
  assert.equal(draftProblem(drafts[2]), 'Datum fehlt')
})

test('answers update drafts; drafts map to planner events', () => {
  const { drafts } = mapAiResult(parseAiResult(sample), members, 't')
  let d = applyAnswer(drafts[2], 'person', 'katharina')
  d = applyAnswer(d, 'date', '2026-11-02')
  d = applyAnswer(d, 'date', '31.12.') // ungültig -> unverändert
  assert.equal(d.date, '2026-11-02')
  assert.equal(applyAnswer(d, 'time', '7.05').time, '07:05')
  assert.equal(applyAnswer({ ...drafts[1], person: 'all' }, 'category', 'task').person, '')
  assert.equal(draftProblem(d), null)
  assert.deepEqual(draftToEvent(d, 'g1', 'id1'), { id: 'id1', groupId: 'g1', title: 'Anmeldung abgeben', date: '2026-11-02', endDate: undefined, time: undefined, note: '', person: 'katharina', kind: 'task', eventType: 'task' })
  assert.equal(draftToEvent(drafts[0], 'g1', 'id2').kind, 'event')
})

type Call = { url: string; init: RequestInit }
const mockFetch = (responses: (Response | Error)[]) => { const calls: Call[] = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); const r = responses.shift()!; if (r instanceof Error) throw r; return r }) as unknown as typeof fetch; return { f, calls } }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
const img = [{ mime: 'image/jpeg', base64: 'AAAA' }]

test('OpenAI adapter: responses API with strict json_schema and image', async () => {
  const { f, calls } = mockFetch([json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(sample) }] }] })])
  const r = await extractEntries({ provider: 'openai', model: 'm1', apiKey: 'k' }, 'P', img, f)
  assert.equal(r.entries.length, 3)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses')
  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.model, 'm1'); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true)
  assert.equal(body.input[0].content[1].image_url, 'data:image/jpeg;base64,AAAA')
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer k')
})

test('Gemini adapter: schema request, fallback without schema on 400', async () => {
  const { f, calls } = mockFetch([json({ error: { message: 'Invalid JSON payload' } }, 400), json({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(sample) + '\n```' }] } }] })])
  const r = await extractEntries({ provider: 'gemini', model: 'g1', apiKey: 'k' }, 'P', img, f)
  assert.equal(r.entries[0].title, 'Elternabend')
  assert.match(calls[0].url, /models\/g1:generateContent$/)
  assert.ok(JSON.parse(String(calls[0].init.body)).generationConfig.responseJsonSchema)
  const second = JSON.parse(String(calls[1].init.body))
  assert.equal(second.generationConfig.responseJsonSchema, undefined)
  assert.equal(second.contents[0].parts[1].inline_data.data, 'AAAA')
  assert.equal((calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'k')
})

test('Anthropic adapter: browser header and forced tool output', async () => {
  const { f, calls } = mockFetch([json({ content: [{ type: 'tool_use', name: 'done_calendar_entries', input: sample }], stop_reason: 'tool_use' })])
  const r = await extractEntries({ provider: 'anthropic', model: 'c1', apiKey: 'k' }, 'P', img, f)
  assert.equal(r.questions.length, 2)
  const h = calls[0].init.headers as Record<string, string>
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true'); assert.equal(h['x-api-key'], 'k')
  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.tool_choice.name, 'done_calendar_entries'); assert.equal(body.messages[0].content[0].source.data, 'AAAA')
})

test('errors are classified into German messages', async () => {
  assert.equal(classifyStatus(401), 'auth')
  assert.equal(classifyStatus(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'), 'auth')
  assert.equal(classifyStatus(429), 'quota')
  assert.equal(classifyStatus(400, 'insufficient_quota'), 'quota')
  assert.equal(classifyStatus(404), 'model')
  assert.equal(classifyStatus(503), 'server')
  const s = { provider: 'openai' as const, model: 'm', apiKey: 'bad' }
  await assert.rejects(testAiKey(s, mockFetch([json({ error: 'x' }, 401)]).f), (e: AiError) => e.kind === 'auth' && /Schlüssel/.test(e.message))
  await assert.rejects(extractEntries(s, 'P', img, mockFetch([new TypeError('Failed to fetch')]).f), (e: AiError) => e.kind === 'network')
  await assert.rejects(extractEntries(s, 'P', img, mockFetch([json({ output: [{ content: [{ type: 'output_text', text: 'nope' }] }] })]).f), (e: AiError) => e.kind === 'parse')
  // Gemini: falscher Schlüssel (400) wird nicht ohne Schema wiederholt
  const g = mockFetch([json({ error: { message: 'API key not valid' } }, 400)])
  await assert.rejects(extractEntries({ provider: 'gemini', model: 'g', apiKey: 'x' }, 'P', img, g.f), (e: AiError) => e.kind === 'auth')
  assert.equal(g.calls.length, 1)
})

test('image quality heuristics', () => {
  const w = 40, h = 40
  const dark = new Array(w * h).fill(20)
  assert.equal(judgeQuality(analyzeGray(dark, w, h)), 'dark')
  const flat = new Array(w * h).fill(200)
  assert.equal(judgeQuality(analyzeGray(flat, w, h)), 'blurry')
  const text = Array.from({ length: w * h }, (_, i) => ((i % w) % 4 < 2 ? 30 : 240))
  assert.equal(judgeQuality(analyzeGray(text, w, h)), 'ok')
})

test('settings stay in local storage only', () => {
  const store = new Map<string, string>()
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  assert.equal(loadAiSettings(s), null)
  saveAiSettings({ provider: 'gemini', model: '', apiKey: 'abc' }, s)
  assert.deepEqual(loadAiSettings(s), { provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'abc', consent: false })
  assert.ok(store.has(AI_SETTINGS_KEY))
  clearAiSettings(s); assert.equal(loadAiSettings(s), null)
})

test('single member: person is set without asking', () => {
  const { drafts, questions } = mapAiResult(parseAiResult(sample), members.slice(0, 1), 's')
  assert.ok(drafts.every(d => d.person === 'sascha'))
  assert.ok(!questions.some(q => q.field === 'person'))
})

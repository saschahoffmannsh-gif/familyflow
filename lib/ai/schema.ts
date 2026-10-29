// KI-Foto-Import: fest vorbereiteter Prompt, JSON-Schema (structured output), Parsing und Mapping auf App-Einträge.
import { PLANNER_CATEGORIES, type PlannerCategoryId, type PlannerEvent, type PlannerPerson } from '../planner.ts'

export const AI_CATEGORY_LABELS = PLANNER_CATEGORIES.map(c => c.label) as string[]
export const AI_QUESTION_FIELDS = ['person', 'date', 'time', 'category', 'title', 'endDate', 'general'] as const
export type AiQuestionField = typeof AI_QUESTION_FIELDS[number]
export const AI_IMAGE_ISSUES = ['none', 'dark', 'blurry', 'cut_off', 'no_dates', 'other'] as const
export type AiImageIssue = typeof AI_IMAGE_ISSUES[number]

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra })
const confidence = { type: 'number', description: '0 bis 1' }

/** JSON-Schema für die KI-Antwort. Streng (alle Felder required, keine Zusatzfelder) – kompatibel mit OpenAI strict mode. */
export const AI_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['entries', 'questions', 'imageQuality'],
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'date', 'endDate', 'time', 'category', 'person', 'confidence', 'sourceText'],
        properties: {
          title: { type: 'string', description: 'Kurzer Titel, max. 60 Zeichen, Deutsch' },
          date: nullable('string', { description: 'Startdatum YYYY-MM-DD oder null, wenn unbekannt' }),
          endDate: nullable('string', { description: 'Enddatum YYYY-MM-DD bei mehrtägigen Einträgen, sonst null' }),
          time: nullable('string', { description: 'Uhrzeit HH:MM (24h) oder null bei ganztägig/unbekannt' }),
          category: { type: 'string', enum: AI_CATEGORY_LABELS },
          person: nullable('string', { description: 'Exakt einer der Kalender-Namen, "Alle" oder null' }),
          confidence: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'date', 'time', 'category', 'person'],
            properties: { title: confidence, date: confidence, time: confidence, category: confidence, person: confidence },
          },
          sourceText: nullable('string', { description: 'Kurzer Originalausschnitt aus dem Bild' }),
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entryIndex', 'field', 'question', 'options'],
        properties: {
          entryIndex: nullable('integer'),
          field: { type: 'string', enum: [...AI_QUESTION_FIELDS] },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    imageQuality: {
      type: 'object',
      additionalProperties: false,
      required: ['readable', 'issue', 'note'],
      properties: { readable: { type: 'boolean' }, issue: { type: 'string', enum: [...AI_IMAGE_ISSUES] }, note: nullable('string') },
    },
  },
} as const

export type AiPromptContext = { today: string; timeZone: string; members: Pick<PlannerPerson, 'name'>[]; groupName: string }

export function buildAiPrompt(ctx: AiPromptContext) {
  const names = ctx.members.map(m => m.name)
  return [
    'Du bist der Foto-Import der Familien-Kalender-App „Done“. Lies die Bilder (z. B. Elternbrief, Einladung, Arztzettel, Screenshot) und extrahiere alle Termine, Fristen und Aufgaben.',
    `Heute ist ${ctx.today} (Zeitzone ${ctx.timeZone}). Gruppe: „${ctx.groupName}“.`,
    `Kalender (Personen) der Gruppe: ${names.map(n => `„${n}“`).join(', ')}. Feld "person": exakt einer dieser Namen, "Alle" wenn es alle betrifft, sonst null.`,
    `Feld "category": genau eine von ${AI_CATEGORY_LABELS.map(l => `„${l}“`).join(', ')}. „Auftrag“ = zu erledigende Aufgabe/Frist (z. B. Formular abgeben, Geld mitgeben).`,
    'Datum immer als YYYY-MM-DD. Fehlt das Jahr, nimm das nächste passende Datum ab heute und setze confidence.date niedrig. Relative Angaben („nächsten Freitag“) ab heute auflösen.',
    'Uhrzeit als HH:MM (24h) oder null. Nichts erfinden: Unbekanntes ist null mit niedriger confidence (0–1).',
    'Bei Unklarheit füge kurze deutsche Rückfragen in "questions" hinzu (z. B. „Für wen ist der Termin?“, „Welches Jahr?“, „Uhrzeit unleserlich – wann genau?“), mit entryIndex (0-basiert) und passenden options.',
    'Ist ein Bild dunkel, unscharf, abgeschnitten oder ohne Termine, melde das in "imageQuality" (readable=false, issue, note).',
    'Titel kurz und auf Deutsch. Antworte ausschließlich mit JSON nach dem Schema.',
  ].join('\n')
}

export type AiRawEntry = { title: string; date: string | null; endDate: string | null; time: string | null; category: string; person: string | null; confidence: Partial<Record<'title' | 'date' | 'time' | 'category' | 'person', number>>; sourceText: string | null }
export type AiRawQuestion = { entryIndex: number | null; field: AiQuestionField; question: string; options: string[] }
export type AiResult = { entries: AiRawEntry[]; questions: AiRawQuestion[]; imageQuality: { readable: boolean; issue: AiImageIssue; note: string | null } }

export class AiParseError extends Error {}

/** Holt JSON auch aus ```json-Blöcken oder Fließtext und validiert/normalisiert es tolerant. */
export function parseAiResult(input: unknown): AiResult {
  let value = input
  if (typeof value === 'string') {
    const text = value.trim()
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    const candidate = fenced ?? text.slice(Math.max(0, text.indexOf('{')), text.lastIndexOf('}') + 1)
    try { value = JSON.parse(candidate) } catch { throw new AiParseError('Die KI-Antwort war kein gültiges JSON.') }
  }
  if (!value || typeof value !== 'object') throw new AiParseError('Die KI-Antwort ist leer.')
  const obj = value as Record<string, unknown>
  const str = (v: unknown, max = 200) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  const conf = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5 }
  const entries: AiRawEntry[] = (Array.isArray(obj.entries) ? obj.entries : []).flatMap((e): AiRawEntry[] => {
    if (!e || typeof e !== 'object') return []
    const r = e as Record<string, unknown>, c = (r.confidence && typeof r.confidence === 'object' ? r.confidence : {}) as Record<string, unknown>
    const title = str(r.title, 120)
    if (!title) return []
    return [{ title, date: str(r.date, 10), endDate: str(r.endDate, 10), time: str(r.time, 5), category: str(r.category, 40) || 'Sonstiges', person: str(r.person, 100), sourceText: str(r.sourceText, 300),
      confidence: { title: conf(c.title), date: conf(c.date), time: conf(c.time), category: conf(c.category), person: conf(c.person) } }]
  })
  const questions: AiRawQuestion[] = (Array.isArray(obj.questions) ? obj.questions : []).flatMap((q): AiRawQuestion[] => {
    if (!q || typeof q !== 'object') return []
    const r = q as Record<string, unknown>, question = str(r.question, 200)
    if (!question) return []
    const field = (AI_QUESTION_FIELDS as readonly string[]).includes(r.field as string) ? r.field as AiQuestionField : 'general'
    const idx = typeof r.entryIndex === 'number' && Number.isInteger(r.entryIndex) && r.entryIndex >= 0 && r.entryIndex < entries.length ? r.entryIndex : null
    return [{ entryIndex: idx, field, question, options: Array.isArray(r.options) ? r.options.flatMap(o => str(o, 60) ? [str(o, 60)!] : []).slice(0, 8) : [] }]
  })
  const iq = (obj.imageQuality && typeof obj.imageQuality === 'object' ? obj.imageQuality : {}) as Record<string, unknown>
  const issue = (AI_IMAGE_ISSUES as readonly string[]).includes(iq.issue as string) ? iq.issue as AiImageIssue : 'none'
  return { entries, questions, imageQuality: { readable: iq.readable !== false, issue, note: str(iq.note, 200) } }
}

// ---------- Mapping auf App-Einträge ----------
export const LOW_CONFIDENCE = 0.6
export type AiDraft = { key: string; include: boolean; title: string; date: string; endDate: string; time: string; categoryId: PlannerCategoryId; person: string; sourceText?: string }
export type AiQuestion = { id: string; draftKey: string | null; field: AiQuestionField; question: string; options: { label: string; value: string }[]; required: boolean }

const validDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v
const validTime = (v: string | null | undefined) => !!v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const norm = (s: string) => s.toLocaleLowerCase('de-DE').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function categoryFromLabel(label: string): PlannerCategoryId {
  const n = norm(label)
  const hit = PLANNER_CATEGORIES.find(c => norm(c.label) === n || c.id === n) || PLANNER_CATEGORIES.find(c => norm(c.label).split(' ').some(w => w.length > 3 && n.includes(w)))
  return (hit?.id || 'other') as PlannerCategoryId
}

export function personFromName(name: string | null, members: PlannerPerson[]): string | null {
  if (!name) return null
  const n = norm(name)
  if (['alle', 'all', 'alle mitglieder', 'familie', 'everyone'].includes(n)) return 'all'
  return (members.find(m => norm(m.name) === n) || members.find(m => n.split(' ').includes(norm(m.name)) || norm(m.name).split(' ')[0] === n.split(' ')[0]))?.id || null
}

export function fixTime(v: string | null): string {
  if (!v) return ''
  const m = v.match(/^(\d{1,2})[:.](\d{2})/)
  if (!m) return ''
  const t = `${m[1].padStart(2, '0')}:${m[2]}`
  return validTime(t) ? t : ''
}

const memberOptions = (members: PlannerPerson[], task: boolean) => [...members.map(m => ({ label: m.name, value: m.id })), ...(task ? [] : [{ label: 'Alle', value: 'all' }])]
const categoryOptions = () => PLANNER_CATEGORIES.map(c => ({ label: c.label, value: c.id }))

/** Wandelt das KI-Ergebnis in bearbeitbare Entwürfe + Rückfragen um (App ergänzt eigene Fragen bei fehlenden/unsicheren Feldern). */
export function mapAiResult(result: AiResult, members: PlannerPerson[], keyPrefix = 'ai'): { drafts: AiDraft[]; questions: AiQuestion[] } {
  const drafts: AiDraft[] = []
  const questions: AiQuestion[] = []
  const has = (key: string | null, field: AiQuestionField) => questions.some(q => q.draftKey === key && q.field === field)
  result.entries.forEach((e, i) => {
    const key = `${keyPrefix}-${i}`
    const categoryId = categoryFromLabel(e.category)
    const task = categoryId === 'task'
    let person = personFromName(e.person, members)
    if (task && person === 'all') person = null
    const only = members.length === 1
    if (only && !person) person = members[0].id
    const date = validDay(e.date) ? e.date! : ''
    const endDate = validDay(e.endDate) && date && e.endDate! > date ? e.endDate! : ''
    const draft: AiDraft = { key, include: true, title: e.title.slice(0, 120), date, endDate, time: fixTime(e.time), categoryId, person: person || '', sourceText: e.sourceText || undefined }
    drafts.push(draft)
    for (const q of result.questions.filter(q => q.entryIndex === i)) {
      if (has(key, q.field) || (only && q.field === 'person')) continue
      const options = q.field === 'person' ? memberOptions(members, task) : q.field === 'category' ? categoryOptions() : q.options.map(o => ({ label: o, value: o }))
      questions.push({ id: `${key}-${q.field}`, draftKey: key, field: q.field, question: q.question, options, required: q.field === 'person' ? !draft.person : q.field === 'date' ? !draft.date : false })
    }
    const c = e.confidence
    if (!draft.person && !has(key, 'person')) questions.push({ id: `${key}-person`, draftKey: key, field: 'person', question: 'Für wen ist der Termin?', options: memberOptions(members, task), required: true })
    if (!draft.date && !has(key, 'date')) questions.push({ id: `${key}-date`, draftKey: key, field: 'date', question: 'An welchem Tag?', options: [], required: true })
    else if ((c.date ?? 1) < LOW_CONFIDENCE && !has(key, 'date')) questions.push({ id: `${key}-date`, draftKey: key, field: 'date', question: 'Stimmt das Datum?', options: [], required: false })
    if (e.time && !draft.time && !has(key, 'time')) questions.push({ id: `${key}-time`, draftKey: key, field: 'time', question: 'Uhrzeit unleserlich – wann genau?', options: [], required: false })
    else if (draft.time && (c.time ?? 1) < LOW_CONFIDENCE && !has(key, 'time')) questions.push({ id: `${key}-time`, draftKey: key, field: 'time', question: 'Stimmt die Uhrzeit?', options: [], required: false })
    if ((c.category ?? 1) < LOW_CONFIDENCE && !has(key, 'category')) questions.push({ id: `${key}-category`, draftKey: key, field: 'category', question: 'Welche Art ist das?', options: categoryOptions(), required: false })
    if (!only && draft.person && (c.person ?? 1) < LOW_CONFIDENCE && !has(key, 'person')) questions.push({ id: `${key}-person`, draftKey: key, field: 'person', question: 'Für wen ist der Termin?', options: memberOptions(members, task), required: false })
  })
  result.questions.filter(q => q.entryIndex === null).forEach((q, i) => questions.push({ id: `${keyPrefix}-general-${i}`, draftKey: null, field: 'general', question: q.question, options: q.options.map(o => ({ label: o, value: o })), required: false }))
  return { drafts, questions }
}

/** Antwort einer Rückfrage auf den Entwurf anwenden. */
export function applyAnswer(draft: AiDraft, field: AiQuestionField, value: string): AiDraft {
  switch (field) {
    case 'person': return { ...draft, person: value }
    case 'date': return validDay(value) ? { ...draft, date: value, endDate: draft.endDate && draft.endDate < value ? '' : draft.endDate } : draft
    case 'endDate': return validDay(value) ? { ...draft, endDate: value } : draft
    case 'time': return { ...draft, time: fixTime(value) }
    case 'category': { const categoryId = PLANNER_CATEGORIES.some(c => c.id === value) ? value as PlannerCategoryId : categoryFromLabel(value); return { ...draft, categoryId, person: categoryId === 'task' && draft.person === 'all' ? '' : draft.person } }
    case 'title': return value.trim() ? { ...draft, title: value.trim().slice(0, 120) } : draft
    default: return draft
  }
}

export function draftProblem(d: AiDraft): string | null {
  if (!d.title.trim()) return 'Titel fehlt'
  if (!validDay(d.date)) return 'Datum fehlt'
  if (!d.person) return 'Kalender fehlt'
  if (d.categoryId === 'task' && d.person === 'all') return 'Kalender fehlt'
  if (d.endDate && d.endDate < d.date) return 'Zeitraum prüfen'
  return null
}

/** Entwurf → Eintrag für die bestehende Planner-API (PUT /api/planner), wie beim normalen Anlegen. */
export function draftToEvent(d: AiDraft, groupId: string, id: string): Partial<PlannerEvent> {
  const task = d.categoryId === 'task'
  return { id, groupId, title: d.title.trim(), date: d.date, endDate: d.endDate || undefined, time: d.time || undefined, note: '', person: d.person, kind: task ? 'task' : 'event', eventType: d.categoryId }
}

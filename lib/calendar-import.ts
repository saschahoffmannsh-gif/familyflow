import ICAL from 'ical.js'
import type { WasteKind } from './waste-calendar'

export type ImportEntry = { sourceUid: string; title: string; date: string; endDate?: string; time?: string; note?: string; eventType: string; wasteKind?: WasteKind }
export type ImportRange = { from: string; to: string }
const pad = (n: number) => String(n).padStart(2, '0')
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
export function detectWasteKind(value: string): WasteKind | undefined {
  const s = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/gelb|yellow|wertstoff|leichtverpack|\blvp\b/.test(s)) return 'yellow'
  if (/papier|pappe|karton|\bppk\b/.test(s)) return 'paper'
  if (/bio|grunabfall|organisch/.test(s)) return 'bio'
  if (/rest|hausmull|residual/.test(s)) return 'rest'
}
function category(value: string) {
  if (/urlaub|vacation/i.test(value)) return 'vacation'
  if (/ferien|feiertag|holiday/i.test(value)) return 'holidays'
  if (/geburtstag|birthday/i.test(value)) return 'birthday'
  if (/arbeit|dienst|schicht|work|besprechung|meeting/i.test(value)) return 'work'
  if (/auftrag|task/i.test(value)) return 'task'
  return 'private'
}
function parts(epoch: number, zone: string) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch))
  const get = (type: string) => Number(p.find(v => v.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}
function wallEpoch(time: ICAL.Time, zone: string) {
  const base = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
  let epoch = base
  for (let i = 0; i < 3; i++) { const p = parts(epoch, zone); const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - base; if (!offset) break; epoch -= offset }
  return epoch
}
function calendarTime(time: ICAL.Time, tzid?: string) {
  if (time.isDate) return { date: key(time.year, time.month, time.day), time: undefined }
  // A named timezone can be resolved by Intl when no VTIMEZONE was supplied.
  const knownZone = time.zone && time.zone.tzid !== 'floating'
  const epoch = knownZone ? time.toUnixTime() * 1000 : wallEpoch(time, tzid || 'Europe/Berlin')
  const p = parts(epoch, 'Europe/Berlin')
  return { date: key(p.year, p.month, p.day), time: `${pad(p.hour)}:${pad(p.minute)}` }
}
function previousDay(date: string) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
function inRange(entry: ImportEntry, range: ImportRange) { return entry.date <= range.to && (entry.endDate || entry.date) >= range.from }
function icsEntries(text: string, range: ImportRange) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Diese Datei enthält keinen iCalendar-Kalender.')
  ICAL.TimezoneService.reset()
  const calendar = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/, '')))
  for (const component of calendar.getAllSubcomponents('vtimezone')) {
    const tzid = String(component.getFirstPropertyValue('tzid') || '')
    if (tzid) ICAL.TimezoneService.register(new ICAL.Timezone({ component, tzid }))
  }
  const components = calendar.getAllSubcomponents('vevent')
  const entries: ImportEntry[] = []
  for (const component of components.filter(c => !c.hasProperty('recurrence-id'))) {
    const event = new ICAL.Event(component)
    for (const exception of components.filter(c => c.hasProperty('recurrence-id') && c.getFirstPropertyValue('uid') === event.uid)) event.relateException(new ICAL.Event(exception))
    if (!event.startDate || String(component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') continue
    const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, occurrence: string) => {
      if (String(item.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') return
      const tzid = item.component.getFirstProperty('dtstart')?.getParameter('tzid')
      const startValue = calendarTime(start, typeof tzid === 'string' ? tzid : undefined)
      const endValue = end ? calendarTime(end, typeof tzid === 'string' ? tzid : undefined) : startValue
      // iCalendar DTEND is exclusive for all-day events.
      const endDate = start.isDate && end ? previousDay(endValue.date) : endValue.date
      const title = (item.summary || 'Termin ohne Titel').trim().slice(0, 120)
      const note = [item.location, item.description].filter(Boolean).join(' · ').slice(0, 1000)
      const metadata = `${title} ${String(item.component.getFirstPropertyValue('categories') || '')}`
      const entry: ImportEntry = { sourceUid: `${event.uid || title}/${occurrence}`, title, ...startValue, ...(endDate > startValue.date ? { endDate } : {}), ...(note ? { note } : {}), eventType: category(metadata), wasteKind: detectWasteKind(metadata) }
      if (inRange(entry, range)) entries.push(entry)
      if (entries.length > 2000) throw new Error('Mehr als 2.000 Termine. Bitte wähle einen kleineren Zeitraum.')
    }
    if (!event.isRecurring()) { add(event, event.startDate, event.endDate, event.startDate.toString()); continue }
    const iterator = event.iterator()
    let count = 0
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (++count > 50000) throw new Error('Diese Terminserie ist zu umfangreich. Bitte exportiere einen kürzeren Zeitraum.')
      // One extra day covers conversions across a timezone boundary.
      if (next.toString().slice(0, 10) > new Date(Date.parse(range.to) + 86400000).toISOString().slice(0, 10)) break
      const occurrence = event.getOccurrenceDetails(next)
      add(occurrence.item, occurrence.startDate, occurrence.endDate, next.toString())
    }
  }
  return entries
}
function csvRows(text: string) {
  const first = text.split(/\r?\n/)[0]
  const delimiter = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++ } else quoted = !quoted }
    else if (ch === delimiter && !quoted) { row.push(value.trim()); value = '' }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = '' }
    else value += ch
  }
  if (quoted) throw new Error('Die CSV-Datei enthält ein nicht geschlossenes Anführungszeichen.')
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row)
  return rows
}
function csvDate(value: string) {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(value)
  const date = iso ? iso[1] : de ? `${de[3]}-${pad(Number(de[2]))}-${pad(Number(de[1]))}` : ''
  if (!date || isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error(`Datum „${value}“ ist ungültig. Bitte TT.MM.JJJJ oder JJJJ-MM-TT verwenden.`)
  return date
}

function csvEntries(text: string, range: ImportRange) {
  const rows = csvRows(text.replace(/^\uFEFF/, ''))
  const headers = rows.shift()?.map(h => h.toLowerCase().replace(/[ _-]/g, '')) || []
  const find = (names: string[]) => headers.findIndex(h => names.includes(h))
  const dateIndex = find(['datum', 'date', 'startdatum', 'beginn', 'dtstart', 'von'])
  const titleIndex = find(['titel', 'title', 'summary', 'betreff', 'termin', 'abfallart', 'abfall', 'tonne', 'name'])
  if (dateIndex < 0 || titleIndex < 0) throw new Error('Die CSV-Datei braucht die Spalten „Datum“ und „Titel“ oder „Abfallart“.')
  const timeIndex = find(['uhrzeit', 'time', 'startzeit', 'zeit']), endIndex = find(['bis', 'enddatum', 'enddate']), noteIndex = find(['notiz', 'note', 'beschreibung', 'description']), categoryIndex = find(['kategorie', 'category', 'art'])
  return rows.map((row, index) => {
    const date = csvDate(row[dateIndex] || ''), title = (row[titleIndex] || '').trim().slice(0, 120)
    if (!title) throw new Error(`In CSV-Zeile ${index + 2} fehlt der Titel.`)
    const time = timeIndex >= 0 ? row[timeIndex]?.trim() : undefined
    if (time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Die Uhrzeit in Zeile ${index + 2} ist ungültig.`)
    return { sourceUid: `csv/${date}/${time || ''}/${title}`, title, date, ...(time ? { time: time.padStart(5, '0') } : {}), ...(endIndex >= 0 && row[endIndex] ? { endDate: csvDate(row[endIndex]) } : {}), ...(noteIndex >= 0 && row[noteIndex] ? { note: row[noteIndex].slice(0, 1000) } : {}), eventType: category(`${title} ${row[categoryIndex] || ''}`), wasteKind: detectWasteKind(`${title} ${row[categoryIndex] || ''}`) }
  }).filter(entry => inRange(entry, range))
}
export function parseCalendarFile(text: string, filename: string, range: ImportRange) {
  if (!text.trim()) throw new Error('Die Datei ist leer.')
  if (text.length > 2_000_000) throw new Error('Bitte verwende eine Datei mit höchstens 2 MB.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || range.to < range.from) throw new Error('Bitte prüfe den Importzeitraum.')
  let entries: ImportEntry[]
  try { entries = /BEGIN:VCALENDAR/i.test(text) || /\.ics$/i.test(filename) ? icsEntries(text, range) : csvEntries(text, range) }
  catch (error) { throw new Error(error instanceof Error ? error.message : 'Die Kalenderdatei konnte nicht gelesen werden.') }
  if (entries.length > 2000) throw new Error('Mehr als 2.000 Termine. Bitte wähle einen kleineren Zeitraum.')
  const unique = new Map(entries.map(e => [e.sourceUid, e]))
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCalendarFile, detectWasteKind } from '../lib/calendar-import.ts'
const range = { from: '2026-01-01', to: '2026-12-31' }
const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`
test('ICS all-day DTEND is exclusive, folded unicode text is preserved', () => {
 const entries = parseCalendarFile(calendar('BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260815\r\nSUMMARY:Urlaub an der Kü\r\n ste\r\nEND:VEVENT'), 'holidays.ics', range)
 assert.equal(entries[0].title, 'Urlaub an der Küste')
 assert.equal(entries[0].date, '2026-08-10')
 assert.equal(entries[0].endDate, '2026-08-14')
 assert.equal(entries[0].time, undefined)
 assert.equal(entries[0].eventType, 'vacation')
})
test('recurrence honors exclusions and an edited occurrence', () => {
 const entries = parseCalendarFile(calendar(`BEGIN:VEVENT\nUID:repeat\nDTSTART;VALUE=DATE:20261001\nRRULE:FREQ=WEEKLY;COUNT=4\nEXDATE;VALUE=DATE:20261008\nSUMMARY:Bioabfall\nEND:VEVENT\nBEGIN:VEVENT\nUID:repeat\nRECURRENCE-ID;VALUE=DATE:20261015\nDTSTART;VALUE=DATE:20261016\nSUMMARY:Bioabfall verschoben\nEND:VEVENT`), 'waste.ics', range)
 assert.deepEqual(entries.map(e => e.date), ['2026-10-01', '2026-10-16', '2026-10-22'])
 assert.ok(entries.every(e => e.wasteKind === 'bio'))
})
test('UTC and IANA timezone appointments convert to German local time across DST', () => {
 const text = calendar('BEGIN:VEVENT\nUID:utc\nDTSTART:20261025T060000Z\nSUMMARY:Arbeit\nEND:VEVENT\nBEGIN:VEVENT\nUID:local\nDTSTART;TZID=Europe/Berlin:20260710T090000\nSUMMARY:Meeting\nEND:VEVENT')
 const entries = parseCalendarFile(text, 'calendar.ics', range)
 assert.equal(entries.find(e => e.sourceUid.startsWith('utc/'))?.time, '07:00')
 assert.equal(entries.find(e => e.sourceUid.startsWith('local/'))?.time, '09:00')
})
test('CSV accepts German dates, quoted delimiters and waste categories', () => {
 const entries = parseCalendarFile('Datum;Titel;Uhrzeit\n26.10.2026;"Restabfall; Abfuhr";\n30.10.2026;Altpapier;6:30', 'waste.csv', range)
 assert.equal(entries[0].title, 'Restabfall; Abfuhr')
 assert.equal(entries[0].wasteKind, 'rest')
 assert.equal(entries[1].wasteKind, 'paper')
 assert.equal(entries[1].time, '06:30')
 assert.equal(detectWasteKind('LVP / Wertstofftonne'), 'yellow')
})
test('bounded recurrence does not import outside requested range and ignores cancelled events', () => {
 const entries = parseCalendarFile(calendar('BEGIN:VEVENT\nUID:weekly\nDTSTART;VALUE=DATE:20200101\nRRULE:FREQ=WEEKLY\nSUMMARY:Gelbe Tonne\nEND:VEVENT\nBEGIN:VEVENT\nUID:cancelled\nDTSTART;VALUE=DATE:20261020\nSTATUS:CANCELLED\nSUMMARY:Entfällt\nEND:VEVENT'), 'repeat.ics', { from: '2026-10-01', to: '2026-10-31' })
 assert.equal(entries.length, 4)
 assert.ok(entries.every(e => e.date >= '2026-10-01' && e.date <= '2026-10-31'))
})

test('invalid CSV dates and malformed input are rejected before import', () => {
 assert.throws(() => parseCalendarFile('Datum;Titel\n30.02.2026;Ungültig', 'bad.csv', range), /ungültig/)
 assert.throws(() => parseCalendarFile('Datum;Titel\n01.02.2026;"offen', 'bad.csv', range), /Anführungszeichen/)
 assert.throws(() => parseCalendarFile('kein Kalender', 'bad.ics', range), /iCalendar/)
})

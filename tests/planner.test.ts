import { test } from 'node:test'
import assert from 'node:assert/strict'
import { belongsTo, normalizeSelection, offeredTo, selectionLabel, selectionOf, coversDay, dayContext, monthDays, type PlannerEvent } from '../lib/planner.ts'
const event = (id: string, groupId: string, person: string, date = '2026-12-15', endDate?: string): PlannerEvent => ({ id, groupId, person, date, endDate, title: id, eventType: 'private', revision: 1 })
test('month shows only selected member plus shared appointments', () => {
 const events = [event('mine', 'family', 'sascha'), event('other', 'family', 'katharina'), event('shared', 'family', 'all')]
 assert.deepEqual(events.filter(e => belongsTo(e, 'sascha')).map(e => e.id), ['mine', 'shared'])
})
test('day separates member calendars and only personal appointments from other groups', () => {
 const events = [event('mine', 'family', 'sascha'), event('other', 'family', 'katharina'), event('shared', 'family', 'all'), event('work-mine', 'work', 'sascha'), event('work-other', 'work', 'colleague'), event('work-all', 'work', 'all'), event('tomorrow', 'family', 'sascha', '2026-12-16')]
 const context = dayContext(events, 'family', 'sascha', 'sascha', '2026-12-15')
 assert.deepEqual(context.selected.map(e => e.id), ['mine', 'shared'])
 assert.deepEqual(context.others.map(e => e.id), ['other'])
 assert.deepEqual(context.external.map(e => e.id), ['work-mine', 'work-all'])
 const colleague = dayContext(events, 'family', 'katharina', 'sascha', '2026-12-15')
 assert.deepEqual(colleague.selected.map(e => e.id), ['other', 'shared'])
 assert.deepEqual(colleague.external.map(e => e.id), ['work-mine', 'work-all'])
})
test('multi-day entries include both ends and cross month boundaries', () => {
 const trip = event('trip', 'team', 'sascha', '2026-12-30', '2027-01-03')
 assert.equal(coversDay(trip, '2026-12-29'), false)
 for (const day of ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-03']) assert.equal(coversDay(trip, day), true)
 assert.equal(coversDay(trip, '2027-01-04'), false)
})
test('calendar contains entire month with Monday-first complete weeks including leap day', () => {
 for (const [year, month] of [[2026, 1], [2026, 2], [2026, 7], [2028, 1]]) {
  const days = monthDays(new Date(year, month, 1, 12))
  assert.equal(days[0].date.getDay(), 1)
  assert.equal(days.at(-1)!.date.getDay(), 0)
  assert.equal(days.length % 7, 0)
  assert.equal(days.filter(d => !d.outside).length, new Date(year, month + 1, 0).getDate())
  assert.equal(new Set(days.map(d => d.key)).size, days.length)
 }
})

test('waste is visible in both adult calendars and absent from Arjens day context', async () => {
 const waste: PlannerEvent = { ...event('waste', 'family', 'parents'), wasteKind: 'rest', audience: ['sascha', 'katharina'] }
 assert.equal(belongsTo(waste, 'sascha'), true)
 assert.equal(belongsTo(waste, 'katharina'), true)
 assert.equal(belongsTo(waste, 'arjen'), false)
 assert.deepEqual(dayContext([waste], 'family', 'arjen', 'sascha', '2026-12-15').others, [])
})
test('month swipes distinguish horizontal movement from vertical scrolling and taps', async () => {
 const { swipeMonthOffset } = await import('../lib/planner.ts')
 assert.equal(swipeMonthOffset(-100, 10, 300), 1)
 assert.equal(swipeMonthOffset(100, 10, 300), -1)
 assert.equal(swipeMonthOffset(20, 5, 100), 0)
 assert.equal(swipeMonthOffset(70, 100, 200), 0)
 assert.equal(swipeMonthOffset(-100, 0, 1500), 1)
})

test('several people: normalize, label, belongsTo and offers', () => {
 const ids = ['a', 'b', 'c'], members = ids.map(id => ({ id, name: id.toUpperCase(), color: '#000' }))
 assert.deepEqual(normalizeSelection(['b'], ids), { person: 'b' })
 assert.deepEqual(normalizeSelection(['c', 'a'], ids), { person: 'a', audience: ['a', 'c'] })
 assert.deepEqual(normalizeSelection(ids, ids), { person: 'all' })
 assert.deepEqual(normalizeSelection(ids, ids, false), { person: 'a', audience: ids })
 assert.equal(normalizeSelection(['zz'], ids), null)
 const shared = { ...event('s', 'g', 'a'), audience: ['a', 'c'] }
 assert.deepEqual(['a', 'b', 'c'].filter(p => belongsTo(shared, p)), ['a', 'c'])
 assert.deepEqual(selectionOf(shared, ids), ['a', 'c']); assert.deepEqual(selectionOf(event('x', 'g', 'all'), ids), ids)
 assert.equal(selectionLabel(['a', 'c'], members, [{ id: 's1', name: 'Früh', members: ['c', 'a'] }]), 'Früh')
 assert.equal(selectionLabel(['a', 'c'], members), 'A & C'); assert.equal(selectionLabel(ids, members), 'Alle Mitglieder')
 assert.ok(offeredTo({}, 'b')); assert.ok(!offeredTo({ audience: ['a'] }, 'b'))
})

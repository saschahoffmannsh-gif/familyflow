import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(realpathSync(new URL('../node_modules/drizzle-kit/bin.cjs', import.meta.url)))
const { build } = require('esbuild')
const sqlite = new DatabaseSync(':memory:')
for (const name of readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join(root, 'drizzle', name), 'utf8'))
function prepare(sql) {
 const statement = sqlite.prepare(sql)
 let args = []
 const prepared = {
  bind(...next) { args = next; return prepared },
  async all() { return { results: statement.all(...args) } },
  async first() { return statement.get(...args) || null },
  async run() { const result = statement.run(...args); return { meta: { changes: Number(result.changes) } } },
 }
 return prepared
}
globalThis.__plannerTestDb = { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results } catch (error) { sqlite.exec('ROLLBACK'); throw error } } }
const bundled = await build({ entryPoints: [path.join(root, 'app/api/planner/route.ts')], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'd1-test-adapter', setup(build) {
 build.onResolve({ filter: /^@\/db$/ }, () => ({ path: 'db', namespace: 'test' }))
 build.onResolve({ filter: /^@\/lib\/family-access$/ }, () => ({ path: 'access', namespace: 'test' }))
 build.onResolve({ filter: /^@\/lib\/push-server$/ }, () => ({ path: 'push', namespace: 'test' }))
 build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'db' ? 'export const getDb = () => globalThis.__plannerTestDb' : path === 'access' ? "export const isValidProfileChangeCode = value => value === 'qa-profile-code'" : 'export async function notifyPeople() {}', loader: 'js' }))
 build.onResolve({ filter: /^@\// }, ({ path: specifier }) => { const base = path.join(root, specifier.slice(2)); for (const suffix of ['.ts', '/index.ts']) { try { readFileSync(base + suffix); return { path: base + suffix } } catch {} } })
} }] })
const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
async function call(method, body, key, expected = 200) {
 const response = await api[method](new Request('https://planner.test/api/planner', { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }))
 const result = await response.json()
 assert.equal(response.status, expected, `${method}: ${JSON.stringify(result)}`)
 return result
}
test('group invitations, membership isolation, shared writes and revision conflicts', async () => {
 const alice = await call('POST', { action: 'profile', name: 'Alice' }); const a = alice.identity.key
 const bob = await call('POST', { action: 'profile', name: 'Bob' }); const b = bob.identity.key
 const outsider = await call('POST', { action: 'profile', name: 'Outside' }); const o = outsider.identity.key
 const created = await call('POST', { action: 'create-group', name: 'Team', category: 'Team' }, a)
 const group = created.groups[0]
 assert.equal(group.members.length, 1)
 const joined = await call('POST', { action: 'join', code: group.inviteCode.toLowerCase() }, b)
 assert.equal(joined.groups[0].members.length, 2)
 const p = { id: crypto.randomUUID(), groupId: group.id, title: 'Training', date: '2026-12-15', person: alice.profile.id, eventType: 'private' }
 let result = await call('PUT', p, a)
 assert.equal(result.events[0].revision, 1)
 assert.equal((await call('GET', null, b)).events[0].title, 'Training')
 assert.equal((await call('GET', null, o)).events.length, 0)
 await call('PUT', p, o, 403)
 await call('PUT', { ...p, person: outsider.profile.id }, a, 403)
 await call('PUT', { ...p, revision: 0 }, a, 409)
 result = await call('PUT', { ...p, title: 'Changed', revision: 1 }, b)
 assert.equal(result.events[0].revision, 2)
 await call('DELETE', { ...p, revision: 1 }, a, 409)
 await call('PUT', { ...p, id: crypto.randomUUID(), date: '2026-02-30' }, a, 400)
 await call('POST', { action: 'join', code: '123' }, a, 400)
 await call('DELETE', { ...p, revision: 2 }, a)
 assert.equal((await call('GET', null, a)).events.length, 0)
 await call('GET', null, null, 401)
})
test('existing family appointments remain intact and use their original revisions', async () => {
 await call('POST', { action: 'legacy', id: 'sascha' }, null, 401)
 const family = await call('POST', { action: 'legacy', id: 'sascha', code: 'qa-profile-code' }); const key = family.identity.key
 const count = family.events.length
 const p = { id: crypto.randomUUID(), groupId: 'family', title: 'Family QA', date: '2026-12-15', person: 'sascha', eventType: 'private' }
 const result = await call('PUT', p, key)
 assert.equal(result.events.length, count + 1)
 assert.equal(result.events.find(e => e.id === p.id).revision, 1)
 await call('DELETE', { ...p, revision: 0 }, key, 409)
 await call('DELETE', { ...p, revision: 1 }, key)
 assert.equal((await call('GET', null, key)).events.length, count)
})

test('all entry categories persist in group calendars, including tasks', async () => {
 const profile = await call('POST', { action: 'profile', name: 'Category QA' })
 const key = profile.identity.key
 const created = await call('POST', { action: 'create-group', name: 'Categories', category: 'Team' }, key)
 const groupId = created.selectedGroupId
 for (const type of ['private', 'work', 'vacation', 'holidays', 'birthday', 'other', 'task']) {
  const event = { id: crypto.randomUUID(), groupId, title: type, date: '2026-12-15', person: profile.profile.id, eventType: type, kind: type === 'task' ? 'task' : 'event' }
  const result = await call('PUT', event, key)
  const saved = result.events.find(e => e.id === event.id)
  assert.equal(saved.eventType, type)
  assert.equal(saved.kind, event.kind)
 }
 const loaded = await call('GET', null, key)
 assert.equal(new Set(loaded.events.map(e => e.eventType)).size, 7)
 await call('PUT', { id: crypto.randomUUID(), groupId, title: 'Invalid', date: '2026-12-15', person: profile.profile.id, eventType: 'unknown' }, key, 400)
})

test('waste returns only for parents and its completion is shared', async () => {
 const auth = async id => call('POST', { action: 'legacy', id, code: 'qa-profile-code' })
 const sascha = await auth('sascha'), katha = await auth('katharina'), arjen = await auth('arjen')
 const waste = sascha.events.find(e => e.wasteKind)
 assert.ok(waste)
 assert.ok(katha.events.some(e => e.id === waste.id))
 assert.ok(!arjen.events.some(e => e.wasteKind))
 await call('POST', { action: 'waste-status', id: waste.id, completed: true }, arjen.identity.key, 403)
 await call('POST', { action: 'waste-status', id: waste.id, completed: true }, sascha.identity.key)
 assert.equal((await call('GET', null, katha.identity.key)).events.find(e => e.id === waste.id).completed, true)
})
test('calendar import is idempotent, validates all entries, and can be edited in family', async () => {
 const sascha = await call('POST', { action: 'legacy', id: 'sascha', code: 'qa-profile-code' }); const key = sascha.identity.key
 const entry = { sourceUid: 'source-abc', title: 'Imported work', date: '2027-02-01', eventType: 'work' }
 const body = { action: 'import', groupId: 'family', person: 'sascha', mode: 'calendar', entries: [entry] }
 let result = await call('POST', body, key)
 assert.equal(result.importSummary.imported, 1)
 result = await call('POST', body, key)
 assert.equal(result.importSummary.imported, 0)
 assert.equal(result.importSummary.duplicates, 1)
 const saved = result.events.find(e => e.title === entry.title)
 result = await call('PUT', { ...saved, title: 'Edited import' }, key)
 assert.equal(result.events.find(e => e.id === saved.id).title, 'Edited import')
 await call('DELETE', { ...saved, revision: 2 }, key)
 await call('POST', { ...body, entries: [entry, { ...entry, date: '2027-02-30' }] }, key, 400)
 assert.ok(!(await call('GET', null, key)).events.some(e => e.title === entry.title))
})
test('waste import skips existing collections and keeps imported pickups private to parents', async () => {
 const sascha = await call('POST', { action: 'legacy', id: 'sascha', code: 'qa-profile-code' }); const key = sascha.identity.key
 const existing = sascha.events.find(e => e.wasteKind === 'rest')
 const body = { action: 'import', groupId: 'family', person: 'parents', mode: 'waste', entries: [{ sourceUid: 'new-waste', title: 'Restabfall 2027', date: '2027-01-04', eventType: 'other', wasteKind: 'rest' }, { sourceUid: 'old-waste', title: existing.title, date: existing.date, eventType: 'other', wasteKind: 'rest' }] }
 let result = await call('POST', body, key)
 assert.equal(result.importSummary.imported, 1)
 assert.equal(result.importSummary.duplicates, 1)
 const saved = result.events.find(e => e.title === 'Restabfall 2027')
 assert.deepEqual(saved.audience, ['sascha', 'katharina'])
 const arjen = await call('POST', { action: 'legacy', id: 'arjen', code: 'qa-profile-code' })
 assert.ok(!arjen.events.some(e => e.id === saved.id))
 await call('POST', body, arjen.identity.key, 403)
 await call('POST', { action: 'waste-status', id: saved.id, completed: true }, key)
 const katha = await call('POST', { action: 'legacy', id: 'katharina', code: 'qa-profile-code' })
 assert.equal(katha.events.find(e => e.id === saved.id).completed, true)
})

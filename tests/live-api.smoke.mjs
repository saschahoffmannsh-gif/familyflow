// Smoke-Test gegen die live Supabase Edge Function.
// FF_API_BASE=https://<ref>.supabase.co/functions/v1/familyflow [FF_PROFILE_CHANGE_CODE=...] node tests/live-api.smoke.mjs
// Legt Testdaten (Profile „Smoke …“, Gruppe, Termin, Chat mit Bild, Aufgabe/Einkauf) an und entfernt Termine/Listeneinträge wieder.
import assert from 'node:assert/strict'
const base = (process.env.FF_API_BASE || 'https://wlujgkbtpjxuekwsgnmg.supabase.co/functions/v1/familyflow').replace(/\/$/, '')
const origin = process.env.FF_ORIGIN || 'https://saschahoffmannsh-gif.github.io'
const region = process.env.FF_REGION ?? 'eu-west-1'
const results = []
async function step(name, fn) { const t = Date.now(); try { const v = await fn(); results.push(`PASS ${name} (${Date.now() - t} ms)`); return v } catch (e) { results.push(`FAIL ${name}: ${e.message}`); throw e } }
async function call(method, path, key, body, status = 200) {
  const r = await fetch(base + path, { method, headers: { Origin: origin, ...(region ? { 'x-region': region } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) })
  const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text }
  assert.equal(r.status, status, `${method} ${path}: ${text.slice(0, 300)}`)
  return { data, response: r }
}
const stamp = new Date().toISOString().slice(0, 16)
try {
  await step('CORS-Preflight für GitHub Pages', async () => {
    const r = await fetch(base + '/api/planner', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } })
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), origin)
  })
  await step('fremde Herkunft wird für Schreibzugriffe abgewiesen', async () => { const r = await fetch(base + '/api/planner', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'profile', name: 'X' }) }); assert.ok(r.status >= 400 && r.status < 500, String(r.status)) })
  const owner = await step('Profil anlegen', async () => (await call('POST', '/api/planner', null, { action: 'profile', name: `Smoke ${stamp}` })).data.identity)
  await step('Anmeldung mit Profilschlüssel', async () => { const { data } = await call('GET', '/api/planner', owner.key); assert.ok(Array.isArray(data.groups)) })
  await call('GET', '/api/planner', null, null, 401)
  const group = await step('Gruppe anlegen', async () => (await call('POST', '/api/planner', owner.key, { action: 'create-group', name: 'Smoke-Gruppe', category: 'Team' })).data.groups.find(g => g.name === 'Smoke-Gruppe'))
  const eventId = crypto.randomUUID()
  await step('Termin anlegen', async () => { const { data } = await call('PUT', '/api/planner', owner.key, { id: eventId, groupId: group.id, title: 'Smoke-Termin', date: '2027-01-05', time: '10:00', person: owner.id, eventType: 'work' }); assert.ok(data.events.some(e => e.id === eventId && e.revision === 1)) })
  const taskId = crypto.randomUUID()
  await step('Aufgabe (Kategorie Auftrag) anlegen', async () => { const { data } = await call('PUT', '/api/planner', owner.key, { id: taskId, groupId: group.id, title: 'Smoke-Auftrag', date: '2027-01-06', person: owner.id, eventType: 'task' }); assert.equal(data.events.find(e => e.id === taskId).eventType, 'task') })
  const thread = await step('Chat zum Termin öffnen', async () => (await call('POST', '/api/discussions', owner.key, { action: 'open', kind: 'event', id: eventId })).data)
  await step('Chatnachricht senden', async () => { const { data } = await call('POST', '/api/discussions', owner.key, { action: 'message', threadId: thread.id, body: 'Smoke-Nachricht', messageId: crypto.randomUUID() }); assert.ok(data.messages.some(m => m.body === 'Smoke-Nachricht')) })
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
  const attachment = await step('Bild im Chat hochladen (Supabase Storage)', async () => { const form = new FormData(); form.set('threadId', thread.id); form.set('file', new File([png], 'bild.png', { type: 'image/png' })); const { data } = await call('POST', '/api/discussions/attachments', owner.key, form); const a = data.messages.at(-1).attachment; assert.equal(a.mime, 'image/png'); return a })
  await step('Bild wieder abrufen', async () => { const r = await fetch(`${base}/api/discussions/media/${attachment.id}`, { headers: { Origin: origin, ...(region ? { 'x-region': region } : {}), Authorization: `Bearer ${owner.key}` } }); assert.equal(r.status, 200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), png) })
  await step('Termin löschen', async () => { await call('DELETE', '/api/planner', owner.key, { id: eventId, groupId: group.id, title: 'Smoke-Termin', date: '2027-01-05', person: owner.id, eventType: 'work', revision: 1 }); await call('DELETE', '/api/planner', owner.key, { id: taskId, groupId: group.id, title: 'Smoke-Auftrag', date: '2027-01-06', person: owner.id, eventType: 'task', revision: 1 }) })
  await step('Tages-Push ohne Token abgewiesen', async () => { await call('POST', '/api/push/daily', null, {}, 401) })
  if (process.env.FF_PROFILE_CHANGE_CODE) {
    const family = await step('Familienprofil (Änderungscode) anmelden', async () => (await call('POST', '/api/planner', null, { action: 'legacy', id: 'sascha', code: process.env.FF_PROFILE_CHANGE_CODE })).data.identity)
    const todoId = `smoke-${crypto.randomUUID()}`
    await step('Listen: Auftrag anlegen', async () => { const { data } = await call('PUT', '/api/todo', family.key, { id: todoId, kind: 'task', title: 'Smoke-Auftrag Liste', createdBy: 'sascha' }); assert.equal(data.item.id, todoId) })
    await step('Listen: Auftrag löschen', async () => { await call('DELETE', '/api/todo', family.key, { id: todoId }) })
    const shopId = `smoke-${crypto.randomUUID()}`
    await step('Listen: Einkauf anlegen/löschen', async () => { const { data } = await call('PUT', '/api/shopping', family.key, { id: shopId, label: 'Smoke-Milch', productKey: 'milch', addedBy: 'sascha' }); assert.equal(data.item.id, shopId); await call('DELETE', '/api/shopping', family.key, { id: shopId }) })
    await step('Push-Anmeldung (Erinnerungslink zeigt auf die Function) + Abmeldung', async () => {
      const endpoint = `https://push.example.invalid/${crypto.randomUUID()}`
      const { data } = await call('POST', '/api/push/subscription', null, { person: 'sascha', deviceId: crypto.randomUUID(), subscription: { endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } } })
      assert.ok(data.reminderUrl?.startsWith(`${base}/api/push/daily?`), JSON.stringify(data))
      await call('DELETE', '/api/push/subscription', null, { endpoint })
    })
    await step('Familienkalender lesen (Seed-Daten)', async () => { const { data } = await call('GET', '/api/calendar', family.key); assert.ok(data.items.length >= 1) })
  } else results.push('SKIP Familienprofil/Listen (FF_PROFILE_CHANGE_CODE nicht gesetzt)')
} finally { console.log(results.join('\n')) }

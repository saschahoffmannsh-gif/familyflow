// End-to-End-Test der GitHub-Pages-Version gegen die live Supabase-Function (Chrome headless).
// FF_APP_URL=https://saschahoffmannsh-gif.github.io/familyflow/ [FF_PROFILE_CHANGE_CODE=...] node tests/e2e-pages.mjs
// Screenshots: FF_SHOTS (Standard /workspace/familyflow_shots).
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const appUrl = process.env.FF_APP_URL || 'https://saschahoffmannsh-gif.github.io/familyflow/'
const apiBase = process.env.FF_API_BASE || 'https://wlujgkbtpjxuekwsgnmg.supabase.co/functions/v1/familyflow'
const shots = process.env.FF_SHOTS || '/workspace/familyflow_shots'
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const image = path.resolve(import.meta.dirname, '../public/branding/handoff-v1-icon-192.png')
mkdirSync(shots, { recursive: true })
const results = []
const errors = []
const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' })
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
if (process.env.FF_TRACE) page.on('response', async r => { if (r.url().includes('/api/')) console.log('TRACE', r.request().method(), r.status(), r.url().replace(/^.*\/api/, '/api'), (r.request().postData() || '').slice(0, 160), r.status() >= 400 ? (await r.text().catch(() => '')).slice(0, 160) : '') })
page.on('response', r => { if (r.status() >= 500 || (r.status() >= 400 && !r.url().includes('/api/'))) errors.push(`HTTP ${r.status()} ${r.url()}`) })
let n = 0
const shot = async name => { const file = path.join(shots, `${String(++n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: file }); return file }
const RUN = Date.now().toString(36).slice(-5)
const TODO_TITLE = `E2E Listen-Auftrag ${RUN}`
const SHOP_LABEL = `E2E Milch ${RUN}`
async function step(name, fn) { const t = Date.now(); try { await fn(); results.push(`PASS ${name} (${Date.now() - t} ms)`) } catch (e) { results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); await shot(`fehler-${name.replace(/\W+/g, '-')}`).catch(() => {}); throw e } }
const dialog = () => page.getByRole('dialog')
try {
  await step('GitHub-Pages-Seite lädt (Titel, Manifest, Service Worker)', async () => {
    const res = await page.goto(appUrl, { waitUntil: 'networkidle' })
    assert.equal(res.status(), 200)
    assert.equal(await page.title(), 'Done')
    await page.getByRole('button', { name: 'Eigenes Profil anlegen' }).waitFor()
    const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json())
    assert.equal(manifest.name, 'Done')
    await page.waitForFunction(() => navigator.serviceWorker?.getRegistration().then(r => !!r), null, { timeout: 15000 }).catch(() => {})
    await shot('start')
  })
  if (!process.env.FF_SKIP_SPA404) await step('SPA-Fallback (404.html) für Unterpfade', async () => {
    const p2 = await context.newPage(); const r = await p2.goto(new URL('unterseite-gibt-es-nicht', appUrl).href, { waitUntil: 'domcontentloaded' })
    assert.equal(r.status(), 404); assert.equal(await p2.title(), 'Done'); await p2.close()
  })
  await step('API erreichbar (Health + CORS von der Pages-Herkunft)', async () => {
    const health = await page.evaluate(async base => (await fetch(`${base}/health?db=1`, { headers: { 'x-region': 'eu-west-1' } })).json(), apiBase)
    assert.equal(health.ok, true); assert.equal(health.db.ok, true)
  })
  await step('Profil anlegen', async () => {
    await page.getByPlaceholder('Wie heißt du?').fill(`E2E ${stamp}`)
    await page.getByRole('button', { name: 'Eigenes Profil anlegen' }).click()
    await page.getByRole('button', { name: 'Gruppe erstellen' }).waitFor()
    await shot('profil-angelegt')
  })
  await step('Gruppe anlegen', async () => {
    await page.getByRole('button', { name: 'Gruppe erstellen' }).click()
    await page.getByPlaceholder('z. B. Laufteam, Arbeit oder Familie').fill('E2E Gruppe')
    await dialog().getByRole('button', { name: 'Gruppe erstellen' }).click()
    await page.getByRole('button', { name: 'Termin erstellen' }).waitFor()
  })
  await step('Termin anlegen', async () => {
    await page.getByRole('button', { name: 'Termin erstellen' }).click()
    await page.getByPlaceholder('Titel', { exact: true }).fill('E2E Termin')
    await page.locator('input[type=time]').fill('10:00')
    await page.waitForTimeout(600); await shot('termin-formular')
    await page.getByRole('button', { name: 'Eintrag speichern und Chat öffnen' }).click()
    await page.getByRole('button', { name: 'Chat schließen' }).waitFor()
  })
  await step('Chatnachricht senden', async () => {
    await page.getByRole('textbox', { name: 'Nachricht schreiben' }).fill('Hallo aus dem E2E-Test')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByText('Hallo aus dem E2E-Test').last().waitFor()
  })
  await step('Bild im Chat senden', async () => {
    await page.getByRole('button', { name: 'Bild, Sprachnachricht oder Erinnerung hinzufügen' }).click()
    await page.locator('input[type=file][accept^="image/"]').setInputFiles(image)
    await page.getByText('Bild bereit zum Senden').waitFor()
    const uploaded = page.waitForResponse(r => r.url().includes('/api/discussions/attachments') && r.request().method() === 'POST', { timeout: 30000 })
    const loaded = page.waitForResponse(r => r.url().includes('/api/discussions/media/'), { timeout: 30000 })
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    assert.equal((await uploaded).status(), 200, 'Upload')
    assert.equal((await loaded).status(), 200, 'Bild abrufen')
    await page.getByText('Bild bereit zum Senden').waitFor({ state: 'detached' })
    await page.waitForTimeout(800)
    await shot('chat-mit-bild')
  })
  await step('Termin erscheint im Kalender', async () => {
    await page.getByRole('button', { name: 'Chat schließen' }).click()
    await page.getByText('E2E Termin').first().waitFor()
    await shot('kalender-mit-termin')
  })
  await step('Auftrag (Aufgabe) anlegen', async () => {
    await page.getByRole('button', { name: 'Auftrag erstellen' }).click()
    await dialog().locator('input:not([type]), input[type=text]').first().fill('E2E Auftrag')
    await page.waitForTimeout(600); await shot('auftrag-formular')
    await dialog().getByRole('button', { name: 'Speichern', exact: true }).click()
    await dialog().waitFor({ state: 'detached' })
    await page.getByText('E2E Auftrag').first().waitFor()
  })
  if (process.env.FF_PROFILE_CHANGE_CODE) {
    await step('Familienprofil anmelden (Änderungscode)', async () => {
      await page.evaluate(() => localStorage.clear())
      await page.goto(appUrl, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Sascha' }).click()
      await page.getByPlaceholder('Dein bestehender Code').fill(process.env.FF_PROFILE_CHANGE_CODE)
      await page.getByRole('button', { name: 'Profil öffnen' }).click()
      await page.getByRole('button', { name: 'Listen' }).first().waitFor()
    })
    await step('Liste: offenen Auftrag eintragen', async () => {
      await page.getByRole('button', { name: 'Listen' }).first().click()
      await page.locator('button', { hasText: 'Offen eintragen' }).filter({ hasText: 'Auftrag' }).click()
      await page.getByPlaceholder('z. B. Keller aufräumen').fill(TODO_TITLE)
      await page.getByRole('button', { name: 'Offen eintragen', exact: true }).click()
      await page.getByText(TODO_TITLE).first().waitFor()
      await page.waitForTimeout(600); await shot('liste-auftrag')
    })
    await step('Einkaufsliste: Artikel hinzufügen', async () => {
      await page.getByRole('button', { name: /Einkaufsliste öffnen/ }).click()
      const saved = page.waitForResponse(r => r.url().includes('/api/shopping') && r.request().method() === 'PUT')
      await page.getByPlaceholder('Was brauchen wir?').fill(SHOP_LABEL)
      await page.getByRole('button', { name: 'Eingabe zur Einkaufsliste hinzufügen' }).click()
      assert.equal((await saved).status(), 200)
      await page.getByText(SHOP_LABEL).first().waitFor()
      await page.waitForTimeout(600); await shot('einkaufsliste')
    })
  } else results.push('SKIP Familienprofil/Listen (FF_PROFILE_CHANGE_CODE nicht gesetzt)')
} finally {
  await browser.close()
  console.log(results.join('\n'))
  if (errors.length) console.log('Browser-Fehler:\n' + [...new Set(errors)].join('\n'))
}

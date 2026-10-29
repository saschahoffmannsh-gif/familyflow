'use client'
import { useMemo, useState } from 'react'
import { Check, FileUp, LoaderCircle, Trash2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { parseCalendarFile, type ImportEntry } from '@/lib/calendar-import'
import { PLANNER_WASTE_CATEGORIES, type PlannerEvent, type PlannerGroup, type PlannerPerson } from '@/lib/planner'
import type { WasteKind } from '@/lib/waste-calendar'

export default function PlannerImportDialog({ groups, activeGroupId, self, existing, onClose, onImport }: {
  groups: PlannerGroup[]; activeGroupId?: string; self: PlannerPerson; existing: PlannerEvent[]; onClose: () => void; onImport: (body: unknown) => Promise<void>
}) {
  const year = new Date().getFullYear()
  const [groupId, setGroupId] = useState(activeGroupId || groups[0]?.id || '')
  const [mode, setMode] = useState<'calendar' | 'waste'>('calendar')
  const [person, setPerson] = useState(self.id)
  const [from, setFrom] = useState(`${year}-01-01`), [to, setTo] = useState(`${year + 1}-12-31`)
  const [raw, setRaw] = useState(''), [filename, setFilename] = useState('')
  const [entries, setEntries] = useState<ImportEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [globalBin, setGlobalBin] = useState('auto')
  const [bins, setBins] = useState<Record<string, WasteKind>>({})
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reading, setReading] = useState(false)
  const group = groups.find(g => g.id === groupId)
  const parents = mode === 'waste' && groupId === 'family'
  const canImport = !parents || ['sascha', 'katharina'].includes(self.id)
  const target = parents ? 'parents' : person
  const rows = useMemo(() => entries.map(entry => {
    const wasteKind = bins[entry.sourceUid] || (globalBin === 'auto' ? entry.wasteKind : globalBin as WasteKind)
    const duplicate = existing.some(e => e.groupId === groupId && (mode === 'waste' ? e.wasteKind === wasteKind && e.date === entry.date : e.title === entry.title && e.date === entry.date && (e.time || '') === (entry.time || '') && (e.endDate || '') === (entry.endDate || '') && e.person === target))
    return { entry, wasteKind, duplicate, valid: mode !== 'waste' || !!wasteKind }
  }), [entries, bins, globalBin, existing, groupId, mode, target])
  const chosen = rows.filter(row => selected.has(row.entry.sourceUid) && row.valid && !row.duplicate)
  const duplicates = rows.filter(row => row.duplicate).length
  function preview(text = raw, name = filename, autoMode = false) {
    try {
      const parsed = parseCalendarFile(text, name, { from, to })
      setEntries(parsed); setSelected(new Set(parsed.map(entry => entry.sourceUid))); setError('')
      if (autoMode && parsed.length && parsed.filter(e => e.wasteKind).length > parsed.length / 2) setMode('waste')
      if (!parsed.length) setError('In diesem Zeitraum wurden keine Termine gefunden.')
    } catch (e) { setEntries([]); setError((e as Error).message) }
  }
  return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="planner-dialog p-import-dialog"><DialogHeader><span className="p-eyebrow">Kalender ergänzen</span><DialogTitle>Termine importieren</DialogTitle><DialogDescription>Lade eine ICS- oder CSV-Datei. Prüfe die Vorschau und wähle aus, was übernommen werden soll.</DialogDescription></DialogHeader>
    <div className="p-form-fields">
      <div className="p-import-mode" role="group" aria-label="Importart"><button aria-pressed={mode === 'calendar'} onClick={() => setMode('calendar')}><Upload size={16}/> Kalendertermine</button><button aria-pressed={mode === 'waste'} onClick={() => setMode('waste')}><Trash2 size={16}/> Müllabholungen</button></div>
      <div className="p-form-row"><div><label htmlFor="import-group">Gruppe</label><select id="import-group" value={groupId} onChange={e => { setGroupId(e.target.value); setPerson(self.id) }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div><div><label htmlFor="import-person">Kalender</label>{parents ? <div className="p-import-parents">Sascha & Katharina</div> : <select id="import-person" value={person} onChange={e => setPerson(e.target.value)}>{group?.members.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="all">Alle Mitglieder</option></select>}</div></div>
      {parents && <p className="p-section-note">Diese Mülltermine erscheinen nur für Sascha und Katharina. Die Bestätigung wird gemeinsam gespeichert.</p>}
      {!canImport && <p className="p-error">Mülltermine in der Familie können nur Sascha und Katharina importieren.</p>}
      <div className="p-form-row"><div><label htmlFor="import-from">Von</label><input id="import-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setEntries([]) }}/></div><div><label htmlFor="import-to">Bis</label><input id="import-to" type="date" min={from} value={to} onChange={e => { setTo(e.target.value); setEntries([]) }}/></div></div>
      <label className="p-file-picker"><FileUp size={24}/><span><strong>{filename || 'Kalenderdatei auswählen'}</strong><small>ICS oder CSV · maximal 2 MB</small></span><input aria-label="Kalenderdatei auswählen" type="file" accept=".ics,.csv,text/calendar,text/csv" disabled={busy || reading} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setReading(true); setError(''); try { if (file.size > 2_000_000) throw new Error('Bitte verwende eine Datei mit höchstens 2 MB.'); const text = await file.text(); setRaw(text); setFilename(file.name); setBins({}); preview(text, file.name, true) } catch (e) { setError((e as Error).message) } finally { setReading(false) } }}/></label>
      <p className="p-section-note">CSV: Spalten „Datum“ und „Titel“ oder „Abfallart“. Optional: Uhrzeit, Bis, Notiz und Kategorie. Wiederholungen werden innerhalb des gewählten Zeitraums aufgelöst.</p>
      {!!raw && !entries.length && <button className="p-secondary-button" onClick={() => preview()}>Vorschau erstellen</button>}
      {mode === 'waste' && !!entries.length && <><label htmlFor="import-bin">Tonnenart</label><select id="import-bin" value={globalBin} onChange={e => setGlobalBin(e.target.value)}><option value="auto">Aus den Terminen erkennen</option>{Object.entries(PLANNER_WASTE_CATEGORIES).map(([id, bin]) => <option key={id} value={id}>{bin.label} für alle Einträge</option>)}</select></>}
      {!!entries.length && <section className="p-import-preview" aria-label="Importvorschau"><header><strong>{entries.length} Termine erkannt</strong><span>{chosen.length} ausgewählt{duplicates ? ` · ${duplicates} bereits vorhanden` : ''}</span><button onClick={() => setSelected(chosen.length ? new Set() : new Set(rows.filter(r => r.valid && !r.duplicate).map(r => r.entry.sourceUid)))}>{chosen.length ? 'Auswahl aufheben' : 'Alle auswählen'}</button></header><div className="p-import-rows">{rows.map(({ entry, wasteKind, duplicate, valid }) => <div className={`p-import-row ${duplicate ? 'duplicate' : ''}`} key={entry.sourceUid}><input type="checkbox" aria-label={`${entry.title} am ${entry.date} importieren`} checked={selected.has(entry.sourceUid) && valid && !duplicate} disabled={!valid || duplicate || busy} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(entry.sourceUid); else next.delete(entry.sourceUid); return next })}/><span><strong>{entry.title}</strong><small>{entry.date.split('-').reverse().join('.')} {entry.time || ''}{entry.endDate ? ` bis ${entry.endDate.split('-').reverse().join('.')}` : ''}{duplicate ? ' · bereits vorhanden' : ''}</small></span>{mode === 'waste' && <select aria-label={`Tonnenart für ${entry.title} am ${entry.date}`} value={wasteKind || ''} onChange={e => { setBins(current => ({ ...current, [entry.sourceUid]: e.target.value as WasteKind })); setSelected(current => new Set([...current, entry.sourceUid])) }}><option value="" disabled>Art wählen</option>{Object.entries(PLANNER_WASTE_CATEGORIES).map(([id, bin]) => <option key={id} value={id}>{bin.label}</option>)}</select>}</div>)}</div></section>}
      {error && <p className="p-error" role="alert">{error}</p>}
    </div><div className="p-dialog-actions"><button disabled={busy} onClick={onClose}>Abbrechen</button><button className="p-button" disabled={busy || reading || !chosen.length || !canImport} onClick={async () => { setBusy(true); setError(''); try { await onImport({ action: 'import', groupId, person: target, mode, entries: chosen.map(row => ({ ...row.entry, ...(mode === 'waste' ? { wasteKind: row.wasteKind } : {}) })) }); onClose() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>{busy || reading ? <LoaderCircle className="p-spin" size={16}/> : <Check size={16}/>} {busy ? 'Importiert …' : `${chosen.length} Termine übernehmen`}</button></div>
  </DialogContent></Dialog>
}

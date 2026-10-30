import { useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Plus, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PlannerGroup, PlannerSubgroup } from '@/lib/planner';
import './people-select.css';

type Draft = { id?: string; name: string; members: string[] };

// Untergruppen einer Gruppe: anlegen, umbenennen, Mitglieder zuordnen, löschen.
export default function SubgroupDialog({ group, onClose, onSave }: { group: PlannerGroup; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const subgroups = group.subgroups || [];
  const [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  const names = (s: PlannerSubgroup) => group.members.filter(m => s.members.includes(m.id)).map(m => m.name).join(', ') || 'Noch niemand';
  async function run(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await onSave({ ...body, groupId: group.id }); setDraft(null); setConfirm(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const toggle = (id: string) => draft && setDraft({ ...draft, members: draft.members.includes(id) ? draft.members.filter(m => m !== id) : [...draft.members, id] });
  return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="planner-dialog p-sub-dialog" aria-describedby={undefined} swipeToClose={!busy}>
    {!draft ? <>
      <DialogHeader><DialogTitle>Untergruppen</DialogTitle><DialogDescription>{group.name}</DialogDescription></DialogHeader>
      <div className="p-sub-list">{subgroups.map(s => <button key={s.id} type="button" className="p-sub-item" onClick={() => { setDraft({ id: s.id, name: s.name, members: s.members }); setError(''); }}>
        <b className="p-people-dot is-group" aria-hidden="true"><Users size={14}/></b><span><strong>{s.name}</strong><small>{names(s)}</small></span><ChevronRight size={17} color="#8a8398" aria-hidden="true"/></button>)}</div>
      <button type="button" className="p-sub-new" onClick={() => { setDraft({ name: '', members: [] }); setError(''); }}><Plus size={17}/>Neue Untergruppe</button>
      {group.members.length < 2 && <p className="p-sub-hint">Weitere Mitglieder kommen per Einladungscode dazu.</p>}
    </> : <>
      <DialogHeader><DialogTitle className="p-sr-only">{draft.id ? 'Untergruppe bearbeiten' : 'Neue Untergruppe'}</DialogTitle><button type="button" className="p-text-button" onClick={() => { setDraft(null); setConfirm(false); }} disabled={busy}><ArrowLeft size={16}/>Untergruppen</button></DialogHeader>
      <div className="p-form-fields">
        <label htmlFor="subgroup-name">Name</label><input id="subgroup-name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={50} placeholder="z. B. Frühschicht" autoFocus={!draft.id}/>
        <span className="p-form-label">Mitglieder</span>
        <div className="p-sub-members">{group.members.map(m => <button key={m.id} type="button" aria-pressed={draft.members.includes(m.id)} onClick={() => toggle(m.id)}><b className="p-people-dot" style={{ background: m.color }} aria-hidden="true">{m.name.slice(0, 1)}</b>{m.name}</button>)}</div>
        {error && <p className="p-error" role="alert">{error}</p>}
      </div>
      <div className="p-dialog-actions">{draft.id ? <button className="p-delete" type="button" disabled={busy} onClick={() => setConfirm(true)}>Löschen</button> : <button type="button" onClick={() => setDraft(null)} disabled={busy}>Abbrechen</button>}
        <button type="button" className="p-button" disabled={busy || !draft.name.trim() || !draft.members.length} onClick={() => void run({ action: 'subgroup-save', id: draft.id, name: draft.name.trim(), members: draft.members })}>{busy ? 'Speichert …' : 'Speichern'}<Check size={17}/></button></div>
      {confirm && draft.id && <div className="p-delete-confirm" role="alert"><p>„{draft.name}“ löschen? Bestehende Einträge bleiben.</p><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Behalten</button><button className="p-delete" type="button" disabled={busy} onClick={() => void run({ action: 'subgroup-delete', id: draft.id })}>Endgültig löschen</button></div>}
    </>}
  </DialogContent></Dialog>;
}

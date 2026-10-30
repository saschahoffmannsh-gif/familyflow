import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Settings2, Users } from 'lucide-react';
import { selectionLabel, type PlannerPerson, type PlannerSubgroup } from '@/lib/planner';
import './people-select.css';

type Props = { id: string; labelId: string; members: PlannerPerson[]; subgroups?: PlannerSubgroup[]; value: string[]; onChange: (ids: string[]) => void; open: boolean; onOpenChange: (open: boolean) => void; onManage?: () => void; disabled?: boolean };
type Option = { key: string; kind: 'all' | 'subgroup' | 'person'; label: string; ids: string[]; color?: string; count?: number };

// Chips für die Auswahl: alle → "Alle", vollständig gewählte Untergruppen als Gruppenchip, Rest als Personen.
export function selectionChips(ids: string[], members: PlannerPerson[], subgroups: PlannerSubgroup[] = []) {
  if (members.length > 1 && members.every(m => ids.includes(m.id))) return [{ key: 'all', label: 'Alle', group: true }];
  const covered = new Set<string>(), chips: { key: string; label: string; group: boolean; color?: string }[] = [];
  for (const sub of [...subgroups].filter(s => s.members.length > 1 && s.members.every(id => ids.includes(id))).sort((a, b) => b.members.length - a.members.length)) {
    if (sub.members.every(id => covered.has(id))) continue;
    sub.members.forEach(id => covered.add(id)); chips.push({ key: sub.id, label: sub.name, group: true });
  }
  for (const m of members) if (ids.includes(m.id) && !covered.has(m.id)) chips.push({ key: m.id, label: m.name, group: false, color: m.color });
  return chips;
}

export default function PeopleSelect({ id, labelId, members, subgroups = [], value, onChange, open, onOpenChange, onManage, disabled }: Props) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null);
  const options = useMemo<Option[]>(() => [
    ...(members.length > 1 ? [{ key: 'all', kind: 'all' as const, label: 'Alle Mitglieder', ids: members.map(m => m.id) }] : []),
    ...subgroups.filter(s => s.members.length).map(s => ({ key: `sub-${s.id}`, kind: 'subgroup' as const, label: s.name, ids: s.members, count: s.members.length })),
    ...members.map(m => ({ key: `p-${m.id}`, kind: 'person' as const, label: m.name, ids: [m.id], color: m.color })),
  ], [members, subgroups]);
  const [active, setActive] = useState(0);
  const isOn = (o: Option) => o.ids.length > 0 && o.ids.every(i => value.includes(i));
  const chips = selectionChips(value, members, subgroups);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => list.current?.focus({ preventScroll: true }));
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onOpenChange(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  function toggle(o: Option) {
    if (o.kind === 'all') { onChange(o.ids); return; }
    const next = isOn(o) ? value.filter(i => !o.ids.includes(i)) : [...new Set([...value, ...o.ids])];
    if (next.length) onChange(members.map(m => m.id).filter(i => next.includes(i)));
  }
  const close = () => { onOpenChange(false); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); };
  function onKey(e: React.KeyboardEvent) {
    const last = options.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(last, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) toggle(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') onOpenChange(false);
  }
  let section = '';
  return <div className="p-people-select" ref={root}>
    <button ref={trigger} id={id} type="button" className="p-cat-trigger p-people-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-labelledby={labelId} aria-description={selectionLabel(value, members, subgroups)}
      onClick={() => { setActive(0); onOpenChange(!open); }} onKeyDown={e => { if (open) onKey(e); else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onOpenChange(true); } }}>
      <span className="p-people-chips">{chips.map(c => <span key={c.key} className={`p-people-chip ${c.group ? 'is-group' : ''}`} style={c.color ? { '--chip-color': c.color } as React.CSSProperties : undefined}>{c.group ? <Users size={12} aria-hidden="true"/> : <i aria-hidden="true"/>}{c.label}</span>)}</span>
      <ChevronDown className="p-cat-chevron" size={17} aria-hidden="true"/>
    </button>
    {open && <div className="p-cat-list p-people-list">
      <ul ref={list} id={listId} role="listbox" aria-multiselectable="true" tabIndex={-1} aria-labelledby={labelId} aria-activedescendant={`${listId}-${active}`} onKeyDown={onKey}>
        {options.map((o, i) => {
          const head = o.kind !== section && o.kind !== 'all' ? (section = o.kind, o.kind === 'subgroup' ? 'Untergruppen' : 'Personen') : (section = o.kind, '');
          const on = isOn(o);
          return [head && <li key={`h-${o.kind}`} className="p-people-head" role="presentation">{head}</li>,
            <li key={o.key} id={`${listId}-${i}`} data-index={i} role="option" aria-selected={on} className={`${i === active ? 'is-active' : ''} ${on ? 'is-selected' : ''}`} onPointerMove={() => setActive(i)} onClick={() => toggle(o)}>
              {o.kind === 'person' ? <b className="p-people-dot" style={{ background: o.color }} aria-hidden="true">{o.label.slice(0, 1)}</b> : <b className="p-people-dot is-group" aria-hidden="true"><Users size={14}/></b>}
              <span>{o.label}{o.count ? <small>{o.count}</small> : null}</span>
              <em className="p-people-check" aria-hidden="true">{on && <Check size={14}/>}</em>
            </li>];
        })}
      </ul>
      <div className="p-people-foot">{onManage ? <button type="button" onClick={() => { onOpenChange(false); onManage(); }}><Settings2 size={15}/>Untergruppen</button> : <span/>}<button type="button" className="is-done" onClick={close}>Fertig</button></div>
    </div>}
  </div>;
}

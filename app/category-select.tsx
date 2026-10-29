import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PLANNER_CATEGORIES, type PlannerCategoryId } from '@/lib/planner';

type Props = { id: string; labelId: string; value: PlannerCategoryId; open: boolean; onOpenChange: (open: boolean) => void; onChange: (id: PlannerCategoryId) => void; disabled?: boolean };

export default function CategorySelect({ id, labelId, value, open, onOpenChange, onChange, disabled }: Props) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null);
  const selectedIndex = Math.max(0, PLANNER_CATEGORIES.findIndex(c => c.id === value));
  const [active, setActive] = useState(selectedIndex);
  const current = PLANNER_CATEGORIES[selectedIndex];
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => { list.current?.focus({ preventScroll: true }); list.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); });
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onOpenChange(false); };
    document.addEventListener('pointerdown', outside, true);
    const listEl = list.current, triggerEl = trigger.current;
    return () => { document.removeEventListener('pointerdown', outside, true); if (listEl && (document.activeElement === listEl || document.activeElement === document.body)) triggerEl?.focus({ preventScroll: true }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const show = (next: boolean) => { if (next) setActive(selectedIndex); onOpenChange(next); };
  const close = (focus = true) => { onOpenChange(false); if (focus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); };
  const pick = (index: number) => { onChange(PLANNER_CATEGORIES[index].id); close(); };
  function onListKey(e: React.KeyboardEvent) {
    const last = PLANNER_CATEGORIES.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(last, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(last); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  }
  const style = (c: typeof PLANNER_CATEGORIES[number]) => ({ '--category-color': c.color, '--category-bg': c.background, '--category-ink': c.ink } as React.CSSProperties);
  return <div className="p-cat-select" ref={root}>
    <button ref={trigger} id={id} type="button" className="p-cat-trigger" disabled={disabled} style={style(current)} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-labelledby={`${labelId} ${id}`}
      onClick={() => show(!open)}
      onKeyDown={e => { if (open) onListKey(e); else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(true); } }}>
      <i aria-hidden="true"/><span>{current.label}</span><ChevronDown className="p-cat-chevron" size={17} aria-hidden="true"/>
    </button>
    {open && <ul ref={list} id={listId} className="p-cat-list" role="listbox" tabIndex={-1} aria-labelledby={labelId} aria-activedescendant={`${listId}-${active}`} onKeyDown={onListKey}>
      {PLANNER_CATEGORIES.map((c, i) => <li key={c.id} id={`${listId}-${i}`} data-index={i} role="option" aria-selected={c.id === value} className={`${i === active ? 'is-active' : ''} ${c.id === value ? 'is-selected' : ''}`} style={style(c)} onPointerMove={() => setActive(i)} onClick={() => pick(i)}>
        <i aria-hidden="true"/><span>{c.label}</span>{c.id === value && <Check size={16} aria-hidden="true"/>}
      </li>)}
    </ul>}
  </div>;
}

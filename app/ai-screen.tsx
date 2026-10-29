import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ChevronRight, ImagePlus, KeyRound, LoaderCircle, Settings2, Sparkles, SunDim, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLANNER_CATEGORIES, type PlannerEvent, type PlannerGroup, type PlannerIdentity, type PlannerPerson } from '@/lib/planner';
import { clientId } from '@/lib/discussions';
import { AI_PROVIDERS, clearAiSettings, loadAiSettings, providerInfo, saveAiSettings, type AiProviderId, type AiSettings } from '@/lib/ai/settings';
import { AiError, AI_ERROR_TEXT, extractEntries, testAiKey } from '@/lib/ai/providers';
import { applyAnswer, buildAiPrompt, draftProblem, draftToEvent, mapAiResult, type AiDraft, type AiQuestion } from '@/lib/ai/schema';
import { prepareImage, type PreparedImage } from '@/lib/ai/image';
import CategorySelect from './category-select';
import './ai.css';

type Props = { group: PlannerGroup; self: PlannerPerson; identity: PlannerIdentity; onSave: (event: Partial<PlannerEvent>) => Promise<void>; onDone: (date: string) => void };
const MAX_IMAGES = 6;
const berlinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const errorText = (e: unknown) => e instanceof AiError ? e.message : (e as Error)?.message || AI_ERROR_TEXT.unknown;
const catStyle = (id: string) => { const c = PLANNER_CATEGORIES.find(c => c.id === id) || PLANNER_CATEGORIES[6]; return { '--category-color': c.color, '--category-bg': c.background, '--category-ink': c.ink } as React.CSSProperties; };

export default function AiScreen({ group, self, identity, onSave, onDone }: Props) {
  const [settings, setSettings] = useState<AiSettings | null>(() => loadAiSettings());
  const [editing, setEditing] = useState(false);
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [phase, setPhase] = useState<'pick' | 'loading' | 'review'>('pick');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [questions, setQuestions] = useState<AiQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [aiHint, setAiHint] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [attach, setAttach] = useState(true);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null), pickRef = useRef<HTMLInputElement>(null);
  const members = useMemo(() => [...group.members].sort((a, b) => Number(b.id === self.id) - Number(a.id === self.id)), [group.members, self.id]);
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => imagesRef.current.forEach(i => URL.revokeObjectURL(i.url)), []);

  if (!settings || editing) return <AiSetup initial={settings} onCancel={settings ? () => setEditing(false) : undefined} onSaved={s => { setSettings(s); setEditing(false); }} onRemoved={() => { setSettings(null); setEditing(false); }}/>;
  const provider = providerInfo(settings.provider);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setError('');
    const files = [...list].slice(0, MAX_IMAGES - images.length);
    if (list.length > files.length) toast.info(`Höchstens ${MAX_IMAGES} Bilder auf einmal.`);
    try { const prepared = await Promise.all(files.map(prepareImage)); setImages(old => [...old, ...prepared]); }
    catch (e) { setError((e as Error).message || 'Dieses Bild kann nicht gelesen werden.'); }
  }
  function reset() { images.forEach(i => URL.revokeObjectURL(i.url)); setImages([]); setDrafts([]); setQuestions([]); setQIndex(0); setAiHint(''); setError(''); setPhase('pick'); }
  async function analyze(confirmed = false) {
    if (!images.length || !settings) return;
    if (!settings.consent && !confirmed) { setConsentOpen(true); return; }
    setPhase('loading'); setError('');
    try {
      const prompt = buildAiPrompt({ today: berlinToday(), timeZone: 'Europe/Berlin', members, groupName: group.name });
      const result = await extractEntries(settings, prompt, images.map(i => ({ mime: i.mime, base64: i.base64 })));
      const mapped = mapAiResult(result, members, `ai-${Date.now().toString(36)}`);
      setDrafts(mapped.drafts); setQuestions(mapped.questions); setQIndex(0);
      setAiHint(!result.imageQuality.readable || result.imageQuality.issue !== 'none' ? result.imageQuality.note || qualityText(result.imageQuality.issue) : '');
      setPhase('review');
    } catch (e) { setError(errorText(e)); setPhase('pick'); }
  }
  function answer(q: AiQuestion, value: string) {
    if (q.draftKey) setDrafts(ds => ds.map(d => d.key === q.draftKey ? applyAnswer(d, q.field, value) : d));
    setQIndex(i => i + 1);
  }
  const update = (key: string, patch: Partial<AiDraft>) => setDrafts(ds => ds.map(d => d.key === key ? { ...d, ...patch } : d));
  const chosen = drafts.filter(d => d.include);
  const blocked = chosen.some(d => draftProblem(d));
  async function saveAll() {
    if (!chosen.length || blocked || saving) return;
    setSaving(true);
    let saved = 0, attachFailed = false, uploads = 0;
    const firstDate = [...chosen].sort((a, b) => a.date.localeCompare(b.date))[0]?.date;
    try {
      for (const d of chosen) {
        const id = clientId();
        await onSave(draftToEvent(d, group.id, id));
        saved++;
        update(d.key, { include: false });
        if (attach && images.length) {
          try { uploads += await attachPhotos(identity, id, images, 12 - uploads); } catch { attachFailed = true; }
        }
      }
      toast.success(saved === 1 ? 'Eintrag gespeichert.' : `${saved} Einträge gespeichert.`);
      if (attachFailed) toast.info('Das Foto konnte nicht in jeden Chat gelegt werden.');
      reset();
      if (firstDate) onDone(firstDate);
    } catch (e) {
      toast.error(errorText(e));
    } finally { setSaving(false); }
  }

  const localIssues = images.filter(i => i.quality !== 'ok');
  const openQuestion = phase === 'review' ? questions[qIndex] : undefined;
  return <section className="p-ai-screen" aria-labelledby="ai-title">
    <div className="p-section-heading"><div><span className="p-eyebrow">Foto zu Termin</span><h1 id="ai-title">KI</h1></div><button className="p-ai-provider" onClick={() => setEditing(true)} aria-label={`KI-Einstellungen: ${provider.name}`}><Settings2 size={16}/>{provider.name}</button></div>
    {error && <div className="p-ai-alert" role="alert"><TriangleAlert size={18}/><span>{error}</span></div>}
    {phase !== 'review' && <div className="p-ai-card">
      <div className="p-ai-pick">
        <button type="button" className="p-ai-pick-main" onClick={() => cameraRef.current?.click()} disabled={phase === 'loading' || images.length >= MAX_IMAGES}><Camera size={26}/><strong>Foto aufnehmen</strong></button>
        <button type="button" className="p-ai-pick-side" onClick={() => pickRef.current?.click()} disabled={phase === 'loading' || images.length >= MAX_IMAGES}><ImagePlus size={22}/><span>Bilder wählen</span></button>
        <input ref={cameraRef} className="p-sr-only" type="file" accept="image/*" capture="environment" aria-label="Foto aufnehmen" onChange={e => { void addFiles(e.target.files); e.target.value = ''; }}/>
        <input ref={pickRef} className="p-sr-only" type="file" accept="image/*" multiple aria-label="Bilder wählen" data-testid="ai-file" onChange={e => { void addFiles(e.target.files); e.target.value = ''; }}/>
      </div>
      {images.length > 0 && <ul className="p-ai-thumbs" aria-label="Ausgewählte Bilder">{images.map(img => <li key={img.id}><img src={img.url} alt=""/>{img.quality !== 'ok' && <span className="p-ai-thumb-flag" title={img.quality === 'dark' ? 'Zu dunkel' : 'Unscharf'}><SunDim size={13}/></span>}<button type="button" disabled={phase === 'loading'} onClick={() => { URL.revokeObjectURL(img.url); setImages(list => list.filter(i => i.id !== img.id)); }} aria-label="Bild entfernen"><X size={14}/></button></li>)}</ul>}
      {localIssues.length > 0 && <p className="p-ai-hint"><SunDim size={16}/>{localIssues.some(i => i.quality === 'dark') ? 'Ein Foto ist recht dunkel.' : 'Ein Foto wirkt unscharf.'} Besser neu aufnehmen?</p>}
      <button type="button" className="p-button p-ai-run" disabled={!images.length || phase === 'loading'} onClick={() => void analyze()}>{phase === 'loading' ? <><LoaderCircle className="p-spin" size={18}/>Wird ausgewertet …</> : <><Sparkles size={18}/>Auswerten</>}</button>
    </div>}
    {phase === 'review' && <>
      {(aiHint || localIssues.length > 0) && <div className="p-ai-alert p-ai-alert--soft"><SunDim size={18}/><span>{aiHint || 'Das Foto ist schwer lesbar.'} Bitte Vorschläge prüfen.</span></div>}
      {openQuestion && <QuestionCard key={openQuestion.id} q={openQuestion} index={qIndex} total={questions.length} draft={drafts.find(d => d.key === openQuestion.draftKey)} onAnswer={v => answer(openQuestion, v)} onSkip={() => setQIndex(i => i + 1)}/>}
      {!openQuestion && <>
        {drafts.length === 0 ? <div className="p-ai-card p-ai-empty"><Sparkles size={22}/><strong>Keine Termine erkannt</strong><button className="p-secondary-button" onClick={reset}>Neues Foto</button></div> : <>
          <ul className="p-ai-drafts" aria-label="Vorschläge">{drafts.map(d => <DraftCard key={d.key} draft={d} members={members} onChange={patch => update(d.key, patch)}/>)}</ul>
          {images.length > 0 && <label className="p-ai-attach"><input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)}/><span>Foto in den Chat legen</span></label>}
          <div className="p-ai-actions"><button type="button" onClick={reset} disabled={saving}>Verwerfen</button><button type="button" className="p-button" disabled={!chosen.length || blocked || saving} onClick={() => void saveAll()}>{saving ? 'Speichert …' : chosen.length === 1 ? '1 Eintrag speichern' : `${chosen.length} Einträge speichern`}<Check size={17}/></button></div>
        </>}
      </>}
    </>}
    <Dialog open={consentOpen} onOpenChange={setConsentOpen}><DialogContent className="planner-dialog p-ai-consent"><DialogHeader><DialogTitle>Fotos an {provider.name} senden?</DialogTitle><DialogDescription>Die Bilder gehen direkt von diesem Gerät an {provider.name} und werden dort ausgewertet.</DialogDescription></DialogHeader><div className="p-dialog-actions"><button type="button" onClick={() => setConsentOpen(false)}>Abbrechen</button><button type="button" className="p-button" onClick={() => { const next = { ...settings, consent: true }; saveAiSettings(next); setSettings(next); setConsentOpen(false); void analyze(true); }}>Verstanden<Check size={17}/></button></div></DialogContent></Dialog>
  </section>;
}

function qualityText(issue: string) {
  return issue === 'dark' ? 'Das Foto ist zu dunkel.' : issue === 'blurry' ? 'Das Foto ist unscharf.' : issue === 'cut_off' ? 'Das Foto ist abgeschnitten.' : issue === 'no_dates' ? 'Auf dem Foto stehen keine Termine.' : 'Das Foto ist schwer lesbar.';
}

async function attachPhotos(identity: PlannerIdentity, entryId: string, images: PreparedImage[], budget: number) {
  if (budget <= 0) return 0;
  const auth = { Authorization: `Bearer ${identity.key}` };
  const opened = await fetch('/api/discussions', { method: 'POST', cache: 'no-store', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open', kind: 'event', id: entryId }) });
  const thread = await opened.json() as { id?: string };
  if (!opened.ok || !thread.id) throw new Error('chat');
  let n = 0;
  for (const img of images.slice(0, budget)) {
    const form = new FormData(); form.set('threadId', thread.id); form.set('file', new File([img.blob], img.name, { type: 'image/jpeg' })); form.set('caption', '');
    const r = await fetch('/api/discussions/attachments', { method: 'POST', cache: 'no-store', headers: auth, body: form });
    if (!r.ok) throw new Error('upload');
    n++;
  }
  return n;
}

function QuestionCard({ q, index, total, draft, onAnswer, onSkip }: { q: AiQuestion; index: number; total: number; draft?: AiDraft; onAnswer: (v: string) => void; onSkip: () => void }) {
  const [value, setValue] = useState(q.field === 'date' ? draft?.date || '' : q.field === 'time' ? draft?.time || '' : '');
  const input = q.field === 'date' || q.field === 'endDate' || q.field === 'time';
  return <div className="p-ai-card p-ai-question" role="group" aria-labelledby={`${q.id}-q`}>
    <div className="p-ai-question-top"><span className="p-ai-step">{index + 1}/{total}</span>{draft && <span className="p-ai-question-entry" style={catStyle(draft.categoryId)}><i/>{draft.title}</span>}</div>
    <h2 id={`${q.id}-q`}>{q.question}</h2>
    {!input && q.options.length > 0 && <div className="p-ai-chips">{q.options.map(o => <button key={o.value} type="button" style={q.field === 'category' ? catStyle(o.value) : undefined} className={q.field === 'category' ? 'p-ai-chip p-ai-chip--cat' : 'p-ai-chip'} onClick={() => onAnswer(o.value)}>{q.field === 'category' && <i/>}{o.label}</button>)}</div>}
    {input && <form className="p-ai-question-input" onSubmit={e => { e.preventDefault(); if (value) onAnswer(value); }}><input type={q.field === 'time' ? 'time' : 'date'} value={value} onChange={e => setValue(e.target.value)} onInput={e => setValue(e.currentTarget.value)} aria-label={q.question} autoFocus/><button className="p-button" disabled={!value}>OK<Check size={16}/></button></form>}
    <button type="button" className="p-ai-skip" onClick={onSkip}>{q.required ? 'Später' : q.field === 'general' && !q.options.length ? 'Weiter' : 'Überspringen'}<ChevronRight size={15}/></button>
  </div>;
}

function DraftCard({ draft: d, members, onChange }: { draft: AiDraft; members: PlannerPerson[]; onChange: (patch: Partial<AiDraft>) => void }) {
  const [catOpen, setCatOpen] = useState(false);
  const problem = draftProblem(d), task = d.categoryId === 'task';
  return <li className={`p-ai-draft ${d.include ? '' : 'is-off'}`} style={catStyle(d.categoryId)}>
    <div className="p-ai-draft-head"><label className="p-ai-check"><input type="checkbox" checked={d.include} onChange={e => onChange({ include: e.target.checked })} aria-label={`${d.title} übernehmen`}/><span/></label><input className="p-ai-title" value={d.title} onChange={e => onChange({ title: e.target.value })} maxLength={120} aria-label="Titel" placeholder="Titel"/></div>
    {d.include && <div className="p-ai-draft-fields">
      <div className="p-form-row"><input type="date" value={d.date} onChange={e => onChange({ date: e.target.value })} onInput={e => onChange({ date: e.currentTarget.value })} aria-label="Datum"/><input type="time" value={d.time} onChange={e => onChange({ time: e.target.value })} onInput={e => onChange({ time: e.currentTarget.value })} aria-label="Uhrzeit"/></div>
      <div className="p-form-row"><select value={d.person} onChange={e => onChange({ person: e.target.value })} aria-label="Kalender"><option value="" disabled>Kalender …</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}{!task && <option value="all">Alle Mitglieder</option>}</select><span className="p-sr-only" id={`${d.key}-art`}>Art</span><CategorySelect id={`${d.key}-cat`} labelId={`${d.key}-art`} value={d.categoryId} open={catOpen} onOpenChange={setCatOpen} onChange={id => onChange({ categoryId: id, person: id === 'task' && d.person === 'all' ? '' : d.person })}/></div>
      {d.endDate && <p className="p-ai-range">bis {new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${d.endDate}T12:00:00`))}<button type="button" onClick={() => onChange({ endDate: '' })} aria-label="Enddatum entfernen"><X size={13}/></button></p>}
      {problem && <p className="p-ai-problem" role="status"><TriangleAlert size={14}/>{problem}</p>}
    </div>}
  </li>;
}

function AiSetup({ initial, onSaved, onRemoved, onCancel }: { initial: AiSettings | null; onSaved: (s: AiSettings) => void; onRemoved: () => void; onCancel?: () => void }) {
  const [provider, setProvider] = useState<AiProviderId>(initial?.provider || 'openai');
  const [model, setModel] = useState(initial?.model || providerInfo(initial?.provider || 'openai').defaultModel);
  const [apiKey, setApiKey] = useState(initial?.apiKey || '');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; text: string } | null>(null);
  const info = providerInfo(provider);
  const current = (): AiSettings => ({ provider, model: model.trim() || info.defaultModel, apiKey: apiKey.trim(), consent: initial?.provider === provider ? initial.consent : false });
  function choose(id: AiProviderId) { setProvider(id); if (!model.trim() || AI_PROVIDERS.some(p => p.defaultModel === model.trim())) setModel(providerInfo(id).defaultModel); setStatus(null); }
  async function test() {
    if (!apiKey.trim()) return;
    setStatus({ kind: 'busy', text: 'Wird geprüft …' });
    try { await testAiKey(current()); setStatus({ kind: 'ok', text: 'Schlüssel funktioniert.' }); }
    catch (e) { setStatus({ kind: 'error', text: errorText(e) }); }
  }
  return <section className="p-ai-screen" aria-labelledby="ai-setup-title">
    <div className="p-section-heading"><div><span className="p-eyebrow">Foto zu Termin</span><h1 id="ai-setup-title">KI einrichten</h1></div>{onCancel && <button className="p-icon-button" onClick={onCancel} aria-label="Schließen"><X size={20}/></button>}</div>
    <form className="p-ai-card p-ai-setup p-form-fields" onSubmit={e => { e.preventDefault(); const s = current(); if (!s.apiKey) return; saveAiSettings(s); toast.success('KI eingerichtet.'); onSaved(s); }}>
      <span className="p-form-label" id="ai-provider-label">Anbieter</span>
      <div className="p-ai-providers" role="radiogroup" aria-labelledby="ai-provider-label">{AI_PROVIDERS.map(p => <button key={p.id} type="button" role="radio" aria-checked={provider === p.id} className={provider === p.id ? 'active' : ''} onClick={() => choose(p.id)}>{p.name}{provider === p.id && <Check size={14}/>}</button>)}</div>
      <label htmlFor="ai-key">API-Schlüssel</label>
      <input id="ai-key" type="password" value={apiKey} onChange={e => { setApiKey(e.target.value); setStatus(null); }} placeholder={info.keyHint} autoComplete="off" autoCapitalize="off" spellCheck={false} required/>
      <label htmlFor="ai-model">Modell</label>
      <input id="ai-model" value={model} onChange={e => { setModel(e.target.value); setStatus(null); }} placeholder={info.defaultModel} autoCapitalize="off" spellCheck={false}/>
      <p className="p-ai-note"><KeyRound size={14}/>Bleibt nur auf diesem Gerät. <a href={info.keyUrl} target="_blank" rel="noreferrer">Schlüssel holen</a></p>
      {status && <p className={`p-ai-status p-ai-status--${status.kind}`} role="status">{status.kind === 'busy' ? <LoaderCircle className="p-spin" size={15}/> : status.kind === 'ok' ? <Check size={15}/> : <TriangleAlert size={15}/>}{status.text}</p>}
      <div className="p-ai-setup-actions"><button type="button" className="p-secondary-button" disabled={!apiKey.trim() || status?.kind === 'busy'} onClick={() => void test()}>Schlüssel testen</button><button className="p-button" disabled={!apiKey.trim()}>Speichern<Check size={17}/></button></div>
      {initial && <button type="button" className="p-ai-remove" onClick={() => { clearAiSettings(); toast.success('Schlüssel entfernt.'); onRemoved(); }}><Trash2 size={15}/>Schlüssel entfernen</button>}
    </form>
  </section>;
}

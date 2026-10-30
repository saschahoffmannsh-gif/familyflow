'use client';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share2, ClipboardCheck, Upload, Trash2, ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CirclePlus, Copy, Gift, Home, LayoutGrid, ListTodo, LoaderCircle, Palmtree, Plus, RefreshCw, Sun, Users, X } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
const FamilyFlowApp = lazy(() => import('./family-flow'));
const PlannerImportDialog = lazy(() => import('./planner-import'));
import { PLANNER_CATEGORIES, PLANNER_WASTE_CATEGORIES, swipeMonthOffset, plannerCategory, type PlannerCategoryId, belongsTo, normalizeSelection, offeredTo, selectionLabel, selectionOf, coversDay, dayContext, dayKey, fromDay, LEGACY_PEOPLE, monthDays, type PlannerData, type PlannerEvent, type PlannerGroup, type PlannerIdentity, type PlannerPerson } from '@/lib/planner';
import './planner.css';
import './entry-chat.css';
import { familyFlowCloudStorage } from '@/lib/familyflow-storage';
import ChatLaunch from './chat-launch';
import CategorySelect from './category-select';
import PeopleSelect from './people-select';
import SubgroupDialog from './subgroup-dialog';
import ActivityBadges from './entry-activity';
import EntryChat, { type ChatTarget } from './entry-chat';
import ReminderListener from './reminder-listener';
import { clientId } from '@/lib/discussions';
import { unchangedChatDraft } from '@/lib/chat-draft';
import { APP_BASE, appPath } from '@/lib/app-base'
const IDENTITY_KEY = 'dmd:planner-identity:v1';
const GROUP_KEY = 'dmd:planner-group:v1';
const fmt = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('de-DE', options).format(fromDay(date));
const longDay = (day: string) => fmt(day, { weekday: 'long', day: 'numeric', month: 'long' });
const legacyPhoto = (id: string) => LEGACY_PEOPLE.some(p => p.id === id) ? appPath(`/profiles/${id}.jpeg`) : undefined;
function Avatar({ person, small = false }: {
    person: PlannerPerson;
    small?: boolean;
}) {
    const photo = legacyPhoto(person.id);
    return <span className={`p-avatar ${small ? 'p-avatar--small' : ''}`} style={{ background: `${person.color}18`, color: person.color }}>{photo ? <img src={photo} alt=""/> : person.name.slice(0, 2).toUpperCase()}</span>;
}
function Brand() { return <span className="p-brand"><span className="p-brand-mark"><img src={appPath("/branding/handoff-v1-logo-128.png")} width={128} height={128} alt="" decoding="async" /></span><span><strong>Done</strong><small>Dein Tag. Eure Pläne.</small></span></span>; }
function GroupIcon({ group }: {
    group: PlannerGroup;
}) { return <span className="p-group-icon" style={{ color: group.color, background: `${group.color}15` }}>{group.category === 'Arbeit' ? <BriefcaseBusiness /> : group.category === 'Familie' ? <Home /> : <Users />}</span>; }
function CategoryIcon({ event }: { event: PlannerEvent }) {
    const id = plannerCategory(event).id;
    const Icon = event.wasteKind ? Trash2 : id === 'task' ? CircleCheck : id === 'work' ? BriefcaseBusiness : id === 'vacation' ? Palmtree : id === 'holidays' ? Sun : id === 'birthday' ? Gift : id === 'private' ? Users : CalendarDays;
    return <Icon size={13} aria-hidden="true" />;
}
export default function PlannerApp() {
    const [identity, setIdentity] = useState<PlannerIdentity | null>(null);
    const markRead = useCallback((threadId: string) => { if (!identity) return; void fetch('/api/inbox', { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${identity.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', threadId }) }).catch(() => undefined); }, [identity?.key]);
    const [openTasks, setOpenTasks] = useState(0);
    useEffect(() => {
        if (!identity || !LEGACY_PEOPLE.some(p => p.id === identity.id)) { setOpenTasks(0); return; }
        let active = true;
        const load = () => { if (document.visibilityState !== 'visible') return; familyFlowCloudStorage.loadTodoItems().then(items => { if (active) setOpenTasks(items.filter(item => item.kind === 'task' && offeredTo(item, identity.id)).length); }).catch(() => undefined); };
        load();
        const timer = window.setInterval(load, 10000);
        document.addEventListener('visibilitychange', load); window.addEventListener('online', load);
        return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', load); window.removeEventListener('online', load); };
    }, [identity?.id, identity?.key]);
    const [data, setData] = useState<PlannerData | null>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [screen, setScreen] = useState<'home' | 'calendar' | 'lists'>('calendar');
    const [agendaFilter, setAgendaFilter] = useState<'all' | 'events' | 'tasks'>('all');
    const [groupId, setGroupId] = useState('family');
    const [personId, setPersonId] = useState('');
    const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
    const [today, setToday] = useState(() => dayKey(new Date()));
    const [day, setDay] = useState(() => dayKey(new Date()));
    const [dayOpen, setDayOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [wasteOpen, setWasteOpen] = useState<PlannerEvent | null>(null);
    const [wasteBusy, setWasteBusy] = useState(false);
    const [monthDirection, setMonthDirection] = useState('');
    const swipeStart = useRef<{ x: number; y: number; at: number } | null>(null);
    const suppressClickUntil = useRef(0);
    const [switchOpen, setSwitchOpen] = useState(false);
    const [groupDialog, setGroupDialog] = useState<'create' | 'join' | null>(null);
    const [invite, setInvite] = useState<PlannerGroup | null>(null);
    const [editor, setEditor] = useState<Partial<PlannerEvent> | null>(null);
    const [onboardingName, setOnboardingName] = useState('');
    const [legacyChoice, setLegacyChoice] = useState('');
    const [legacyCode, setLegacyCode] = useState('');
    const [onboardingBusy, setOnboardingBusy] = useState(false);
    const pendingInvite = useRef('');
    const [chat, setChat] = useState<ChatTarget | null>(null);
    const pendingShare = useRef('');
    const busyRef = useRef(false);
    const identityRef = useRef<PlannerIdentity | null>(null);
    const loadSequence = useRef(0);
    const request = useCallback(async (method: string, body?: unknown, session = identityRef.current) => {
        const response = await fetch('/api/planner', { method, cache: 'no-store', headers: { ...(session ? { Authorization: `Bearer ${session.key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const result = await response.json().catch(() => { throw new Error('Die Verbindung zum Kalender konnte nicht hergestellt werden. Bitte erneut versuchen.'); }) as PlannerData & {
            identity?: PlannerIdentity;
            selectedGroupId?: string; importSummary?: { imported: number; duplicates: number };
            error?: string;
        };
        if (!response.ok)
            throw new Error(result.error || 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
        return result as PlannerData & {
            identity?: PlannerIdentity;
            selectedGroupId?: string; importSummary?: { imported: number; duplicates: number };
        };
    }, []);
    const acceptData = useCallback((next: PlannerData) => { setData(next); setError(''); }, []);
    const refresh = useCallback(async () => {
        if (!identityRef.current || busyRef.current)
            return;
        const seq = ++loadSequence.current;
        setSyncing(true);
        try {
            const next = await request('GET');
            if (seq === loadSequence.current)
                acceptData(next);
        }
        catch (e) {
            if (seq === loadSequence.current)
                setError((e as Error).message);
        }
        finally {
            if (seq === loadSequence.current)
                setSyncing(false);
        }
    }, [request, acceptData]);
    const signIn = useCallback(async (action: 'profile' | 'legacy', value: string, code?: string) => {
        setOnboardingBusy(true);
        try {
            const result = await request('POST', action === 'legacy' ? { action, id: value, code } : { action, name: value });
            const session = result.identity!;
            window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(session));
            identityRef.current = session;
            setIdentity(session);
            setPersonId(session.id);
            acceptData(result);
            if (pendingShare.current) setChat({ shareToken: pendingShare.current });
            if (pendingInvite.current)
                setGroupDialog('join');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setOnboardingBusy(false);
            setReady(true);
        }
    }, [request, acceptData]);
    useEffect(() => {
        let active = true;
        const params = new URLSearchParams(window.location.search);
        pendingInvite.current = params.get('invite') || '';
        pendingShare.current = params.get('share') || '';
        if (pendingShare.current) setChat({ shareToken: pendingShare.current });
        else if (params.get('thread')) setChat({ threadId: params.get('thread')! });
        const savedGroup = window.localStorage.getItem(GROUP_KEY);
        if (savedGroup)
            setGroupId(savedGroup);
        let session: PlannerIdentity | null = null;
        try {
            session = JSON.parse(window.localStorage.getItem(IDENTITY_KEY) || 'null');
        }
        catch { /* choose profile */ }
        if (session?.key && session.id) {
            identityRef.current = session;
            setIdentity(session);
            setPersonId(session.id);
            void request('GET', undefined, session).then(result => { if (active) {
                acceptData(result);
                if (pendingInvite.current)
                    setGroupDialog('join');
            } }).catch(e => { if (active)
                setError(e.message); }).finally(() => active && setReady(true));
        }
        else {
            const old = window.localStorage.getItem('familyflow:device-user:v1');
            if (old && LEGACY_PEOPLE.some(p => p.id === old))
                setLegacyChoice(old);
            setReady(true);
        }
        if ('serviceWorker' in navigator)
            void navigator.serviceWorker.register(appPath('/sw.js'), { scope: APP_BASE }).then(r => r.update()).catch(() => { });
        return () => { active = false; };
    }, [request, acceptData, signIn]);
    useEffect(() => {
        if (!identity)
            return;
        const activate = () => {
            if (document.visibilityState !== 'visible')
                return;
            setToday(dayKey(new Date()));
            setPersonId(identity.id);
            void refresh();
        };
        const interval = window.setInterval(() => { if (document.visibilityState === 'visible')
            void refresh(); }, 10000);
        window.addEventListener('pageshow', activate);
        document.addEventListener('visibilitychange', activate);
        window.addEventListener('online', refresh);
        return () => { clearInterval(interval); window.removeEventListener('pageshow', activate); document.removeEventListener('visibilitychange', activate); window.removeEventListener('online', refresh); };
    }, [identity, refresh]);
    const group = data?.groups.find(g => g.id === groupId) || data?.groups[0];
    const self = data?.profile;
    const members = [...(group?.members || [])].sort((a, b) => Number(b.id === self?.id) - Number(a.id === self?.id));
    const selected = group?.members.find(p => p.id === personId) || self;
    const selectedId = selected?.id || '';
    const groupEvents = useMemo(() => data?.events.filter(e => e.groupId === group?.id) || [], [data, group?.id]);
    const visibleEvents = useMemo(() => groupEvents.filter(e => belongsTo(e, selectedId)), [groupEvents, selectedId]);
    const context = dayContext(data?.events || [], group?.id || '', selectedId, self?.id || '', day);
    const cells = monthDays(month);
    const weekEnd = fromDay(today);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const upcoming = (data?.events || []).filter(e => belongsTo(e, self?.id || '') && (e.endDate || e.date) >= today && e.date <= dayKey(weekEnd) && !e.completed).sort((a, b) => (a.date < today ? today : a.date).localeCompare(b.date < today ? today : b.date) || (a.time || (a.wasteKind ? '05:00' : '99:99')).localeCompare(b.time || (b.wasteKind ? '05:00' : '99:99')));
    const isTask = (event: PlannerEvent) => event.kind === 'task' || event.eventType === 'task';
    const filteredUpcoming = upcoming.filter(event => agendaFilter === 'all' || (agendaFilter === 'tasks' ? isTask(event) : !isTask(event)));
    const agendaDays = new Map<string, PlannerEvent[]>();
    for (const event of filteredUpcoming) {
        const key = event.date < today ? today : event.date;
        agendaDays.set(key, [...(agendaDays.get(key) || []), event]);
    }
    const tomorrow = fromDay(today); tomorrow.setDate(tomorrow.getDate() + 1);
    function selectGroup(id: string) { setGroupId(id); window.localStorage.setItem(GROUP_KEY, id); setPersonId(self!.id); setDayOpen(false); setSwitchOpen(false); }
    function navigate(next: typeof screen) { setScreen(next); if (next === 'calendar')
        setPersonId(self?.id || ''); }
    function openDay(key: string) { if (Date.now() < suppressClickUntil.current) return; setDay(key); setDayOpen(!window.matchMedia('(min-width: 1100px)').matches); const date = fromDay(key); setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12)); }
    async function mutate(method: string, body: unknown) {
        busyRef.current = true;
        ++loadSequence.current;
        setSyncing(true);
        try {
            const result = await request(method, body);
            acceptData(result);
            return result;
        }
        finally {
            busyRef.current = false;
            setSyncing(false);
        }
    }
    function startCreate(kind: 'event' | 'task' = 'event') { if (!group)
        return; setDayOpen(false); setEditor({ groupId: group.id, date: screen === 'home' ? today : day, person: screen === 'home' ? self?.id : selectedId, kind, eventType: kind === 'task' ? 'task' : 'private' }); }
    function openEvent(event: PlannerEvent) { setDayOpen(false); if (event.sharedThreadId) { setChat({ threadId: event.sharedThreadId, preview: {...event,kind:event.kind==='task'||event.eventType==='task'?'task':'event'} }); return } if (event.wasteKind) { setWasteOpen(event); return } setEditor(event); }
    function changeMonth(offset: number) { setMonthDirection(offset > 0 ? 'next' : 'previous'); setMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12)); }
    async function toggleWaste(event: PlannerEvent) { if (wasteBusy) return; setWasteBusy(true); try { await mutate('POST', { action: 'waste-status', id: event.id, completed: !event.completed }); setWasteOpen(null); toast.success(event.completed ? 'Bestätigung zurückgenommen.' : event.groupId === 'family' ? 'Für euch beide als rausgestellt bestätigt.' : 'Als rausgestellt bestätigt.'); } catch (error) { toast.error((error as Error).message) } finally { setWasteBusy(false) } }
    const personFor = (id: string) => data?.groups.flatMap(g => g.members).find(p => p.id === id);
    const groupFor = (id: string) => data?.groups.find(g => g.id === id);
    function eventCard(event: PlannerEvent, showGroup = false) {
        const owner = personFor(event.person), eventGroup = groupFor(event.groupId), category = plannerCategory(event);
        return <button className={`p-event ${event.completed ? 'p-event--done' : ''}`} key={event.id} onClick={() => openEvent(event)} style={{ '--event-color': category.color, '--event-background': category.background, '--event-ink': category.ink } as React.CSSProperties}>
      <span className={`p-event-time ${!event.time ? 'p-event-time--all-day' : ''}`}>{event.time || 'Ganztägig'}{event.endDate && <small>bis {fmt(event.endDate, { day: '2-digit', month: '2-digit' })}</small>}</span>
      <span className="p-event-copy"><strong>{event.title}</strong><span className="p-event-meta">{event.wasteKind && event.groupId === 'family' ? 'Sascha & Katharina' : event.audience?.length ? selectionLabel(event.audience, eventGroup?.members || [], eventGroup?.subgroups) : event.person === 'all' ? 'Alle Mitglieder' : owner?.name || 'Mitglied'}{showGroup && eventGroup ? ` · ${eventGroup.name}` : ''}</span><span className="p-event-content"><span className="p-event-category"><CategoryIcon event={event}/>{category.label}</span><ActivityBadges activity={event.activity}/></span>{!showGroup && event.note && <span className="p-event-note">{event.note}</span>}</span>
      <ChevronRight className="p-event-chevron" size={18} aria-hidden="true"/>
    </button>;
    }
    function dayDetails() {
        return <>
    <div className="p-day-heading"><span className="p-eyebrow">{group?.name}</span><h2>{longDay(day)}</h2><p>Der Tag im Überblick</p></div>
    <div className="p-day-section"><h3>{selectedId === self?.id ? 'Dein Kalender' : `${selected?.name}s Kalender`}<span>{context.selected.length}</span></h3>{context.selected.length ? context.selected.map(e => eventCard(e)) : <p className="p-empty-inline">Hier ist noch nichts geplant.</p>}</div>
    <div className="p-create-actions"><button className="p-button" onClick={() => startCreate()}><CalendarDays size={17}/> Termin eintragen</button><button className="p-secondary-button p-create-task" onClick={() => startCreate('task')}><ClipboardCheck size={17}/> Auftrag eintragen</button></div>
    <div className="p-day-section p-day-section--others"><h3>Auch in {group?.name}<span>{context.others.length}</span></h3><p className="p-section-note">Termine der anderen Gruppenmitglieder</p>{context.others.length ? context.others.map(e => eventCard(e)) : <p className="p-empty-inline">Keine weiteren Termine an diesem Tag.</p>}</div>
    <div className="p-day-section p-day-section--external"><h3><LayoutGrid size={16}/> Deine weiteren Gruppen</h3><p className="p-section-note">Deine Termine außerhalb von {group?.name}</p>{context.external.length ? context.external.map(e => eventCard(e, true)) : <p className="p-empty-inline">In deinen anderen Gruppen steht nichts an.</p>}</div>
  </>;
    }
    const chatView = chat ? <EntryChat key={chat.shareToken || chat.threadId || `${chat.entry?.kind}:${chat.entry?.id}`} target={chat} identity={identity} onRead={markRead} groups={data?.groups || []} onClose={() => { setChat(null); void refresh(); pendingShare.current = ''; const url = new URL(window.location.href); url.searchParams.delete('share'); url.searchParams.delete('thread'); window.history.replaceState(null, '', url.pathname + url.search); }} onSignIn={() => { setChat(null); toast.info('Öffne dein Profil. Danach geht es direkt zurück zum geteilten Termin.'); }} onImported={(id, date) => { if (id) selectGroup(id); if (date) { setDay(date); const d = fromDay(date); setMonth(new Date(d.getFullYear(), d.getMonth(), 1, 12)); } setScreen('calendar'); void refresh(); }}/> : null;
    if (ready && !data && chat) return <main className="planner">{chatView}<Toaster position="top-center" richColors/></main>;
    if (!ready)
        return <main className="planner p-loading"><Brand /><LoaderCircle className="p-spin"/><p>Deine Kalender werden geladen …</p></main>;
    if (!data)
        return <main className="planner p-onboarding"><Brand /><section><span className="p-eyebrow">Gemeinsam planen</span><h1>Viele Gruppen.<br />Dein Überblick.</h1><p>Familie, Arbeit oder Team – mit einem eigenen Kalender für jedes Mitglied.</p><h2>Dein bisheriges Profil</h2><div className="p-existing-profiles">{LEGACY_PEOPLE.map(p => <button key={p.id} disabled={onboardingBusy} aria-pressed={legacyChoice === p.id} onClick={() => setLegacyChoice(p.id)}><Avatar person={p}/><strong>{p.name}</strong></button>)}</div>{legacyChoice && <form className="p-legacy-login" onSubmit={e => { e.preventDefault(); void signIn('legacy', legacyChoice, legacyCode); }}><label htmlFor="legacy-code">Bisheriger Änderungscode</label><input id="legacy-code" type="password" autoComplete="current-password" value={legacyCode} onChange={e => setLegacyCode(e.target.value)} required placeholder="Dein bestehender Code"/><button className="p-button" disabled={onboardingBusy || !legacyCode}>Profil öffnen<ArrowRight size={16}/></button></form>}<div className="p-divider">Neu hier?</div><form onSubmit={e => { e.preventDefault(); void signIn('profile', onboardingName); }}><label htmlFor="profile-name">Dein Name</label><input id="profile-name" value={onboardingName} onChange={e => setOnboardingName(e.target.value)} maxLength={50} required placeholder="Wie heißt du?"/><button className="p-button" disabled={onboardingBusy || !onboardingName.trim()}>{onboardingBusy ? 'Lädt …' : 'Eigenes Profil anlegen'}<ArrowRight size={17}/></button></form>{error && <p className="p-error" role="alert">{error}</p>}</section><Toaster /></main>;
    return <main className="planner">
    <header className="p-topbar"><Brand /><div className="p-top-actions"><button className={`p-icon-button ${syncing ? 'p-spin' : ''}`} onClick={() => void refresh()} aria-label="Kalender aktualisieren"><RefreshCw size={18}/></button><Avatar person={data.profile}/><span className="p-top-name">{data.profile.name}</span></div></header>
    <div className="p-layout"><aside className="p-sidebar"><p className="p-eyebrow">Dein Planer</p><nav aria-label="Hauptnavigation">{([{ id: 'home', title: 'Übersicht', icon: <Home /> }, { id: 'calendar', title: 'Kalender', icon: <CalendarDays /> }] as const).map(item => <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => navigate(item.id)} aria-current={screen === item.id ? 'page' : undefined}>{item.icon}<span>{item.title}</span></button>)}{LEGACY_PEOPLE.some(p => p.id === self?.id) && <button className={screen === 'lists' ? 'active' : ''} aria-current={screen === 'lists' ? 'page' : undefined} onClick={() => { window.localStorage.setItem('familyflow:device-user:v1', self!.id); navigate('lists'); }}><ListTodo /><span>Listen</span>{openTasks>0&&<span className="p-count-badge" aria-label={`${openTasks} ${openTasks===1?'offener Auftrag':'offene Aufträge'}`}>{openTasks>99?'99+':openTasks}</span>}</button>}</nav><div className="p-sidebar-groups"><p className="p-eyebrow">Deine Gruppen</p>{data.groups.map(g => <button key={g.id} className={group?.id === g.id ? 'selected' : ''} onClick={() => { selectGroup(g.id); navigate('calendar'); }}><i style={{ background: g.color }}/>{g.name}<ChevronRight size={13}/></button>)}</div><div className="p-sidebar-note"><CalendarDays /><strong>Platz für alle Pläne.</strong><span>Ein Kalender pro Person.<br />Eine Gruppe pro Lebensbereich.</span></div></aside>
    <div className="p-main">
      {error && <div className="p-error-banner" role="alert"><span>{error} Deine Ansicht bleibt erhalten.</span><button onClick={() => void refresh()}>Erneut versuchen</button></div>}
      {screen !== 'lists' && group && <div className="p-group-bar"><button className="p-group-switch" onClick={() => setSwitchOpen(true)} aria-label={`Gruppe wechseln: ${group.name}`}><GroupIcon group={group}/><span><strong>{group.name}</strong><small>{group.members.length} {group.members.length === 1 ? 'Mitglied' : 'Mitglieder'}</small></span><ChevronDown size={17}/></button>{screen === 'home' && <button className="p-icon-button p-quick-add" onClick={() => startCreate()} aria-label="Termin erstellen"><Plus size={22}/></button>}<button className="p-text-button p-invite-button" onClick={() => setInvite(group)} aria-label={`Zu ${group.name} einladen`}><Users size={17}/><span>Einladen</span></button></div>}
      {screen === 'home' && <section className="p-home" aria-labelledby="overview-title">
        <header className="p-overview-heading"><h1 id="overview-title">Dein Überblick</h1><p>{longDay(today)}</p><span>Deine nächsten 7 Tage · alle Gruppen</span></header>
        <div className="p-agenda-filters" role="group" aria-label="Einträge filtern">{([{ id: 'all', label: 'Alle', count: upcoming.length }, { id: 'events', label: 'Termine', count: upcoming.filter(event => !isTask(event)).length }, { id: 'tasks', label: 'Aufträge', count: upcoming.filter(isTask).length }] as const).map(filter => <button key={filter.id} aria-pressed={agendaFilter === filter.id} onClick={() => setAgendaFilter(filter.id)}>{filter.label}<span>{filter.count}</span></button>)}</div>
        {filteredUpcoming.length ? <div className="p-agenda">{Array.from(agendaDays, ([key, events]) => <section className="p-agenda-day" key={key} aria-labelledby={`agenda-${key}`}><header className="p-agenda-day-heading"><span className="p-agenda-date" aria-hidden="true" title={longDay(key)}>{fmt(key, { day: '2-digit' })}</span><h2 id={`agenda-${key}`}>{key === today ? 'Heute' : key === dayKey(tomorrow) ? 'Morgen' : fmt(key, { weekday: 'long' })}</h2><span>{events.length} {events.length === 1 ? 'Eintrag' : 'Einträge'}</span></header><div className="p-agenda-cards">{events.map(event => eventCard(event, true))}</div></section>)}</div> : <div className="p-empty"><Check/><h3>{agendaFilter === 'all' ? 'Alles im Blick' : 'Hier ist alles frei'}</h3><p>{agendaFilter === 'all' ? 'In den nächsten sieben Tagen steht nichts an.' : `In den nächsten sieben Tagen sind keine ${agendaFilter === 'tasks' ? 'Aufträge' : 'Termine'} offen.`}</p>{agendaFilter !== 'all' && <button className="p-text-button" onClick={() => setAgendaFilter('all')}>Alle Einträge anzeigen</button>}</div>}
      </section>}
      {screen === 'calendar' && group && <section className="p-calendar-screen"><div className="p-section-heading"><div><span className="p-eyebrow">Persönliche Kalender</span><h1>{selectedId === self?.id ? 'Mein Kalender' : `${selected?.name}s Kalender`}</h1></div><div className="p-calendar-actions"><button className="p-secondary-button" onClick={() => setImportOpen(true)} aria-label="Kalender importieren" title="Kalender importieren"><Upload size={17}/><span>Import</span></button><button className="p-button" onClick={() => startCreate()} aria-label="Termin erstellen" title="Termin erstellen"><Plus size={18}/><span>Termin</span></button><button className="p-secondary-button p-create-task" onClick={() => startCreate('task')} aria-label="Auftrag erstellen" title="Auftrag erstellen"><ClipboardCheck size={18}/><span>Auftrag</span></button></div></div><div className="p-members" role="group" aria-label="Kalender der Gruppenmitglieder">{members.map(member => <button key={member.id} className={member.id === selectedId ? 'active' : ''} onClick={() => { setPersonId(member.id); setDayOpen(false); }} aria-pressed={member.id === selectedId}><Avatar person={member}/><span>{member.name}<small>{member.id === self?.id ? 'Du' : 'Kalender'}</small></span>{member.id === selectedId && <Check size={14}/>}</button>)}</div><div className="p-category-legend" aria-label="Farben der Einträge">{PLANNER_CATEGORIES.map(category => <span key={category.id}><i style={{ background: category.background, borderColor: category.color }} />{category.label}</span>)}{visibleEvents.some(event => event.wasteKind) && Object.values(PLANNER_WASTE_CATEGORIES).map(category => <span key={category.id}><i style={{ background: category.background, borderColor: category.color }}/>{category.label}</span>)}</div><div className="p-calendar-layout"><div className="p-calendar-card"><div className="p-month-toolbar"><h2>{new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(month)}</h2><div><button className="p-icon-button" onClick={() => changeMonth(-1)} aria-label="Vorheriger Monat"><ChevronLeft size={19}/></button><button className="p-today" onClick={() => { setMonth(new Date(fromDay(today).getFullYear(), fromDay(today).getMonth(), 1, 12)); setDay(today); }}>Heute</button><button className="p-icon-button" onClick={() => changeMonth(1)} aria-label="Nächster Monat"><ChevronRight size={19}/></button></div></div><div className="p-weekdays">{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <span key={d}>{d}</span>)}</div><div key={`${month.getFullYear()}-${month.getMonth()}`} className={`p-month-grid p-month-grid--${monthDirection}`} role="grid" onPointerDown={event => { if (event.pointerType === 'mouse' && event.button === 0) swipeStart.current = { x: event.clientX, y: event.clientY, at: Date.now() } }} onPointerCancel={() => { swipeStart.current = null }} onPointerUp={event => { if (event.pointerType !== 'mouse') return; const start = swipeStart.current; swipeStart.current = null; if (!start) return; const offset = swipeMonthOffset(event.clientX - start.x, event.clientY - start.y, Date.now() - start.at); if (offset) { suppressClickUntil.current = Date.now() + 450; changeMonth(offset) } }} onTouchStart={event => { if (event.touches.length !== 1) { swipeStart.current = null; return } const touch = event.touches[0]; swipeStart.current = { x: touch.clientX, y: touch.clientY, at: Date.now() }; }} onTouchCancel={() => { swipeStart.current = null }} onTouchEnd={event => { const start = swipeStart.current; swipeStart.current = null; if (!start || event.touches.length) return; const touch = event.changedTouches[0]; if (!touch) return; const offset = swipeMonthOffset(touch.clientX - start.x, touch.clientY - start.y, Date.now() - start.at); if (offset) { suppressClickUntil.current = Date.now() + 450; changeMonth(offset) } }} aria-label={`Kalender von ${selected?.name}`}>
        {cells.map(cell => { const entries = visibleEvents.filter(e => coversDay(e, cell.key)); return <button role="gridcell" aria-selected={day === cell.key} aria-current={cell.key === today ? 'date' : undefined} aria-label={`${longDay(cell.key)}, ${entries.length} Einträge`} key={cell.key} onClick={() => openDay(cell.key)} className={`p-day ${cell.outside ? 'outside' : ''} ${cell.key === today ? 'today' : ''} ${cell.key === day ? 'selected' : ''}`}><span className="p-day-number">{cell.date.getDate()}</span><span className="p-day-items">{entries.slice(0, 3).map(e => <span key={e.id} className={`p-day-chip ${e.activity && Object.values(e.activity).some(Boolean) ? 'p-day-chip--activity' : ''} ${e.completed ? 'done' : ''}`} style={{ '--chip-color': plannerCategory(e).color, '--chip-background': plannerCategory(e).background, '--chip-ink': plannerCategory(e).ink } as React.CSSProperties} title={`${plannerCategory(e).label}: ${e.title}`}>{e.date === cell.key && e.time ? <small>{e.time}</small> : null}<span className="p-day-chip-title">{e.date === cell.key || !e.endDate ? e.title : '↔'}</span><ActivityBadges activity={e.activity} compact/></span>)}{entries.length > 3 && <small className="p-more">+{entries.length - 3} weitere</small>}</span></button>; })}
        </div><footer className="p-calendar-foot"><i style={{ background: group.color }}/>{selectedId === self?.id ? 'Deine' : `${selected?.name}s`} Termine in {group.name}<span>Tippe auf einen Tag für alle Details.</span></footer></div><aside className="p-day-panel">{dayDetails()}</aside></div></section>}
      {screen === 'calendar' && !group && <div className="p-empty"><Users /><h2>Dein erster gemeinsamer Kalender</h2><p>Erstelle eine Gruppe oder tritt über einen Einladungscode bei.</p><button className="p-button" onClick={() => setGroupDialog('create')}>Gruppe erstellen<Plus size={17}/></button></div>}
      {screen === 'lists' && <section className="p-lists-screen"><div className="p-section-heading"><div><span className="p-eyebrow">Gemeinsam erledigen</span><h1>Deine Listen</h1><p>Aufträge, Einkäufe und Erinnerungen an einem Ort.</p></div><span className="p-soft-badge">Familie</span></div><Suspense fallback={<div className="p-tools-loading"><LoaderCircle className="p-spin" /> Listen werden geladen …</div>}><FamilyFlowApp initialView="todo" toolsOnly embedded familyGroup={groupFor('family')} onSubgroup={async body => { await mutate('POST', body); }} onOpenChat={target => setChat(target)} onOpenTasksChange={setOpenTasks} /></Suspense></section>}
    </div></div>
    <nav className="p-mobile-nav" aria-label="Mobile Hauptnavigation"><button className={screen === 'home' ? 'active' : ''} aria-current={screen === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><Home />Übersicht</button><button className={screen === 'calendar' ? 'active' : ''} aria-current={screen === 'calendar' ? 'page' : undefined} onClick={() => navigate('calendar')}><CalendarDays />Kalender</button>{LEGACY_PEOPLE.some(p => p.id === self?.id) && <button className={`p-nav-lists ${screen === 'lists' ? 'active' : ''}`} aria-current={screen === 'lists' ? 'page' : undefined} onClick={() => { window.localStorage.setItem('familyflow:device-user:v1', self!.id); navigate('lists'); }}><ListTodo />Listen{openTasks>0&&<span className="p-count-badge" aria-label={`${openTasks} ${openTasks===1?'offener Auftrag':'offene Aufträge'}`}>{openTasks>99?'99+':openTasks}</span>}</button>}</nav>
    <Dialog open={switchOpen} onOpenChange={setSwitchOpen}><DialogContent className="planner-dialog"><DialogHeader><DialogTitle>Gruppe wechseln</DialogTitle><DialogDescription>Jede Gruppe hat ihre eigenen Mitglieder und Kalender.</DialogDescription></DialogHeader><div className="p-switch-list">{data.groups.map(g => <button key={g.id} onClick={() => selectGroup(g.id)}><GroupIcon group={g}/><span><strong>{g.name}</strong><small>{g.members.length} Mitglieder</small></span>{group?.id === g.id ? <Check size={19}/> : <ChevronRight size={19}/>}</button>)}</div><div className="p-dialog-actions"><button onClick={() => { setSwitchOpen(false); setGroupDialog('join'); }}>Beitreten</button><button className="p-button" onClick={() => { setSwitchOpen(false); setGroupDialog('create'); }}><Plus size={16}/> Neue Gruppe</button></div></DialogContent></Dialog>
    <Dialog open={dayOpen} onOpenChange={setDayOpen}><DialogContent className="planner-dialog p-day-dialog"><DialogHeader className="p-sr-only"><DialogTitle>{longDay(day)}</DialogTitle><DialogDescription>Eigener Kalender, andere Mitglieder und deine weiteren Gruppen.</DialogDescription></DialogHeader>{dayDetails()}</DialogContent></Dialog>
    {groupDialog && <GroupDialog kind={groupDialog} inviteCode={pendingInvite.current} onClose={() => { setGroupDialog(null); pendingInvite.current = ''; window.history.replaceState(null, '', window.location.pathname); }} onSave={async (body) => { const result = await mutate('POST', body); if (result.selectedGroupId) {
        selectGroup(result.selectedGroupId);
        setScreen('calendar');
    } toast.success(groupDialog === 'create' ? 'Deine Gruppe ist erstellt.' : 'Du bist der Gruppe beigetreten.'); }}/>}
    <Dialog open={!!invite} onOpenChange={open => !open && setInvite(null)}><DialogContent className="planner-dialog"><DialogHeader><DialogTitle>Zu {invite?.name} einladen</DialogTitle><DialogDescription>Teile den Code oder Einladungslink mit den Personen, die dieser Gruppe beitreten sollen.</DialogDescription></DialogHeader><div className="p-invite-code">{invite?.inviteCode}</div><p className="p-section-note">Der Code erlaubt den Beitritt zu dieser Gruppe. Mitglieder können die Kalender der Gruppe ansehen und bearbeiten.</p><button className="p-button p-button--full" onClick={async () => { try {
        await navigator.clipboard.writeText(`${window.location.origin}${APP_BASE}?invite=${invite?.inviteCode}`);
        toast.success('Einladungslink kopiert.');
    }
    catch {
        toast.error('Bitte kopiere den angezeigten Code.');
    } }}><Copy size={16}/> Einladungslink kopieren</button></DialogContent></Dialog>
    {editor && groupFor(editor.groupId || '') && <EventDialog key={editor.id || 'new'} onChat={target => setChat(target)} onPrepareChat={async draft => { const response=await fetch('/api/planner',{method:'PUT',cache:'no-store',headers:{Authorization:`Bearer ${identity!.key}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(draft)}); const result=await response.json() as {error?:string}; if(!response.ok)throw new Error(result.error||'Der Eintrag konnte nicht gespeichert werden.'); void refresh(); }} seed={editor} group={groupFor(editor.groupId!)!} onSubgroup={async body => { await mutate('POST', body); }} onClose={() => setEditor(null)} onSave={async (event) => { if (offerAsTodo(event, editor)) { await familyFlowCloudStorage.saveTodoItem({ id: event.id!, kind: 'task', title: event.title!, ...(event.date ? { date: event.date } : {}), ...(event.note ? { note: event.note } : {}), createdBy: identity!.id as never, audience: event.audience as never }); setOpenTasks(count => count + (event.audience!.includes(identity!.id) ? 1 : 0)); setEditor(null); toast.success('Auftrag angeboten.'); return; } await mutate('PUT', event); setEditor(null); toast.success(event.kind === 'task' ? 'Auftrag gespeichert.' : 'Termin gespeichert.'); }} onDelete={async (event) => { await mutate('DELETE', { id: event.id, groupId: event.groupId, revision: event.revision }); setEditor(null); toast.success('Termin gelöscht.'); }}/>}
    {importOpen && <Suspense fallback={<div className="p-import-loading" role="status">Import wird geöffnet …</div>}><PlannerImportDialog groups={data.groups} activeGroupId={group?.id} self={data.profile} existing={data.events} onClose={() => setImportOpen(false)} onImport={async body => { const result = await mutate('POST', body); const summary = result.importSummary; toast.success(`${summary?.imported || 0} Termine importiert${summary?.duplicates ? ` · ${summary.duplicates} bereits vorhanden` : ''}.`) }}/></Suspense>}
    <Dialog open={!!wasteOpen} onOpenChange={open => !open && !wasteBusy && setWasteOpen(null)}><DialogContent className="planner-dialog"><DialogHeader><span className="p-eyebrow">Müllabholung</span><DialogTitle>{wasteOpen?.title}</DialogTitle><DialogDescription>{wasteOpen ? longDay(wasteOpen.date) : ''} · {wasteOpen?.groupId === 'family' ? 'Für Sascha & Katharina' : groupFor(wasteOpen?.groupId || '')?.name}</DialogDescription></DialogHeader><div className="p-waste-detail" style={wasteOpen ? { background: plannerCategory(wasteOpen).background, color: plannerCategory(wasteOpen).ink } : {}}><Trash2 size={32}/><strong>{wasteOpen?.completed ? 'Schon rausgestellt' : 'Tonne noch rausstellen'}</strong>{wasteOpen?.note && <p>{wasteOpen.note}</p>}</div><button className="p-button p-button--full" disabled={wasteBusy} onClick={() => wasteOpen && void toggleWaste(wasteOpen)}>{wasteBusy ? 'Speichert …' : wasteOpen?.completed ? 'Bestätigung zurücknehmen' : 'Als rausgestellt bestätigen'}</button>{wasteOpen && !wasteOpen.readonly && <button className="p-text-button" onClick={() => { setEditor(wasteOpen); setWasteOpen(null) }}>Mülltermin bearbeiten</button>}</DialogContent></Dialog>
    {chatView}
    {identity && <ReminderListener identity={identity} onOpen={threadId => setChat({ threadId })}/>}
    <Toaster position="top-center" richColors closeButton/>
  </main>;
}
function GroupDialog({ kind, inviteCode, onClose, onSave }: {
    kind: 'create' | 'join';
    inviteCode: string;
    onClose: () => void;
    onSave: (body: unknown) => Promise<void>;
}) {
    const [name, setName] = useState(''), [category, setCategory] = useState('Team'), [code, setCode] = useState(inviteCode), [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="planner-dialog"><form onSubmit={async (e) => { e.preventDefault(); if (busy)
        return; setBusy(true); setError(''); try {
        await onSave(kind === 'create' ? { action: 'create-group', name, category } : { action: 'join', code });
        onClose();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}><DialogHeader><DialogTitle>{kind === 'create' ? 'Eine neue Gruppe' : 'Gruppe beitreten'}</DialogTitle><DialogDescription>{kind === 'create' ? 'Ein eigener Platz für eure gemeinsamen Pläne.' : 'Du erhältst deinen eigenen Kalender in der Gruppe.'}</DialogDescription></DialogHeader><div className="p-form-fields">{kind === 'create' ? <><label htmlFor="group-name">Gruppenname</label><input id="group-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="z. B. Laufteam, Arbeit oder Familie" required/><label htmlFor="group-category">Bereich</label><select id="group-category" value={category} onChange={e => setCategory(e.target.value)}>{['Team', 'Arbeit', 'Familie', 'Freunde', 'Sonstiges'].map(c => <option key={c}>{c}</option>)}</select></> : <><label htmlFor="invite-code">Einladungscode</label><input id="invite-code" value={code} onChange={e => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" maxLength={20} placeholder="12-stelliger Code" required/></>}{error && <p className="p-error" role="alert">{error}</p>}</div><div className="p-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Abbrechen</button><button className="p-button" disabled={busy}>{busy ? 'Speichert …' : kind === 'create' ? 'Gruppe erstellen' : 'Beitreten'}<ArrowRight size={16}/></button></div></form></DialogContent></Dialog>;
}
// Ein neuer Familien-Auftrag für mehrere Personen wird ihnen in „Listen“ angeboten; wer übernimmt, bekommt ihn.
function offerAsTodo(event: Partial<PlannerEvent>, seed: Partial<PlannerEvent>) { return event.groupId === 'family' && event.kind === 'task' && !!event.audience?.length && !seed.id; }
function EventDialog({ seed, group, onClose, onSave, onDelete, onChat, onPrepareChat, onSubgroup }: {
    onSubgroup: (body: Record<string, unknown>) => Promise<void>;
    onChat: (target: ChatTarget) => void;
    onPrepareChat: (event: Partial<PlannerEvent>) => Promise<void>;
    seed: Partial<PlannerEvent>;
    group: PlannerGroup;
    onClose: () => void;
    onSave: (event: Partial<PlannerEvent>) => Promise<void>;
    onDelete: (event: Partial<PlannerEvent>) => Promise<void>;
}) {
    const [title, setTitle] = useState(seed.title || ''), [date, setDate] = useState(seed.date || ''), [endDate, setEndDate] = useState(seed.endDate || ''), [time, setTime] = useState(seed.time || ''), [note] = useState(seed.note || ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
    const [entryId] = useState(() => seed.id || clientId());
    const [catOpen, setCatOpen] = useState(false), [pickOpen, setPickOpen] = useState(false), [manage, setManage] = useState(false);
    const memberIds = group.members.map(m => m.id);
    const [people, setPeople] = useState<string[]>(() => { const chosen = selectionOf({ person: seed.person || '', audience: seed.audience }, memberIds); return chosen.length ? chosen : memberIds.slice(0, 1); });
    const [categoryId, setCategoryId] = useState<PlannerCategoryId>(plannerCategory({ kind: seed.kind, eventType: seed.eventType || 'private' }).id as PlannerCategoryId);
    const isTask = categoryId === 'task';
    const value = (): Partial<PlannerEvent> => ({ ...seed, id: entryId, groupId: group.id, title: title.trim(), date, endDate: endDate || undefined, time: time || undefined, note: note.trim(), ...(seed.wasteKind ? {} : selectionFields()), kind: isTask ? 'task' : 'event', eventType: categoryId });
    function selectionFields() { const picked = normalizeSelection(people, memberIds, !isTask) || { person: memberIds[0] }; return { person: picked.person, audience: picked.audience }; }
    const offering = offerAsTodo({ groupId: group.id, kind: isTask ? 'task' : 'event', audience: selectionFields().audience }, seed);
    async function run(action: () => Promise<void>) {
        if (busy) return;
        setBusy(true); setError('');
        try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }
    function openChat(initialPanel?: 'share') {
        if (!title.trim() || !date) return;
        const draft=value();
        const unchanged=unchangedChatDraft(seed,draft);
        if(unchanged)onClose();
        onChat({entry:{kind:'event',id:entryId},initialPanel,preview:{title:draft.title!,kind:isTask?'task':'event',date,time:time||undefined,note:note.trim()},...(!unchanged?{prepare:async()=>{setBusy(true);setError('');try{await onPrepareChat(draft);onClose()}catch(e){setError((e as Error).message);throw e}finally{setBusy(false)}}}:{})});
    }
    return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="planner-dialog p-event-dialog" aria-describedby={undefined} swipeToClose={!busy && !catOpen && !pickOpen} onEscapeKeyDown={e => { if (catOpen || pickOpen) { e.preventDefault(); setCatOpen(false); setPickOpen(false); } }}><form onSubmit={e => { e.preventDefault(); void run(() => onSave(value())); }}>
      <DialogHeader className="p-editor-head"><DialogTitle className="p-sr-only">{seed.id ? 'Eintrag bearbeiten' : isTask ? 'Auftrag eintragen' : 'Termin eintragen'}</DialogTitle>{!seed.wasteKind && !offering && <button type="button" className="p-entry-share" disabled={busy || !title.trim() || !date} onClick={() => openChat('share')} aria-label={seed.id ? 'Eintrag per Link teilen' : 'Eintrag speichern und per Link teilen'}><Share2 size={17}/>Teilen</button>}</DialogHeader>
      <div className="p-form-fields"><label htmlFor="event-title" className="p-sr-only">Titel</label><input id="event-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Titel" maxLength={120} required/>
        {!seed.wasteKind && !offering && <ChatLaunch activity={seed.activity} fresh={!seed.id} disabled={busy || !title.trim() || !date} onClick={() => openChat()}/>}
        <div className="p-form-row"><div><label htmlFor="event-date">Datum</label><input id="event-date" type="date" value={date} onInput={e => { setDate(e.currentTarget.value); if (endDate && endDate < e.currentTarget.value) setEndDate(e.currentTarget.value); }} onChange={e => { setDate(e.target.value); if (endDate && endDate < e.target.value) setEndDate(e.target.value); }} required/></div><div><label htmlFor="event-time">Uhrzeit</label><input id="event-time" type="time" value={time} onInput={e => setTime(e.currentTarget.value)} onChange={e => setTime(e.target.value)}/></div></div>
        <div className={seed.wasteKind ? undefined : 'p-form-row'}><div className="p-people-field">{seed.wasteKind ? <><label htmlFor="event-person">Kalender</label><div className="p-import-parents">{group.id === 'family' ? 'Sascha & Katharina' : group.members.find(m => m.id === seed.person)?.name || 'Alle Mitglieder'}</div></> : <><span className="p-form-label" id="people-label">Für</span><PeopleSelect id="event-person" labelId="people-label" members={group.members} subgroups={group.subgroups} value={people} onChange={setPeople} open={pickOpen} onOpenChange={next => { setPickOpen(next); if (next) setCatOpen(false); }} onManage={() => setManage(true)} disabled={busy}/></>}</div>
        {!seed.wasteKind && <div><span className="p-form-label" id="category-label">Art</span><CategorySelect id="event-category" labelId="category-label" value={categoryId} open={catOpen} onOpenChange={next => { setCatOpen(next); if (next) setPickOpen(false); }} disabled={busy} onChange={setCategoryId}/></div>}</div>
        {offering && <p className="p-sub-hint">Wird in Listen angeboten – wer übernimmt, bekommt ihn.</p>}
        <label htmlFor="event-end">Bis</label><input id="event-end" type="date" min={date} value={endDate} onInput={e => setEndDate(e.currentTarget.value)} onChange={e => setEndDate(e.target.value)}/>{error && <p className="p-error" role="alert">{error}</p>}
      </div>
      <div className="p-dialog-actions">{seed.id ? <button className="p-delete" type="button" disabled={busy} onClick={() => setConfirm(true)}>Löschen</button> : <button type="button" onClick={onClose} disabled={busy}>Abbrechen</button>}<button className="p-button" disabled={busy || !title.trim() || !date}>{busy ? 'Speichert …' : 'Speichern'}<Check size={17}/></button></div>
      {confirm && <div className="p-delete-confirm" role="alert"><p>„{seed.title}“ für die Gruppe löschen?</p><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Behalten</button><button className="p-delete" type="button" disabled={busy} onClick={() => void run(() => onDelete(seed))}>Endgültig löschen</button></div>}
    </form>{manage && <SubgroupDialog group={group} onClose={() => setManage(false)} onSave={onSubgroup}/>}</DialogContent></Dialog>;
}

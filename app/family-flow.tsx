"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react"
import {
  Bell,
  BellOff,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock3,
  Cloud,
  CloudOff,
  Copy,
  Gift,
  Heart,
  Home,
  ListTodo,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Share2,
  ShoppingBasket,
  Trash2,
  Users,
} from "lucide-react"
import { toast, Toaster } from "sonner"
import ChatLaunch from "./chat-launch"
import ActivityBadges from "./entry-activity"
import { clientId } from "@/lib/discussions"
import type { ChatTarget } from "./entry-chat"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  type CalendarItem,
  CloudRequestError,
  type EventType,
  type FamilyFlowState,
  type PersonId,
  type ShoppingItem,
  type TodoItem,
  type WasteCompletion,
  clearLegacyCalendarData,
  createEmptyState,
  familyFlowCloudStorage,
  loadDeviceUser,
  loadLocalAvatars,
  saveLocalAvatars,
  saveDeviceUser,
} from "@/lib/familyflow-storage"
import {
  type PushState,
  disablePush,
  enablePush,
  loadReminderUrl,
  readPushState,
  refreshPushPerson,
} from "@/lib/push-client"
import { WASTE_CALENDAR_SOURCE, WASTE_PICKUPS, wastePickupsForDate, type WastePickup } from "@/lib/waste-calendar"
import {
  groceryProductForKey,
  normalizeGroceryText,
  recognizeGroceryProduct,
} from "@/lib/grocery-catalog"

type View = "home" | "calendar" | "todo" | "family"
type Filter = "all" | "waste"
type EditingState = { item?: CalendarItem; kind: "event" | "task"; date: string; unsaved?: boolean }
type HomeAgendaEntry =
  | { type: "calendar"; item: CalendarItem }
  | { type: "waste"; item: WastePickup; completed: boolean }

type WebMCPContext = {
  registerTool: (
    tool: {
      name: string
      title: string
      description: string
      inputSchema: Record<string, unknown>
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
      execute: (input: unknown) => unknown | Promise<unknown>
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>
}

const PEOPLE: Record<
  PersonId,
  { name: string; short: string; photo: string; photoPosition: string; color: string }
> = {
  sascha: { name: "Sascha", short: "S", photo: "/profiles/sascha.jpeg", photoPosition: "50% 52%", color: "#467ba6" },
  katharina: { name: "Katharina", short: "K", photo: "/profiles/katharina.jpeg", photoPosition: "50% 46%", color: "#d9778f" },
  arjen: { name: "Arjen", short: "A", photo: "/profiles/arjen.jpeg", photoPosition: "50% 48%", color: "#36a78a" },
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
const EVENT_TYPE_OPTIONS: Array<{ id: EventType; label: string }> = [
  { id: "private", label: "Privat" },
  { id: "work", label: "Arbeit" },
  { id: "vacation", label: "Urlaub" },
  { id: "holidays", label: "Ferien / Feiertage" },
  { id: "birthday", label: "Geburtstag" },
  { id: "other", label: "Sonstiges" },
]

const UNASSIGNED_EVENT_TYPES = new Set<EventType>(["holidays", "birthday", "other"])

function isUnassignedEventType(eventType: EventType) {
  return UNASSIGNED_EVENT_TYPES.has(eventType)
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number)
  return new Date(year, month - 1, day, 12)
}

function formatFullDate(key: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dateFromKey(key))
}

function formatShortDate(key: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(dateFromKey(key))
}

function itemEndDate(item: CalendarItem) {
  return item.endDate ?? item.date
}

function itemCoversDate(item: CalendarItem, date: string) {
  return item.date <= date && itemEndDate(item) >= date
}

function itemOverlapsRange(item: CalendarItem, start: string, end: string) {
  return item.date <= end && itemEndDate(item) >= start
}

function eventTypeOf(item: CalendarItem): EventType {
  return item.kind === "event" ? item.eventType ?? "private" : "private"
}

function isMultiDayEvent(item: CalendarItem) {
  return item.kind === "event" && Boolean(item.endDate && item.endDate > item.date)
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
  }).format(date)
}

function getMonthCells(monthDate: Date) {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const mondayOffset = (new Date(year, month, 1).getDay() + 6) % 7
  const total = Math.ceil((mondayOffset + daysInMonth) / 7) * 7

  return Array.from({ length: total }, (_, index) => {
    const dayNumber = index - mondayOffset + 1
    const date = new Date(year, month, dayNumber, 12)
    return {
      date,
      key: localDateKey(date),
      number: date.getDate(),
      currentMonth: date.getMonth() === month,
    }
  })
}

function itemPerson(item: CalendarItem): PersonId | "all" | null {
  if (item.kind === "task") return item.assignee ?? "sascha"
  if (isUnassignedEventType(eventTypeOf(item))) return null
  return item.person ?? "all"
}

function sortItems(items: CalendarItem[]) {
  return [...items].sort((a, b) => {
    const rangeOrder = Number(isMultiDayEvent(b)) - Number(isMultiDayEvent(a))
    if (rangeOrder) return rangeOrder
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    return (a.time || "99:99").localeCompare(b.time || "99:99") || a.title.localeCompare(b.title, "de")
  })
}

function sortUpcomingItems(items: CalendarItem[]) {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"))
}

function relativeDateLabel(key: string, today: string) {
  const date = dateFromKey(key)
  const offset = Math.round((date.getTime() - dateFromKey(today).getTime()) / 86_400_000)
  const top = offset === 0 ? "Heute" : offset === 1 ? "Morgen" : new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(date)
  return { top, bottom: new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(date) }
}

function agendaDateLabel(item: CalendarItem, today: string) {
  if (!item.endDate) return relativeDateLabel(item.date, today)
  const weekday = (key: string) => new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(dateFromKey(key)).replace(".", "")
  const numeric = (key: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(dateFromKey(key))
  if (item.date <= today && item.endDate >= today) {
    return { top: `Bis ${weekday(item.endDate)}`, bottom: numeric(item.endDate) }
  }
  return { top: `${weekday(item.date)}–${weekday(item.endDate)}`, bottom: `${numeric(item.date)}–${numeric(item.endDate)}` }
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="Done">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="brand__mark" src="/branding/handoff-v1-logo-128.png" alt="" />
      {!compact && (
        <div>
          <div className="brand__name"><span className="brand__line">Du machst</span>{" "}<span className="brand__line">das <span className="brand__yellow">jetzt!</span></span></div>
        </div>
      )}
    </div>
  )
}

function ProfileAvatar({
  personId,
  avatars,
  size = "md",
}: {
  personId: PersonId
  avatars: FamilyFlowState["avatars"]
  size?: "xs" | "sm" | "md" | "lg" | "xl"
}) {
  const person = PEOPLE[personId]
  const image = avatars[personId]

  return (
    <span
      className={`profile-avatar profile-avatar--${size}`}
      style={{ "--avatar-color": person.color } as React.CSSProperties}
      aria-label={person.name}
    >
      {/* User-selected local images are represented as data URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image ?? person.photo}
        alt={`Profilbild von ${person.name}`}
        style={{ objectPosition: image ? "50% 50%" : person.photoPosition }}
      />
    </span>
  )
}

function AvatarStack({
  people,
  avatars,
}: {
  people: Array<PersonId | "all" | null>
  avatars: FamilyFlowState["avatars"]
}) {
  const ids: PersonId[] = people.includes("all")
    ? ["sascha", "katharina", "arjen"]
    : Array.from(new Set(people.filter((person): person is PersonId => Boolean(person) && person !== "all")))

  return (
    <span className="avatar-stack" aria-hidden="true">
      {ids.slice(0, 3).map((id) => (
        <ProfileAvatar key={id} personId={id} avatars={avatars} size="xs" />
      ))}
    </span>
  )
}

function ItemEditor({
  editing,
  avatars,
  localOnly,
  onOpenChange,
  onSave,
  onDelete,
}: {
  editing: EditingState | null
  avatars: FamilyFlowState["avatars"]
  localOnly: boolean
  onOpenChange: (open: boolean) => void
  onSave: (item: CalendarItem) => void
  onDelete: (id: string) => void
}) {
  const seed = editing?.item
  const [title, setTitle] = useState(seed?.title ?? "")
  const [date, setDate] = useState(seed?.date ?? editing?.date ?? localDateKey(new Date()))
  const [endDate, setEndDate] = useState(seed?.endDate ?? "")
  const [eventType, setEventType] = useState<EventType>(seed?.eventType ?? "private")
  const [time, setTime] = useState(seed?.time ?? "")
  const [note, setNote] = useState(seed?.note ?? "")
  const [person, setPerson] = useState<PersonId | "all">(
    editing?.kind === "task" ? seed?.assignee ?? "sascha" : seed?.person ?? "all",
  )
  const [completed, setCompleted] = useState(seed?.completed ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing) return
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.scrollTo({ top: 0, behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editing])

  if (!editing) return null

  const kind = editing.kind
  const isEdit = Boolean(seed) && !editing.unsaved
  const unassignedEvent = kind === "event" && isUnassignedEventType(eventType)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return

    onSave({
      id: seed?.id ?? `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      title: cleanTitle,
      date,
      ...(endDate && endDate !== date ? { endDate } : {}),
      ...(time ? { time } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(kind === "event"
        ? { ...(!isUnassignedEventType(eventType) ? { person } : {}), eventType }
        : { assignee: person === "all" ? "sascha" : person, completed }),
    })
  }

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
      <DialogContent ref={editorRef} layout="viewport" className={`editor-dialog editor-dialog--${kind}`} showCloseButton={false} aria-labelledby="editor-title" aria-describedby="editor-description" onPointerDownOutside={(event) => event.preventDefault()}>
          <form className="editor-form" onSubmit={submit}>
            <div className="editor-topline">
              <button type="button" onClick={() => onOpenChange(false)}><ChevronLeft aria-hidden="true" /> Zurück</button>
              <span>{isEdit ? "Bearbeiten" : kind === "event" ? "Termin erstellen" : "Auftrag erstellen"}</span>
            </div>

            <div className="editor-heading">
              <DialogTitle asChild><h1 id="editor-title">{kind === "event" && eventType === "holidays" ? "Fester Termin" : kind === "event" && eventType === "birthday" ? "Geburtstag" : kind === "event" && eventType === "other" ? "Allgemeiner Termin" : kind === "event" ? "Für wen ist der Termin?" : "Wer ist zuständig?"}</h1></DialogTitle>
              <DialogDescription asChild><p id="editor-description">{unassignedEvent ? "Für alle sichtbar und niemandem zugeordnet." : <>Wähle ein Familienmitglied{kind === "event" ? " oder Alle" : ""}.</>}</p></DialogDescription>
            </div>

            <div className={`editor-summary-card editor-summary-card--${kind}`}>
              <div className="editor-summary-card__kind">{kind === "event" ? <CalendarDays aria-hidden="true" /> : <ClipboardCheck aria-hidden="true" />}{kind === "event" ? "Termin" : "Auftrag"}</div>
              {kind === "event" && (
                <fieldset className="event-type-picker">
                  <legend>Art des Termins</legend>
                  <div className="event-type-picker__options" role="radiogroup" aria-label="Art des Termins">
                    {EVENT_TYPE_OPTIONS.map((option) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={eventType === option.id}
                        className={`event-type-option event-type-option--${option.id} ${eventType === option.id ? "event-type-option--active" : ""}`}
                        key={option.id}
                        onClick={() => setEventType(option.id)}
                      >
                        <span className="event-type-option__swatch" aria-hidden="true" />
                        <strong>{option.label}</strong>
                        {eventType === option.id && <Check aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="form-field">
                <Label htmlFor="item-title">Titel</Label>
                <Input id="item-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "event" ? "z. B. Zahnarzt" : "z. B. Einkauf erledigen"} required />
              </div>
              <div className="form-row form-row--dates">
                <div className="form-field"><Label htmlFor="item-date">Von</Label><Input id="item-date" type="date" value={date} onChange={(event) => { const nextDate = event.target.value; setDate(nextDate); if (endDate && endDate < nextDate) setEndDate(nextDate) }} required /></div>
                <div className="form-field"><Label htmlFor="item-end-date">Bis <span>optional</span></Label><Input id="item-end-date" type="date" value={endDate} min={date} onChange={(event) => setEndDate(event.target.value)} /></div>
              </div>
              <div className="form-field"><Label htmlFor="item-time">Uhrzeit <span>optional</span></Label><Input id="item-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div>
              <div className="form-field"><Label htmlFor="item-note">Notiz <span>optional</span></Label><Textarea id="item-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Was sollte die Familie wissen?" rows={2} /></div>
            </div>

            {(kind === "task" || !unassignedEvent) && <div className={`editor-people editor-people--${kind}`} role="radiogroup" aria-label={kind === "event" ? "Betroffene Person auswählen" : "Zuständige Person auswählen"}>
              {(kind === "event" ? ["all", "sascha", "katharina", "arjen"] as const : ["sascha", "katharina", "arjen"] as const).map((id) => {
                const label = id === "all" ? "Alle" : PEOPLE[id].name
                return (
                  <button type="button" role="radio" aria-checked={person === id} className={`editor-person ${person === id ? "editor-person--active" : ""}`} key={id} onClick={() => setPerson(id)}>
                    {id === "all" ? <span className="editor-person__all"><Users aria-hidden="true" /></span> : <ProfileAvatar personId={id} avatars={avatars} size="xl" />}
                    <strong>{label}</strong>
                    <span className="editor-person__check"><Check aria-hidden="true" /></span>
                  </button>
                )
              })}
            </div>}

            {kind === "task" && isEdit && (
              <label className="completed-toggle">
                <Checkbox checked={completed} onCheckedChange={(checked) => setCompleted(checked === true)} />
                <span>Auftrag ist erledigt</span>
              </label>
            )}

            <DialogFooter className="editor-actions">
              {isEdit && (
                <Button type="button" variant="ghost" className="delete-button" onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" /> Löschen
                </Button>
              )}
              <Button type="submit" className={`primary-button primary-button--${kind}`}>{isEdit ? "Änderungen speichern" : kind === "event" ? "Termin speichern" : "Auftrag speichern"}</Button>
            </DialogFooter>
          </form>
      </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm" className="confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Wirklich löschen?</AlertDialogTitle>
            <AlertDialogDescription>„{seed?.title}“ wird {localOnly ? "auf diesem Gerät" : "für alle Geräte"} dauerhaft entfernt.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => seed && onDelete(seed.id)}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function TodoCreateDialog({
  kind,
  onClose,
  onSave,
  onOpenChat,
}: {
  onOpenChat?: (target: ChatTarget) => void
  kind: TodoItem["kind"]
  onClose: () => void
  onSave: (title: string, note: string, date?: string, id?: string) => Promise<TodoItem | null>
}) {
  const [entryId] = useState(() => clientId())
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")
  const [date, setDate] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle || busy) return
    setBusy(true)
    const saved = await onSave(cleanTitle, note.trim(), date || undefined, entryId)
    setBusy(false)
    if (saved) onClose()
  }

  function openChat(initialPanel?: "share") {
    if (busy || !title.trim() || !onOpenChat) return
    onOpenChat({entry:{kind:"todo",id:entryId},initialPanel,preview:{title:title.trim(),kind,date:date||undefined,note:note.trim()},prepare:async()=>{
      setBusy(true)
      try {
        const saved=await onSave(title.trim(),note.trim(),date||undefined,entryId)
        if(!saved)throw new Error("Der Eintrag konnte nicht gespeichert werden. Bitte erneut versuchen.")
        onClose()
      } finally { setBusy(false) }
    }})
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="todo-dialog" swipeToClose={!busy}>
        <form onSubmit={submit}>
          <DialogHeader>
            <span className={`todo-dialog__kind todo-dialog__kind--${kind}`}>{kind === "task" ? <ClipboardCheck aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}{kind === "task" ? "Offener Auftrag" : "Offener Termin"}</span>
            <div className="p-editor-title"><DialogTitle>{kind === "task" ? "Auftrag in die Liste stellen" : "Termin in die Liste stellen"}</DialogTitle>{onOpenChat && <button type="button" className="p-entry-share" disabled={busy || !title.trim()} onClick={() => void openChat("share")} aria-label="Eintrag speichern und per Link teilen"><Share2 size={17}/>Teilen</button>}</div>
            <DialogDescription>Noch ohne Zuständigkeit. Du kannst einen Tag vorgeben oder die Planung offenlassen.</DialogDescription>
          </DialogHeader>
          <div className="todo-dialog__fields">
            <div className="form-field"><Label htmlFor="todo-title">Was steht an?</Label><Input id="todo-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "task" ? "z. B. Keller aufräumen" : "z. B. Termin beim Tierarzt"} maxLength={120} required /></div>
            {onOpenChat && <ChatLaunch fresh disabled={!title.trim() || busy} onClick={() => void openChat()}/>}
            <div className="form-field"><Label htmlFor="todo-planned-date">Datum <span>optional</span></Label><Input id="todo-planned-date" type="date" value={date} onInput={(event) => setDate(event.currentTarget.value)} onChange={(event) => setDate(event.target.value)} /><small className="todo-date-note">{date ? "Der Tag wird beim Übernehmen beibehalten." : "Ohne Datum kann die Person später einen Tag wählen."}</small></div>
            <div className="form-field"><Label htmlFor="todo-note">Notiz <span>optional</span></Label><Textarea id="todo-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Weitere Informationen" maxLength={1000} rows={3} /></div>
          </div>

          <DialogFooter className="todo-dialog__actions"><Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button><Button type="submit" disabled={!title.trim() || busy}>{busy ? "Speichert …" : "Offen eintragen"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TodoTakeDialog({
  item,
  person,
  avatars,
  today,
  onClose,
  onTake,
}: {
  item: TodoItem
  person: PersonId
  avatars: FamilyFlowState["avatars"]
  today: string
  onClose: () => void
  onTake: (date: string, completed: boolean) => Promise<boolean>
}) {
  const [date, setDate] = useState(item.date || today)
  const [completed, setCompleted] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if ((!completed && !date) || busy) return
    setBusy(true)
    const taken = await onTake(date, completed)
    setBusy(false)
    if (taken) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="todo-dialog todo-dialog--take">
        <form onSubmit={submit}>
          <DialogHeader>
            <span className={`todo-dialog__kind todo-dialog__kind--${item.kind}`}>{item.kind === "task" ? <ClipboardCheck aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}{item.kind === "task" ? "Auftrag" : "Termin"}</span>
            <DialogTitle>{item.title}</DialogTitle>
            {item.note && <DialogDescription>{item.note}</DialogDescription>}
          </DialogHeader>
          <div className="todo-take-person"><ProfileAvatar personId={person} avatars={avatars} size="md" /><span><small>Wird übernommen von</small><strong>{PEOPLE[person].name}</strong></span></div>
          <div className="todo-dialog__fields">
            {!completed && <div className="form-field"><Label htmlFor="todo-date">{item.date ? "Vorgegebener Tag" : "An welchem Tag?"}</Label><Input id="todo-date" type="date" readOnly={!!item.date} value={date} onInput={(event) => setDate(event.currentTarget.value)} onChange={(event) => setDate(event.target.value)} required /></div>}
            <label className="todo-completed-toggle"><Checkbox checked={completed} onCheckedChange={(checked) => setCompleted(checked === true)} /><span><strong>Schon erledigt</strong><small>Der Eintrag wird nicht mehr in den Kalender übernommen.</small></span></label>
          </div>
          <DialogFooter className="todo-dialog__actions"><Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button><Button type="submit" disabled={(!completed && !date) || busy}>{busy ? "Übernimmt …" : completed ? "Als erledigt übernehmen" : "In meinen Kalender"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ShoppingListView({
  items,
  avatars,
  onBack,
  onAdd,
  onRemove,
}: {
  items: ShoppingItem[]
  avatars: FamilyFlowState["avatars"]
  onBack: () => void
  onAdd: (label: string, productKey: string) => Promise<boolean>
  onRemove: (item: ShoppingItem) => Promise<boolean>
}) {
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const recognized = useMemo(() => recognizeGroceryProduct(query), [query])

  async function addLabel(label: string, productKey: string) {
    if (adding) return
    setAdding(true)
    const saved = await onAdd(label, productKey)
    setAdding(false)
    if (saved) setQuery("")
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const label = query.trim()
    if (!label) return
    await addLabel(label, recognized?.key ?? "custom")
  }

  async function remove(item: ShoppingItem) {
    if (removingId) return
    setRemovingId(item.id)
    await new Promise((resolve) => window.setTimeout(resolve, 220))
    await onRemove(item)
    setRemovingId(null)
  }

  return (
    <section className="screen screen--shopping" aria-labelledby="shopping-title">
      <div className="shopping-heading">
        <button type="button" onClick={onBack} aria-label="Zurück zu To-do"><ChevronLeft aria-hidden="true" /></button>
        <div><span className="eyebrow">Gemeinsam einkaufen</span><h1 id="shopping-title">Einkaufsliste</h1></div>
        <span>{items.length}</span>
      </div>

      <form className="shopping-search" onSubmit={submit}>
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Was brauchen wir?" aria-label="Artikel suchen oder eingeben" autoComplete="off" maxLength={120} />
        <button type="submit" disabled={!query.trim() || adding} aria-label="Eingabe zur Einkaufsliste hinzufügen"><Plus aria-hidden="true" /></button>
      </form>

      {query.trim() && (
        <button type="button" className="shopping-exact-add" disabled={adding} onClick={() => void addLabel(query.trim(), recognized?.key ?? "custom")}>
          <span className={`grocery-emoji grocery-emoji--${recognized?.category ?? "other"}`}>{recognized?.emoji ?? "🛒"}</span>
          <span><strong>„{query.trim()}“ hinzufügen</strong><small>{recognized ? `Wird als ${recognized.label} erkannt` : "Freier Artikel"}</small></span>
          <Plus aria-hidden="true" />
        </button>
      )}

      <section className="shopping-active" aria-labelledby="shopping-active-title">
        <div className="shopping-section-heading"><div><h2 id="shopping-active-title">Auf der Liste</h2><p>{items.length ? "Beim Einkauf antippen und abhaken" : "Noch nichts eingetragen"}</p></div><ShoppingBasket aria-hidden="true" /></div>
        {items.length ? (
          <div className="shopping-active-grid">
            {items.map((item) => {
              const product = groceryProductForKey(item.productKey) ?? recognizeGroceryProduct(item.label)
              return (
                <button type="button" key={item.id} className={`shopping-item-tile shopping-item-tile--${product?.category ?? "other"} ${removingId === item.id ? "shopping-item-tile--removing" : ""}`} onClick={() => void remove(item)} aria-label={`${item.label} abhaken`}>
                  <span className={`grocery-emoji grocery-emoji--${product?.category ?? "other"}`}>{product?.emoji ?? "🛒"}</span>
                  <strong>{item.label}</strong>
                  <span className="shopping-item-tile__by"><ProfileAvatar personId={item.addedBy} avatars={avatars} size="xs" /></span>
                  <span className="shopping-item-tile__check"><Check aria-hidden="true" /></span>
                </button>
              )
            })}
          </div>
        ) : <div className="shopping-empty"><ShoppingBasket aria-hidden="true" /><strong>Die Liste ist leer</strong><span>Gib oben ein, was ihr beim nächsten Einkauf braucht.</span></div>}
      </section>
    </section>
  )
}

export default function FamilyFlowApp({ initialView = "home", toolsOnly = false, embedded = false, onOpenChat }: { initialView?: View; toolsOnly?: boolean; embedded?: boolean; onOpenChat?: (target: ChatTarget) => void } = {}) {
  const nowRef = useRef(new Date())
  const todayKey = localDateKey(nowRef.current)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<FamilyFlowState>(createEmptyState)
  const [wasteCompletions, setWasteCompletions] = useState<Record<string, WasteCompletion>>({})
  const [todoItems, setTodoItems] = useState<TodoItem[]>([])
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([])
  const [syncStatus, setSyncStatus] = useState<"syncing" | "online" | "offline">("syncing")
  const [pushState, setPushState] = useState<PushState>("checking")
  const [pushBusy, setPushBusy] = useState(false)
  const [reminderUrl, setReminderUrl] = useState<string | null>(null)
  const [deviceUser, setDeviceUser] = useState<PersonId | null>(null)
  const [profilePickerOpen, setProfilePickerOpen] = useState(false)
  const [profileUnlockOpen, setProfileUnlockOpen] = useState(false)
  const [profileUnlockCode, setProfileUnlockCode] = useState("")
  const [profileUnlockBusy, setProfileUnlockBusy] = useState(false)
  const [profileUnlockError, setProfileUnlockError] = useState("")
  const [profileUnlockTarget, setProfileUnlockTarget] = useState<PersonId | null>(null)
  const [view, setView] = useState<View>(initialView)
  const [filter, setFilter] = useState<Filter>("all")
  const [month, setMonth] = useState(() => new Date(nowRef.current.getFullYear(), nowRef.current.getMonth(), 1, 12))
  const [monthTransition, setMonthTransition] = useState<{ direction: "next" | "previous"; sequence: number } | null>(null)
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [daySheetOpen, setDaySheetOpen] = useState(false)
  const [wideCalendar, setWideCalendar] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(min-width: 900px)")
    const update = () => {
      setWideCalendar(query.matches)
      if (query.matches) setDaySheetOpen(false)
    }
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [todoCreateKind, setTodoCreateKind] = useState<TodoItem["kind"] | null>(null)
  const [takingTodo, setTakingTodo] = useState<TodoItem | null>(null)
  const [shoppingOpen, setShoppingOpen] = useState(false)
  const stateRef = useRef(state)
  const pendingWritesRef = useRef(0)
  const syncRequestRef = useRef(0)
  const calendarSwipeRef = useRef<{ x: number; y: number } | null>(null)
  const suppressCalendarClickRef = useRef(false)
  const monthTransitionSequenceRef = useRef(0)

  const syncFromCloud = useCallback(async (showError = false) => {
    if (pendingWritesRef.current > 0) return false
    const requestId = ++syncRequestRef.current
    if (showError) setSyncStatus("syncing")

    try {
      const [items, completions, todos, shopping] = await Promise.all([
        familyFlowCloudStorage.loadItems(),
        familyFlowCloudStorage.loadWasteCompletions(),
        familyFlowCloudStorage.loadTodoItems(),
        familyFlowCloudStorage.loadShoppingItems(),
      ])
      if (requestId !== syncRequestRef.current) return false
      setState((current) => ({ ...current, items }))
      setWasteCompletions(Object.fromEntries(completions.map((completion) => [completion.pickupId, completion])))
      setTodoItems(todos)
      setShoppingItems(shopping)
      setSyncStatus("online")
      return true
    } catch {
      if (requestId === syncRequestRef.current) setSyncStatus("offline")
      if (showError) toast.error("Der gemeinsame Kalender ist gerade nicht erreichbar. Tippe oben auf das Cloud-Symbol, um es erneut zu versuchen.")
      return false
    }
  }, [])

  const persistItem = useCallback(async (item: CalendarItem) => {
    pendingWritesRef.current += 1
    setSyncStatus("syncing")
    try {
      const saved = await familyFlowCloudStorage.saveItem(item, deviceUser)
      setSyncStatus("online")
      return saved
    } catch (error) {
      setSyncStatus("offline")
      throw error
    } finally {
      pendingWritesRef.current -= 1
    }
  }, [deviceUser])

  const removeCloudItem = useCallback(async (item: Pick<CalendarItem, "id" | "revision">) => {
    pendingWritesRef.current += 1
    setSyncStatus("syncing")
    try {
      await familyFlowCloudStorage.deleteItem(item)
      setSyncStatus("online")
    } catch (error) {
      setSyncStatus("offline")
      throw error
    } finally {
      pendingWritesRef.current -= 1
    }
  }, [])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    let active = true
    let handleControllerChange: (() => void) | null = null
    clearLegacyCalendarData()
    setState((current) => ({ ...current, avatars: loadLocalAvatars() }))
    const savedDeviceUser = loadDeviceUser()
    setDeviceUser(savedDeviceUser)
    setReminderUrl(loadReminderUrl())

    if ("serviceWorker" in navigator) {
      handleControllerChange = () => {
        const key = "du-machst-das:sw-reloaded:v17"
        if (window.sessionStorage.getItem(key)) return
        window.sessionStorage.setItem(key, "1")
        window.location.reload()
      }
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange)
      navigator.serviceWorker.register("/sw.js")
        .then(async (registration) => {
          void registration.update()
          const status = await readPushState()
          if (!active) return
          setPushState(status)
          if (status === "enabled" && savedDeviceUser) {
            const url = await refreshPushPerson(savedDeviceUser)
            if (active && url) setReminderUrl(url)
          }
        })
        .catch(() => active && setPushState("unsupported"))
    } else {
      setPushState("unsupported")
    }

    void syncFromCloud(true).finally(() => {
      if (active) setReady(true)
    })

    return () => {
      active = false
      if ("serviceWorker" in navigator && handleControllerChange) {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange)
      }
    }
  }, [syncFromCloud])

  useEffect(() => {
    if (!ready) return

    const refresh = () => {
      if (document.visibilityState === "visible") void syncFromCloud(false)
    }
    const interval = window.setInterval(refresh, 5000)

    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refresh)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [ready, syncFromCloud])

  useEffect(() => {
    if (!ready) return
    const context = (document as Document & { modelContext?: WebMCPContext }).modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const register = (tool: Parameters<WebMCPContext["registerTool"]>[0]) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined)
      } catch {
        // The app remains fully usable when this proposed browser API is unavailable.
      }
    }

    register({
      name: "list_calendar_items",
      title: "Kalendereinträge auflisten",
      description: "Listet die gemeinsam gespeicherten FamilyFlow-Termine und -Aufträge, optional nach Datum und Art gefiltert.",
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          kind: { type: "string", enum: ["event", "task"] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        const value = typeof input === "object" && input ? input as { date?: unknown; kind?: unknown } : {}
        if (value.date !== undefined && (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date))) throw new Error("date must use YYYY-MM-DD")
        if (value.kind !== undefined && value.kind !== "event" && value.kind !== "task") throw new Error("kind must be event or task")
        const dateFilter = typeof value.date === "string" ? value.date : undefined
        const kindFilter = value.kind === "event" || value.kind === "task" ? value.kind : undefined
        const items = sortItems(stateRef.current.items.filter((item) => (!dateFilter || itemCoversDate(item, dateFilter)) && (!kindFilter || item.kind === kindFilter)))
        return { count: items.length, items }
      },
    })

    register({
      name: "create_calendar_item",
      title: "Kalendereintrag erstellen",
      description: "Erstellt einen Termin oder Auftrag im gemeinsamen FamilyFlow-Kalender und aktualisiert die sichtbare App.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["event", "task"] },
          title: { type: "string", minLength: 1, maxLength: 120 },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          eventType: { type: "string", enum: ["private", "work", "vacation", "holidays", "birthday", "other"] },
          time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
          note: { type: "string", maxLength: 1000 },
          person: { type: "string", enum: ["all", "sascha", "katharina", "arjen"] },
        },
        required: ["kind", "title", "date"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        if (typeof input !== "object" || !input) throw new Error("input must be an object")
        const value = input as { kind?: unknown; title?: unknown; date?: unknown; endDate?: unknown; eventType?: unknown; time?: unknown; note?: unknown; person?: unknown }
        if (value.kind !== "event" && value.kind !== "task") throw new Error("kind must be event or task")
        if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 120) throw new Error("title is required")
        if (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error("date must use YYYY-MM-DD")
        if (value.endDate !== undefined && (typeof value.endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.endDate) || value.endDate < value.date)) throw new Error("endDate must be on or after date")
        if (value.eventType !== undefined && value.eventType !== "private" && value.eventType !== "work" && value.eventType !== "vacation" && value.eventType !== "holidays" && value.eventType !== "birthday" && value.eventType !== "other") throw new Error("unknown eventType")
        if (value.time !== undefined && (typeof value.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))) throw new Error("time must use HH:MM")
        if (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 1000)) throw new Error("note is too long")
        const nextEventType = (value.eventType ?? "private") as EventType
        const needsPerson = value.kind === "task" || !isUnassignedEventType(nextEventType)
        if (needsPerson && value.person !== "all" && value.person !== "sascha" && value.person !== "katharina" && value.person !== "arjen") throw new Error("unknown person")
        if (value.kind === "task" && value.person === "all") throw new Error("tasks require exactly one person")

        const item: CalendarItem = {
          id: `${value.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: value.kind,
          title: value.title.trim(),
          date: value.date,
          ...(typeof value.endDate === "string" && value.endDate !== value.date ? { endDate: value.endDate } : {}),
          ...(value.kind === "event" ? { eventType: nextEventType } : {}),
          ...(value.time ? { time: value.time } : {}),
          ...(typeof value.note === "string" && value.note.trim() ? { note: value.note.trim() } : {}),
          ...(value.kind === "event"
            ? { ...(!isUnassignedEventType(nextEventType) ? { person: value.person as PersonId | "all" } : {}) }
            : { assignee: value.person as PersonId, completed: false }),
        }
        const saved = await persistItem(item)
        setState((current) => ({ ...current, items: [...current.items.filter((candidate) => candidate.id !== saved.id), saved] }))
        setSelectedDate(item.date)
        return { id: item.id, status: "created", kind: item.kind }
      },
    })

    register({
      name: "complete_task",
      title: "Auftrag erledigen",
      description: "Markiert einen vorhandenen FamilyFlow-Auftrag anhand seiner ID als erledigt.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const value = typeof input === "object" && input ? input as { id?: unknown } : {}
        if (typeof value.id !== "string" || !value.id) throw new Error("id is required")
        const task = stateRef.current.items.find((item) => item.id === value.id && item.kind === "task")
        if (!task) throw new Error("task not found")
        const saved = await persistItem({ ...task, completed: true })
        setState((current) => ({ ...current, items: current.items.map((item) => item.id === value.id ? saved : item) }))
        return { id: value.id, status: "completed" }
      },
    })

    return () => lifecycle.abort()
  }, [persistItem, ready])

  const monthCells = useMemo(() => getMonthCells(month), [month])
  const calendarVisibleLimit = monthCells.length === 35 ? 4 : 3
  const selectedItems = useMemo(
    () => sortItems(state.items.filter((item) => itemCoversDate(item, selectedDate))),
    [selectedDate, state.items],
  )
  const selectedWastePickups = useMemo(() => wastePickupsForDate(selectedDate), [selectedDate])
  const todayItems = useMemo(
    () => sortItems(state.items.filter((item) => itemCoversDate(item, todayKey))),
    [state.items, todayKey],
  )

  const currentUser = deviceUser ?? "sascha"
  const nextSevenDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const date = dateFromKey(todayKey)
      date.setDate(date.getDate() + index)
      return localDateKey(date)
    }),
    [todayKey],
  )
  const upcomingItems = useMemo(() => {
    const lastDay = nextSevenDays[nextSevenDays.length - 1]
    return state.items.filter((item) => {
      if (!itemOverlapsRange(item, todayKey, lastDay)) return false
      if (item.kind === "task") return item.assignee === currentUser && !item.completed
      const eventType = eventTypeOf(item)
      if (eventType === "holidays") return false
      return isUnassignedEventType(eventType) || item.person === currentUser || item.person === "all"
    })
  }, [currentUser, nextSevenDays, state.items, todayKey])
  const upcomingTasks = sortUpcomingItems(upcomingItems.filter((item) => item.kind === "task"))
  const upcomingEvents = sortUpcomingItems(upcomingItems.filter((item) => item.kind === "event"))
  const upcomingAgenda = useMemo<HomeAgendaEntry[]>(() => {
    const lastDay = nextSevenDays[nextSevenDays.length - 1]
    const entries: HomeAgendaEntry[] = [
      ...upcomingItems.map((item) => ({ type: "calendar" as const, item })),
      ...WASTE_PICKUPS
        .filter((item) => item.date >= todayKey && item.date <= lastDay)
        .map((item) => ({ type: "waste" as const, item, completed: Boolean(wasteCompletions[item.id]?.completed) })),
    ]
    return entries.sort((left, right) => {
      const dateOrder = left.item.date.localeCompare(right.item.date)
      if (dateOrder) return dateOrder
      const leftTime = left.type === "waste" ? "05:00" : left.item.time || "99:99"
      const rightTime = right.type === "waste" ? "05:00" : right.item.time || "99:99"
      return leftTime.localeCompare(rightTime) || left.item.title.localeCompare(right.item.title)
    })
  }, [nextSevenDays, todayKey, upcomingItems, wasteCompletions])
  const upcomingOpenCount = upcomingAgenda.filter((entry) => entry.type === "calendar" || !entry.completed).length
  const birthdayCount = upcomingEvents.filter((item) => eventTypeOf(item) === "birthday" || /geburtstag/i.test(item.title)).length
  const greeting = nowRef.current.getHours() < 11 ? "Guten Morgen" : nowRef.current.getHours() < 18 ? "Guten Tag" : "Guten Abend"

  function chooseDeviceUser(person: PersonId) {
    saveDeviceUser(person)
    setDeviceUser(person)
    setProfilePickerOpen(false)
    if (pushState === "enabled") {
      void refreshPushPerson(person).then((url) => url && setReminderUrl(url)).catch(() => {
        setPushState("available")
        toast.error("Die Mitteilungen müssen für dieses Profil erneut verbunden werden.")
      })
    }
    toast.success(`Dieses Gerät ist jetzt ${PEOPLE[person].name} zugeordnet.`)
  }

  function requestProfileChange(target: PersonId | null = null) {
    if (!deviceUser) {
      if (target) chooseDeviceUser(target)
      else setProfilePickerOpen(true)
      return
    }
    setProfileUnlockTarget(target)
    setProfileUnlockCode("")
    setProfileUnlockError("")
    setProfileUnlockOpen(true)
  }

  async function unlockProfileChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileUnlockCode || profileUnlockBusy) return
    setProfileUnlockBusy(true)
    setProfileUnlockError("")
    try {
      const response = await fetch("/api/profile/unlock", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: profileUnlockCode }),
      })
      const payload = await response.json().catch(() => ({})) as { valid?: boolean; error?: string }
      if (!response.ok || !payload.valid) throw new Error(payload.error || "Der Änderungscode ist falsch.")

      const target = profileUnlockTarget
      setProfileUnlockOpen(false)
      setProfileUnlockCode("")
      setProfileUnlockTarget(null)
      if (target) chooseDeviceUser(target)
      else setProfilePickerOpen(true)
    } catch (error) {
      setProfileUnlockError(error instanceof Error ? error.message : "Der Änderungscode ist falsch.")
    } finally {
      setProfileUnlockBusy(false)
    }
  }

  async function activatePush() {
    if (!deviceUser || pushBusy) return
    setPushBusy(true)
    try {
      const url = await enablePush(deviceUser)
      setReminderUrl(url)
      setPushState("enabled")
      toast.success(`Mitteilungen für ${PEOPLE[deviceUser].name} sind aktiv.`)
    } catch (error) {
      setPushState(await readPushState())
      toast.error(error instanceof Error ? error.message : "Mitteilungen konnten nicht aktiviert werden.")
    } finally {
      setPushBusy(false)
    }
  }

  async function deactivatePush() {
    if (pushBusy) return
    setPushBusy(true)
    try {
      await disablePush()
      setReminderUrl(null)
      setPushState(await readPushState())
      toast.success("Mitteilungen auf diesem Gerät sind deaktiviert.")
    } catch {
      toast.error("Mitteilungen konnten nicht deaktiviert werden.")
    } finally {
      setPushBusy(false)
    }
  }

  async function copyReminderLink() {
    if (!reminderUrl) return
    try {
      await navigator.clipboard.writeText(reminderUrl)
      toast.success("Persönlicher Erinnerungslink kopiert.")
    } catch {
      toast.error("Der Link konnte nicht kopiert werden.")
    }
  }

  function changeMonth(offset: number) {
    const direction = offset > 0 ? "next" : "previous"
    const sequence = ++monthTransitionSequenceRef.current
    setMonthTransition({ direction, sequence })
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12))
  }

  function startCalendarSwipe(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    calendarSwipeRef.current = { x: touch.clientX, y: touch.clientY }
    suppressCalendarClickRef.current = false
  }

  function endCalendarSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = calendarSwipeRef.current
    const touch = event.changedTouches[0]
    calendarSwipeRef.current = null
    if (!start || !touch) return

    const horizontalDistance = touch.clientX - start.x
    const verticalDistance = touch.clientY - start.y
    if (Math.abs(horizontalDistance) < 55 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance) * 1.25) return

    suppressCalendarClickRef.current = true
    changeMonth(horizontalDistance < 0 ? 1 : -1)
    window.setTimeout(() => {
      suppressCalendarClickRef.current = false
    }, 350)
  }

  function openDay(key: string) {
    const date = dateFromKey(key)
    if (date.getMonth() !== month.getMonth() || date.getFullYear() !== month.getFullYear()) {
      setMonthTransition(null)
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    }
    setSelectedDate(key)
    setDaySheetOpen(!wideCalendar)
  }

  function openWastePickup(pickup: WastePickup) {
    const date = dateFromKey(pickup.date)
    setSelectedDate(pickup.date)
    setMonthTransition(null)
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    setFilter("waste")
    setView("calendar")
    setDaySheetOpen(!wideCalendar)
  }

  function startCreate(kind: "event" | "task", date = selectedDate) {
    setDaySheetOpen(false)
    setEditing({ kind, date })
  }

  function startEdit(item: CalendarItem) {
    setDaySheetOpen(false)
    setEditing({ kind: item.kind, date: item.date, item })
  }

  async function saveItem(item: CalendarItem) {
    const previousItem = stateRef.current.items.find((candidate) => candidate.id === item.id)
    setState((current) => ({
      ...current,
      items: current.items.some((candidate) => candidate.id === item.id)
        ? current.items.map((candidate) => candidate.id === item.id ? item : candidate)
        : [...current.items, item],
    }))
    setSelectedDate(item.date)
    const date = dateFromKey(item.date)
    setMonthTransition(null)
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    setEditing(null)

    try {
      const saved = await persistItem(item)
      setState((current) => ({
        ...current,
        items: current.items.map((candidate) => candidate.id === saved.id ? saved : candidate),
      }))
      toast.success(item.kind === "event" ? "Termin für alle gespeichert." : "Auftrag für alle gespeichert.")
    } catch (error) {
      if (error instanceof CloudRequestError && error.code === "version_conflict" && error.current) {
        setState((current) => ({ ...current, items: [...current.items.filter((candidate) => candidate.id !== item.id), error.current!] }))
        toast.error("Der Eintrag wurde auf einem anderen Gerät geändert. Die aktuelle Version wurde neu geladen.")
        return
      }
      setState((current) => ({
        ...current,
        items: previousItem
          ? [...current.items.filter((candidate) => candidate.id !== item.id), previousItem]
          : current.items.filter((candidate) => candidate.id !== item.id),
      }))
      setEditing({ item, kind: item.kind, date: item.date, unsaved: true })
      toast.error("Nicht im gemeinsamen Kalender gespeichert. Dein Eintrag bleibt geöffnet, damit nichts verloren geht.")
    }
  }

  async function deleteItem(id: string) {
    const removed = stateRef.current.items.find((item) => item.id === id)
    if (!removed) return
    setState((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }))
    setEditing(null)

    try {
      await removeCloudItem(removed)
      toast.success("Eintrag für alle gelöscht.")
    } catch (error) {
      const currentItem = error instanceof CloudRequestError && error.code === "version_conflict" ? error.current : removed
      if (currentItem) setState((current) => ({ ...current, items: [...current.items.filter((item) => item.id !== currentItem.id), currentItem] }))
      toast.error(error instanceof CloudRequestError && error.code === "version_conflict" ? "Der Eintrag wurde auf einem anderen Gerät geändert und neu geladen." : "Der Eintrag konnte nicht aus dem gemeinsamen Kalender gelöscht werden.")
    }
  }

  async function createTodoItem(kind: TodoItem["kind"], title: string, note: string, date?: string, id?: string) {
    const item: TodoItem = {
      id: id || `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      title,
      ...(note ? { note } : {}),
      createdBy: currentUser,
      ...(date ? { date } : {}),
    }

    pendingWritesRef.current += 1
    setSyncStatus("syncing")
    try {
      const saved = await familyFlowCloudStorage.saveTodoItem(item)
      setTodoItems((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)])
      setSyncStatus("online")
      toast.success(kind === "task" ? "Offener Auftrag eingetragen." : "Offener Termin eingetragen.")
      return saved
    } catch (error) {
      setSyncStatus("offline")
      toast.error(error instanceof Error ? error.message : "Der Eintrag konnte nicht gespeichert werden.")
      return null
    } finally {
      pendingWritesRef.current -= 1
    }
  }

  async function takeTodoItem(item: TodoItem, date: string, completed: boolean) {
    pendingWritesRef.current += 1
    setSyncStatus("syncing")
    try {
      const result = await familyFlowCloudStorage.takeTodoItem(item.id, currentUser, completed ? undefined : date, completed)
      const calendarItem = result.calendarItem

      setTodoItems((current) => current.filter((entry) => entry.id !== item.id))
      if (calendarItem) {
        setState((current) => ({ ...current, items: [...current.items.filter((entry) => entry.id !== calendarItem!.id), calendarItem!] }))
      }
      setSyncStatus("online")
      toast.success(completed ? "Als erledigt übernommen." : `${item.kind === "task" ? "Auftrag" : "Termin"} in deinen Kalender übernommen.`)
      return true
    } catch (error) {
      setSyncStatus("offline")
      toast.error(error instanceof Error ? error.message : "Der Eintrag konnte nicht übernommen werden.")
      return false
    } finally {
      pendingWritesRef.current -= 1
    }
  }

  async function deleteTodoItem(item: TodoItem) {
    pendingWritesRef.current += 1
    setSyncStatus("syncing")
    try {
      await familyFlowCloudStorage.deleteTodoItem(item.id)
      setTodoItems((current) => current.filter((entry) => entry.id !== item.id))
      setSyncStatus("online")
      toast.success("Eintrag entfernt.")
    } catch (error) {
      setSyncStatus("offline")
      toast.error(error instanceof Error ? error.message : "Der Eintrag konnte nicht entfernt werden.")
    } finally {
      pendingWritesRef.current -= 1
    }
  }

  async function addShoppingItem(label: string, productKey: string) {
    const cleanLabel = label.trim()
    if (!cleanLabel) return false
    if (shoppingItems.some((item) => normalizeGroceryText(item.label) === normalizeGroceryText(cleanLabel))) {
      toast.info(`${cleanLabel} steht bereits auf der Liste.`)
      return true
    }

    const item: ShoppingItem = {
      id: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: cleanLabel,
      productKey,
      addedBy: currentUser,
    }
    pendingWritesRef.current += 1
    setSyncStatus("syncing")
    try {
      const saved = await familyFlowCloudStorage.saveShoppingItem(item)
      setShoppingItems((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)])
      setSyncStatus("online")
      return true
    } catch (error) {
      setSyncStatus("offline")
      toast.error(error instanceof Error ? error.message : "Der Artikel konnte nicht gespeichert werden.")
      return false
    } finally {
      pendingWritesRef.current -= 1
    }
  }

  async function removeShoppingItem(item: ShoppingItem) {
    setShoppingItems((current) => current.filter((entry) => entry.id !== item.id))
    pendingWritesRef.current += 1
    setSyncStatus("syncing")
    try {
      await familyFlowCloudStorage.deleteShoppingItem(item.id)
      setSyncStatus("online")
      return true
    } catch (error) {
      setShoppingItems((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current])
      setSyncStatus("offline")
      toast.error(error instanceof Error ? error.message : "Der Artikel konnte nicht abgehakt werden.")
      return false
    } finally {
      pendingWritesRef.current -= 1
    }
  }

  async function toggleTask(item: CalendarItem) {
    if (item.kind !== "task") return
    const updated = { ...item, completed: !item.completed }
    setState((current) => ({
      ...current,
      items: current.items.map((candidate) => candidate.id === item.id ? updated : candidate),
    }))

    try {
      const saved = await persistItem(updated)
      setState((current) => ({
        ...current,
        items: current.items.map((candidate) => candidate.id === saved.id ? saved : candidate),
      }))
    } catch (error) {
      const currentItem = error instanceof CloudRequestError && error.code === "version_conflict" ? error.current : item
      setState((current) => ({
        ...current,
        items: current.items.map((candidate) => candidate.id === item.id ? currentItem ?? item : candidate),
      }))
      toast.error(error instanceof CloudRequestError && error.code === "version_conflict" ? "Der Auftrag wurde auf einem anderen Gerät geändert und neu geladen." : "Der Auftrag konnte nicht synchronisiert werden.")
    }
  }

  async function toggleWastePickup(pickup: WastePickup) {
    const previous = wasteCompletions[pickup.id]
    const completed = !previous?.completed
    const optimistic: WasteCompletion = {
      pickupId: pickup.id,
      completed,
      ...(completed ? { completedBy: currentUser } : {}),
    }
    setWasteCompletions((current) => ({ ...current, [pickup.id]: optimistic }))
    pendingWritesRef.current += 1
    setSyncStatus("syncing")

    try {
      const saved = await familyFlowCloudStorage.saveWasteCompletion(pickup.id, completed, currentUser)
      setWasteCompletions((current) => ({ ...current, [pickup.id]: saved }))
      setSyncStatus("online")
      toast.success(completed ? "Als rausgestellt bestätigt – für alle Geräte." : "Bestätigung zurückgenommen.")
    } catch (error) {
      setWasteCompletions((current) => {
        const next = { ...current }
        if (previous) next[pickup.id] = previous
        else delete next[pickup.id]
        return next
      })
      setSyncStatus("offline")
      toast.error(error instanceof Error ? error.message : "Die Bestätigung konnte nicht synchronisiert werden.")
    } finally {
      pendingWritesRef.current -= 1
    }
  }

  async function restoreEvent(item: CalendarItem) {
    setState((current) => current.items.some((candidate) => candidate.id === item.id)
      ? current
      : { ...current, items: [...current.items, item] })

    try {
      const saved = await persistItem(item)
      setState((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === saved.id ? saved : candidate) }))
      toast.success("Termin wiederhergestellt.")
    } catch {
      setState((current) => ({ ...current, items: current.items.filter((candidate) => candidate.id !== item.id) }))
      toast.error("Der Termin konnte nicht wiederhergestellt werden.")
    }
  }

  async function completeEvent(item: CalendarItem) {
    if (item.kind !== "event") return

    setState((current) => ({
      ...current,
      items: current.items.filter((candidate) => candidate.id !== item.id),
    }))

    try {
      await removeCloudItem(item)
      toast.success("Termin für alle erledigt und entfernt.", {
        action: {
          label: "Rückgängig",
          onClick: () => void restoreEvent(item),
        },
      })
    } catch (error) {
      const currentItem = error instanceof CloudRequestError && error.code === "version_conflict" ? error.current : item
      setState((current) => currentItem && !current.items.some((candidate) => candidate.id === currentItem.id)
        ? { ...current, items: [...current.items, currentItem] }
        : current)
      toast.error(error instanceof CloudRequestError && error.code === "version_conflict" ? "Der Termin wurde auf einem anderen Gerät geändert und neu geladen." : "Der Termin konnte nicht aus dem gemeinsamen Kalender entfernt werden.")
    }
  }

  async function updatePhoto(personId: PersonId, file?: File) {
    if (!file || !file.type.startsWith("image/")) return
    try {
      const result = await resizePhoto(file)
      const avatars = { ...stateRef.current.avatars, [personId]: result }
      setState((current) => ({ ...current, avatars }))
      saveLocalAvatars(avatars)
      toast.success(`Profilbild von ${PEOPLE[personId].name} aktualisiert.`)
    } catch {
      toast.error("Das Foto konnte nicht verarbeitet werden.")
    }
  }

  const Shell = embedded ? "div" : "main"

  if (!ready) {
    return (
      <Shell className={embedded ? "legacy-tools legacy-tools--loading" : "app-shell app-shell--loading"}>
        <Logo />
        <span className="loading-dot" aria-label="Done wird geladen" />
      </Shell>
    )
  }

  const daySummary = filter === "waste"
    ? `${selectedWastePickups.length} ${selectedWastePickups.length === 1 ? "Abholung" : "Abholungen"}`
    : `${selectedItems.length} ${selectedItems.length === 1 ? "Eintrag" : "Einträge"}`
  const dayContent = (<>{filter === "waste" ? (
            <>
              <div className="waste-source">
                <Trash2 aria-hidden="true" />
                <span><strong>{WASTE_CALENDAR_SOURCE.area}</strong><small>{WASTE_CALENDAR_SOURCE.provider} · Stand {WASTE_CALENDAR_SOURCE.publishedAt}</small></span>
              </div>
              <div className="day-sheet__list day-sheet__list--waste">
                {selectedWastePickups.length
                  ? selectedWastePickups.map((pickup) => <WastePickupRow key={pickup.id} pickup={pickup} completion={wasteCompletions[pickup.id]} onToggle={toggleWastePickup} />)
                  : <div className="empty-row empty-row--waste"><Trash2 aria-hidden="true" /><strong>Keine Abholung</strong><span>An diesem Tag wird keine der vier Tonnen geleert.</span></div>}
              </div>
            </>
          ) : (
            <>
              <div className="day-family-strip" aria-label="Familienmitglieder">
                {(Object.keys(PEOPLE) as PersonId[]).map((id) => <span key={id}><ProfileAvatar personId={id} avatars={state.avatars} size="md" /><small>{PEOPLE[id].name}</small></span>)}
              </div>
              <div className="day-sheet__list">
                {selectedItems.length ? selectedItems.map((item) => <ItemRow key={item.id} item={item} avatars={state.avatars} onItem={startEdit} onToggle={toggleTask} />) : <div className="empty-row"><CalendarDays aria-hidden="true" /><strong>Noch nichts geplant</strong><span>Lege den ersten Termin oder Auftrag für diesen Tag an.</span></div>}
              </div>
            </>
          )}</>)

  return (
    <Shell className={embedded ? "legacy-tools" : "app-shell"}>
      {!embedded && <header className="topbar">
        <Logo />
        <div className="topbar__actions">
          <button
            className={`notification-indicator notification-indicator--${pushState}`}
            type="button"
            onClick={() => pushState === "enabled" ? setView("family") : void activatePush()}
            aria-label={pushState === "enabled" ? "Mitteilungen aktiv – Einstellungen öffnen" : "Mitteilungen aktivieren"}
            title={pushState === "enabled" ? "Mitteilungen aktiv" : "Mitteilungen aktivieren"}
          >
            {pushState === "denied" ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
            {pushState !== "enabled" && pushState !== "checking" && <span aria-hidden="true" />}
          </button>
          <button
            className={`sync-indicator sync-indicator--${syncStatus}`}
            type="button"
            onClick={() => void syncFromCloud(true)}
            aria-label={syncStatus === "online" ? "Gemeinsamer Kalender aktuell – jetzt neu laden" : syncStatus === "syncing" ? "Gemeinsamer Kalender wird synchronisiert" : "Gemeinsamer Kalender nicht erreichbar – erneut versuchen"}
            title={syncStatus === "online" ? "Gemeinsamer Kalender aktuell" : syncStatus === "syncing" ? "Synchronisiert …" : "Gemeinsamer Kalender nicht erreichbar"}
          >
            {syncStatus === "online" ? <Cloud aria-hidden="true" /> : syncStatus === "syncing" ? <LoaderCircle aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
          </button>
          <button className="current-profile" type="button" onClick={() => requestProfileChange()} aria-label="Gerätenutzer wechseln">
            <ProfileAvatar personId={currentUser} avatars={state.avatars} size="md" />
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </header>}

      {embedded && <nav className="p-tools-tabs" aria-label="Listen und Einstellungen"><button type="button" className={view === "todo" ? "active" : ""} onClick={() => { setView("todo"); setShoppingOpen(false) }}><ListTodo size={16} /> Aufträge & Listen</button><button type="button" className={view === "family" ? "active" : ""} onClick={() => setView("family")}><Bell size={16} /> Erinnerungen & Profil</button></nav>}
      <div className={embedded ? "legacy-tools__content" : "view-scroll"}>
        {view === "home" && (
          <section className="screen screen--home" aria-labelledby="home-title">
            <div className="home-welcome">
              <div className="home-welcome__copy">
                <p className="eyebrow">{formatShortDate(todayKey)}</p>
                <h1 id="home-title">{greeting},<br />{PEOPLE[currentUser].name} <span aria-hidden="true">☀️</span></h1>
                <p>Schön, dass du da bist! In den nächsten sieben Tagen stehen {upcomingOpenCount} {upcomingOpenCount === 1 ? "Sache" : "Dinge"} an. Du schaffst das!</p>
              </div>
              <div className="home-family-cluster" aria-label="Eure Familie">
                {(Object.keys(PEOPLE) as PersonId[]).map((id) => <ProfileAvatar key={id} personId={id} avatars={state.avatars} size={id === currentUser ? "xl" : "lg"} />)}
                <Heart aria-hidden="true" />
              </div>
            </div>

            <section className="home-stats" aria-label="Übersicht der nächsten sieben Tage">
              <div className="home-stat home-stat--task"><ClipboardCheck aria-hidden="true" /><strong>{upcomingTasks.length}</strong><span>Aufträge</span><small>Nächste 7 Tage</small></div>
              <div className="home-stat home-stat--event"><CalendarDays aria-hidden="true" /><strong>{upcomingEvents.length}</strong><span>Termine</span><small>Nächste 7 Tage</small></div>
              <div className="home-stat home-stat--birthday"><Gift aria-hidden="true" /><strong>{birthdayCount}</strong><span>{birthdayCount === 1 ? "Geburtstag" : "Geburtstage"}</span><small>Diese Woche</small></div>
              <div className="home-stat home-stat--motto"><Heart aria-hidden="true" /><span>Kleine Momente.<br />Große Familie.</span></div>
            </section>

            <HomeAgendaList
              entries={upcomingAgenda}
              today={todayKey}
              avatars={state.avatars}
              onShowCalendar={() => { setFilter("all"); setView("calendar") }}
              onItem={startEdit}
              onToggle={toggleTask}
              onComplete={completeEvent}
              onWaste={openWastePickup}
              onToggleWaste={toggleWastePickup}
            />
          </section>
        )}

        {view === "calendar" && (
          <section className="screen screen--calendar" aria-labelledby="calendar-title">
            <div className="today-strip">
              <div className="today-strip__date">
                <span>Heute</span>
                <small>{formatFullDate(todayKey)}</small>
              </div>
              <div className="today-strip__stat today-strip__stat--task">
                <ClipboardCheck aria-hidden="true" />
                <span><strong>{todayItems.filter((item) => item.kind === "task" && !item.completed).length}</strong> Aufträge</span>
              </div>
              <div className="today-strip__stat today-strip__stat--event">
                <CalendarDays aria-hidden="true" />
                <span><strong>{todayItems.filter((item) => item.kind === "event").length}</strong> Termine</span>
              </div>
            </div>

            <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} className="filter-tabs">
              <TabsList className="filter-tabs__list">
                <TabsTrigger value="all">Termine &amp; Aufträge</TabsTrigger>
                <TabsTrigger value="waste" className="filter-trigger--waste"><Trash2 aria-hidden="true" /> Müll</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="month-toolbar">
              <h1
                id="calendar-title"
                key={`month-title-${month.getFullYear()}-${month.getMonth()}-${monthTransition?.sequence ?? 0}`}
                className={monthTransition ? `month-title--enter-${monthTransition.direction}` : undefined}
              >
                {monthLabel(month)}
              </h1>
              <div className="month-toolbar__actions">
                <button type="button" className="icon-button" onClick={() => changeMonth(-1)} aria-label="Vorheriger Monat"><ChevronLeft aria-hidden="true" /></button>
                <button type="button" className="icon-button" onClick={() => changeMonth(1)} aria-label="Nächster Monat"><ChevronRight aria-hidden="true" /></button>
                {filter === "all" && <button type="button" className="icon-button icon-button--add" onClick={() => startCreate("event", selectedDate)} aria-label="Eintrag hinzufügen"><Plus aria-hidden="true" /></button>}
              </div>
            </div>

            <div className="calendar-workspace">
            <div className="calendar" role="grid" aria-label={`Kalender ${monthLabel(month)}`}>
              <div className="calendar__weekdays" role="row">
                {WEEKDAYS.map((day) => <span key={day} role="columnheader">{day}</span>)}
              </div>
              <div
                key={`month-grid-${month.getFullYear()}-${month.getMonth()}-${monthTransition?.sequence ?? 0}`}
                className={`calendar__days calendar__days--${monthCells.length / 7}-weeks ${monthTransition ? `calendar__days--enter-${monthTransition.direction}` : ""}`}
                onTouchStart={startCalendarSwipe}
                onTouchEnd={endCalendarSwipe}
                onTouchCancel={() => {
                  calendarSwipeRef.current = null
                }}
              >
                {monthCells.map((cell) => {
                  const items = sortItems(state.items.filter((item) => itemCoversDate(item, cell.key)))
                  const wastePickups = wastePickupsForDate(cell.key)
                  const itemCount = filter === "waste" ? wastePickups.length : items.length
                  const selected = cell.key === selectedDate
                  const today = cell.key === todayKey
                  const visible = items.slice(0, calendarVisibleLimit)
                  const hasRange = visible.some(isMultiDayEvent)
                  const avatarItems = items.filter((item) => !isMultiDayEvent(item) || item.date === cell.key)
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      aria-selected={selected}
                      aria-current={today ? "date" : undefined}
                      key={cell.key}
                      className={`calendar-day ${filter === "waste" ? "calendar-day--waste" : ""} ${hasRange ? "calendar-day--has-range" : ""} ${!cell.currentMonth ? "calendar-day--outside" : ""} ${selected ? "calendar-day--selected" : ""} ${today ? "calendar-day--today" : ""}`}
                      onClick={(event) => {
                        if (suppressCalendarClickRef.current) {
                          event.preventDefault()
                          suppressCalendarClickRef.current = false
                          return
                        }
                        openDay(cell.key)
                      }}
                      aria-label={`${formatFullDate(cell.key)}, ${itemCount} ${filter === "waste" ? "Müllabholungen" : "Einträge"}`}
                    >
                      <span className="calendar-day__number">{cell.number}</span>
                      <span className="calendar-day__items">
                        {filter === "waste" ? wastePickups.map((pickup) => (
                          <span key={pickup.id} className={`calendar-chip calendar-chip--waste calendar-chip--waste-${pickup.kind} ${wasteCompletions[pickup.id]?.completed ? "calendar-chip--done" : ""}`}>
                            <span className="calendar-chip__bin" aria-hidden="true"><Trash2 /></span>
                            <span className="calendar-chip__title">{pickup.shortTitle}</span>
                          </span>
                        )) : visible.map((item) => {
                            const person = itemPerson(item)
                            const range = isMultiDayEvent(item)
                            const rangeStart = range && (item.date === cell.key || cell.date.getDay() === 1)
                            const rangeEnd = range && (itemEndDate(item) === cell.key || cell.date.getDay() === 0)
                            const showTitle = !range || item.date === cell.key
                            const eventType = eventTypeOf(item)
                            return (
                              <span key={item.id} className={`calendar-chip calendar-chip--${item.kind} ${item.kind === "event" ? `calendar-chip--event-${eventType}` : ""} ${range ? "calendar-chip--range" : ""} ${rangeStart ? "calendar-chip--range-start" : ""} ${rangeEnd ? "calendar-chip--range-end" : ""} ${person === null ? "calendar-chip--fixed" : person === "all" ? "calendar-chip--all" : `calendar-chip--${person}`} ${item.completed ? "calendar-chip--done" : ""}`}>
                                {showTitle && (eventType === "birthday" ? <Gift className="calendar-chip__event-icon" aria-hidden="true" /> : <span className="calendar-chip__dot" />)}
                                <span className={`calendar-chip__title ${showTitle ? "" : "calendar-chip__title--continuation"}`} aria-hidden={!showTitle}>{showTitle ? item.title : "\u00A0"}</span>
                              </span>
                            )
                          })}
                        {filter === "all" && items.length > calendarVisibleLimit && <span className="calendar-day__more">+{items.length - calendarVisibleLimit}</span>}
                      </span>
                      {filter === "all" && avatarItems.some((item) => itemPerson(item) !== null) && <AvatarStack people={avatarItems.map(itemPerson)} avatars={state.avatars} />}
                    </button>
                  )
                })}
              </div>
            </div>
            {wideCalendar && <aside className="day-panel" aria-labelledby="day-panel-title">
              <header className="day-panel__header">
                <span className="eyebrow">Ausgewählter Tag</span>
                <h2 id="day-panel-title">{formatFullDate(selectedDate)}</h2>
                <p aria-live="polite">{daySummary}</p>
                {filter === "all" && <div className="day-sheet__add">
                  <button type="button" onClick={() => startCreate("event")}><CalendarDays aria-hidden="true" /> Termin</button>
                  <button type="button" onClick={() => startCreate("task")}><ClipboardCheck aria-hidden="true" /> Auftrag</button>
                </div>}
              </header>
              {dayContent}
            </aside>}
            </div>
          </section>
        )}

        {view === "todo" && (shoppingOpen ? (
          <ShoppingListView
            items={shoppingItems}
            avatars={state.avatars}
            onBack={() => setShoppingOpen(false)}
            onAdd={addShoppingItem}
            onRemove={removeShoppingItem}
          />
        ) : (
          <section className="screen screen--todo" aria-labelledby="todo-title">
            <div className="todo-heading">
              <div><span className="eyebrow">Gemeinsam anpacken</span><h1 id="todo-title">Offene To-dos</h1><p>Hier landet alles, das noch keine Person und keinen festen Tag hat.</p></div>
              <span className="todo-heading__count">{todoItems.length}</span>
            </div>

            <button type="button" className="shopping-list-card" onClick={() => setShoppingOpen(true)} aria-label={`Einkaufsliste öffnen, ${shoppingItems.length} ${shoppingItems.length === 1 ? "Artikel" : "Artikel"}`}>
              <span className="shopping-list-card__icon"><ShoppingBasket aria-hidden="true" /></span>
              <span><strong>Einkaufsliste</strong><small>Gemeinsam sammeln, gemeinsam abhaken</small></span>
              <span className={`shopping-list-card__soon ${shoppingItems.length ? "shopping-list-card__soon--count" : ""}`}>{shoppingItems.length || <ChevronRight aria-hidden="true" />}</span>
            </button>

            <div className="todo-create-grid" aria-label="Neuen offenen Eintrag erstellen">
              <button type="button" onClick={() => setTodoCreateKind("task")}><span><ClipboardCheck aria-hidden="true" /></span><strong>Auftrag</strong><small>Offen eintragen</small><Plus aria-hidden="true" /></button>
              <button type="button" onClick={() => setTodoCreateKind("event")}><span><CalendarDays aria-hidden="true" /></span><strong>Termin</strong><small>Offen eintragen</small><Plus aria-hidden="true" /></button>
            </div>

            <section className="todo-pool" aria-labelledby="todo-pool-title">
              <div className="todo-pool__heading"><div><h2 id="todo-pool-title">Kann jemand übernehmen?</h2><p>{todoItems.length ? `${todoItems.length} ${todoItems.length === 1 ? "offener Eintrag" : "offene Einträge"}` : "Gerade ist alles verteilt"}</p></div><ListTodo aria-hidden="true" /></div>
              <div className="todo-list">
                {todoItems.length ? todoItems.map((item) => (
                  <article className={`todo-card todo-card--${item.kind}`} key={item.id}>
                    <span className="todo-card__icon">{item.kind === "task" ? <ClipboardCheck aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}</span>
                    <div className="todo-card__body">
                      <span className="todo-card__type">{item.kind === "task" ? "Auftrag" : "Termin"}</span>
                      <h3>{item.title}</h3>
                      {item.date && <span className="todo-card__date"><CalendarDays size={14}/>{formatShortDate(item.date)}</span>}
                      {item.note && <p>{item.note}</p>}
                      <span className="todo-card__creator"><ProfileAvatar personId={item.createdBy} avatars={state.avatars} size="xs" />Eingetragen von {PEOPLE[item.createdBy].name}</span>
                      <ActivityBadges activity={item.activity}/>
                    </div>
                    <div className="todo-card__actions">
                      {onOpenChat && <><button type="button" className="todo-card__chat" onClick={() => onOpenChat({entry:{kind:"todo",id:item.id},preview:item})}>Chat & Anhänge</button><button type="button" className="todo-card__chat" onClick={() => onOpenChat({entry:{kind:"todo",id:item.id},preview:item,initialPanel:"share"})}><Share2 size={14}/>Teilen</button></>}
                      <button type="button" className="todo-card__take" onClick={() => setTakingTodo(item)}>Übernehmen</button>
                      {item.createdBy === currentUser && <button type="button" className="todo-card__delete" onClick={() => void deleteTodoItem(item)} aria-label={`${item.title} entfernen`}><Trash2 aria-hidden="true" /></button>}
                    </div>
                  </article>
                )) : <div className="todo-empty"><span><Check aria-hidden="true" /></span><strong>Alles verteilt</strong><p>Neue offene Aufträge und Termine erscheinen hier für die ganze Familie.</p></div>}
              </div>
            </section>
          </section>
        ))}

        {view === "family" && (
          <section className="screen screen--family" aria-labelledby="family-title">
            <div className="family-heading">
              <span className="eyebrow">Eure drei Profile</span>
              <h1 id="family-title">{embedded ? "Erinnerungen & Profil" : "Unsere Familie"}</h1>
              <p>Auf jedem Gerät wird einmal ausgewählt, wem es gehört. Alle Termine, Aufträge und Listen werden automatisch gemeinsam gespeichert.</p>
            </div>

            <div className="family-list">
              {(Object.keys(PEOPLE) as PersonId[]).map((id) => (
                <article className={`family-card ${deviceUser === id ? "family-card--active" : ""}`} key={id}>
                  <div className="family-card__avatar">
                    <ProfileAvatar personId={id} avatars={state.avatars} size="xl" />
                    <label className="photo-button" aria-label={`Profilbild von ${PEOPLE[id].name} ändern`}>
                      <Camera aria-hidden="true" />
                      <input type="file" accept="image/*" onChange={(event) => updatePhoto(id, event.target.files?.[0])} />
                    </label>
                  </div>
                  <div className="family-card__body">
                    <h2>{PEOPLE[id].name}</h2>
                    {deviceUser === id ? <span className="device-badge"><Check aria-hidden="true" /> Dieses Gerät</span> : <span>Familienprofil</span>}
                  </div>
                  {deviceUser !== id && <button type="button" className="choose-device" onClick={() => requestProfileChange(id)}>Auswählen</button>}
                </article>
              ))}
            </div>

            <div className="local-note">
              <div className="local-note__icon"><Cloud aria-hidden="true" /></div>
              <div><strong>Alles gemeinsam gespeichert</strong><span>Termine, Aufträge, Einkaufsliste und Müllbestätigungen werden auf euren Geräten automatisch aktualisiert. Ein Familienlink oder Verbindungscode ist nicht mehr nötig.</span></div>
            </div>

            <section className="notification-card" aria-labelledby="notification-title">
              <div className="notification-card__icon">
                {pushState === "denied" ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
              </div>
              <div className="notification-card__body">
                <h2 id="notification-title">Mitteilungen</h2>
                <p>{pushState === "enabled"
                  ? `Dieses Gerät erhält neue Zuständigkeiten für ${PEOPLE[currentUser].name} und tägliche Erinnerungen für beide Kalender.`
                  : pushState === "needs-install"
                    ? "Füge „Done“ zuerst zum Home-Bildschirm hinzu und öffne die App von dort."
                    : pushState === "denied"
                      ? "Mitteilungen sind in den Browser- oder Geräteeinstellungen blockiert."
                      : pushState === "unsupported"
                        ? "Mitteilungen werden auf diesem Gerät nicht unterstützt."
                    : "Erhalte neue Zuständigkeiten sowie tägliche Erinnerungen an Termine, Aufträge und Müllabholungen."}</p>
              </div>
              {pushState === "enabled" ? (
                <button type="button" className="notification-card__button notification-card__button--off" disabled={pushBusy} onClick={() => void deactivatePush()}>Aus</button>
              ) : (
                <button type="button" className="notification-card__button" disabled={pushBusy || pushState === "denied" || pushState === "unsupported"} onClick={() => void activatePush()}>
                  {pushBusy ? "…" : "Aktivieren"}
                </button>
              )}
            </section>

            {pushState === "enabled" && reminderUrl && (
              <section className="reminder-card" aria-labelledby="reminder-title">
                <div>
                  <span className="eyebrow">Tagesüberblick</span>
                  <h2 id="reminder-title">Morgens um 07:00 Uhr</h2>
                  <p>Eine Meldung kommt nur, wenn heute etwas für dich anliegt oder eine Mülltonne geleert wird.</p>
                </div>
                <button type="button" onClick={() => void copyReminderLink()}><Copy aria-hidden="true" /> Link kopieren</button>
              </section>
            )}
          </section>
        )}
      </div>

      {!embedded && <nav className="bottom-nav" aria-label="Hauptnavigation">
        {!toolsOnly && <NavButton active={view === "home"} label="Home" icon={<Home aria-hidden="true" />} onClick={() => setView("home")} />}
        {!toolsOnly && <NavButton active={view === "calendar"} label="Kalender" icon={<CalendarDays aria-hidden="true" />} onClick={() => setView("calendar")} />}
        <NavButton active={view === "todo"} label="To-do" icon={<ListTodo aria-hidden="true" />} badge={todoItems.length + (shoppingItems.length > 0 ? 1 : 0)} onClick={() => { setView("todo"); setShoppingOpen(false) }} />
        <NavButton active={view === "family"} label={toolsOnly ? "Einstellungen" : "Familie"} icon={<Users aria-hidden="true" />} onClick={() => setView("family")} />
      </nav>}

      <Sheet open={daySheetOpen && !wideCalendar} onOpenChange={setDaySheetOpen}>
        <SheetContent side="bottom" className={`day-sheet ${filter === "waste" ? "day-sheet--waste" : ""}`}>
          <div className="day-sheet__handle" aria-hidden="true" />
          <SheetHeader className="day-sheet__header">
            <div>
              <SheetTitle>{formatFullDate(selectedDate)}</SheetTitle>
              <SheetDescription>{filter === "waste"
                ? selectedWastePickups.length
                  ? `${selectedWastePickups.length} ${selectedWastePickups.length === 1 ? "Abholung" : "Abholungen"}`
                  : "Keine Müllabholung"
                : selectedItems.length
                  ? `${selectedItems.length} ${selectedItems.length === 1 ? "Eintrag" : "Einträge"}`
                  : "Noch nichts geplant"}</SheetDescription>
            </div>
            {filter === "all" && <div className="day-sheet__add">
              <button type="button" onClick={() => startCreate("event")}><CalendarDays aria-hidden="true" /> Termin</button>
              <button type="button" onClick={() => startCreate("task")}><ClipboardCheck aria-hidden="true" /> Auftrag</button>
            </div>}
          </SheetHeader>
          {dayContent}
        </SheetContent>
      </Sheet>

      <Dialog open={!deviceUser || profilePickerOpen} onOpenChange={(open) => deviceUser && setProfilePickerOpen(open)}>
        <DialogContent className="profile-picker" showCloseButton={Boolean(deviceUser)} onPointerDownOutside={(event) => !deviceUser && event.preventDefault()} onEscapeKeyDown={(event) => !deviceUser && event.preventDefault()}>
          <DialogHeader className="profile-picker__header">
            <Logo compact />
            <DialogTitle>Wer benutzt dieses Gerät?</DialogTitle>
            <DialogDescription>So zeigt „Done“ auf der Startseite genau die passenden Aufträge und Termine.</DialogDescription>
          </DialogHeader>
          <div className="profile-picker__choices">
            {(Object.keys(PEOPLE) as PersonId[]).map((id) => (
              <button type="button" key={id} onClick={() => chooseDeviceUser(id)}>
                <ProfileAvatar personId={id} avatars={state.avatars} size="lg" />
                <strong>{PEOPLE[id].name}</strong>
                <ChevronRight aria-hidden="true" />
              </button>
            ))}
          </div>
          <p className="profile-picker__note">Die Auswahl wird nur auf diesem Gerät gespeichert. Zum späteren Ändern ist der Änderungscode nötig.</p>
        </DialogContent>
      </Dialog>

      <Dialog open={profileUnlockOpen} onOpenChange={(open) => {
        if (!profileUnlockBusy) {
          setProfileUnlockOpen(open)
          if (!open) {
            setProfileUnlockCode("")
            setProfileUnlockError("")
            setProfileUnlockTarget(null)
          }
        }
      }}>
        <DialogContent className="profile-picker profile-unlock">
          <form onSubmit={unlockProfileChange}>
            <DialogHeader className="profile-picker__header">
              <DialogTitle>Nutzer ändern</DialogTitle>
              <DialogDescription>Gib den Änderungscode ein. Erst danach kann dieses Gerät einem anderen Familienmitglied zugeordnet werden.</DialogDescription>
            </DialogHeader>
            <div className="form-field profile-unlock__field">
              <Label htmlFor="profile-change-code">Änderungscode</Label>
              <Input
                id="profile-change-code"
                type="password"
                value={profileUnlockCode}
                onChange={(event) => {
                  setProfileUnlockCode(event.target.value)
                  if (profileUnlockError) setProfileUnlockError("")
                }}
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                aria-invalid={Boolean(profileUnlockError)}
                aria-describedby={profileUnlockError ? "profile-change-error" : undefined}
              />
              {profileUnlockError && <p id="profile-change-error" className="profile-unlock__error" role="alert">{profileUnlockError}</p>}
            </div>
            <DialogFooter className="profile-unlock__actions">
              <Button type="button" variant="outline" disabled={profileUnlockBusy} onClick={() => setProfileUnlockOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={profileUnlockBusy || !profileUnlockCode}>{profileUnlockBusy ? "Prüfe …" : "Freigeben"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {editing && (
        <ItemEditor
          key={`${editing.item?.id ?? "new"}-${editing.kind}-${editing.date}-${editing.unsaved ? "draft" : "saved"}`}
          editing={editing}
          avatars={state.avatars}
          localOnly={false}
          onOpenChange={(open) => !open && setEditing(null)}
          onSave={saveItem}
          onDelete={deleteItem}
        />
      )}

      {todoCreateKind && <TodoCreateDialog onOpenChat={onOpenChat} key={todoCreateKind} kind={todoCreateKind} onClose={() => setTodoCreateKind(null)} onSave={(title, note, date, id) => createTodoItem(todoCreateKind, title, note, date, id)} />}

      {takingTodo && <TodoTakeDialog key={takingTodo.id} item={takingTodo} person={currentUser} avatars={state.avatars} today={todayKey} onClose={() => setTakingTodo(null)} onTake={(date, completed) => takeTodoItem(takingTodo, date, completed)} />}

      {!embedded && <Toaster position="top-center" richColors closeButton />}
    </Shell>
  )
}

function NavButton({ active, label, icon, badge = 0, onClick }: { active: boolean; label: string; icon: React.ReactNode; badge?: number; onClick: () => void }) {
  return <button type="button" className={active ? "bottom-nav__item bottom-nav__item--active" : "bottom-nav__item"} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={badge ? `${label}, ${badge} offen` : label}><span className="bottom-nav__icon">{icon}{badge > 0 && <span className="bottom-nav__badge" aria-hidden="true">{badge > 99 ? "99+" : badge}</span>}</span><span>{label}</span></button>
}

function HomeAgendaList({
  entries,
  today,
  avatars,
  onShowCalendar,
  onItem,
  onToggle,
  onComplete,
  onWaste,
  onToggleWaste,
}: {
  entries: HomeAgendaEntry[]
  today: string
  avatars: FamilyFlowState["avatars"]
  onShowCalendar: () => void
  onItem: (item: CalendarItem) => void
  onToggle: (item: CalendarItem) => void
  onComplete: (item: CalendarItem) => void
  onWaste: (item: WastePickup) => void
  onToggleWaste: (item: WastePickup) => void
}) {
  return (
    <section className="home-reference home-reference--agenda">
      <div className="home-reference__heading">
        <h2>Das steht an die nächsten 7 Tage</h2>
        <button type="button" onClick={onShowCalendar}>Kalender <ChevronRight aria-hidden="true" /></button>
      </div>
      <div className="home-reference__list">
        {entries.length ? entries.map((entry) => {
          const item = entry.item
          const calendarItem = entry.type === "calendar" ? entry.item : null
          const wasteItem = entry.type === "waste" ? entry.item : null
          const dateLabel = calendarItem ? agendaDateLabel(calendarItem, today) : relativeDateLabel(wasteItem!.date, today)
          const activeToday = calendarItem ? itemCoversDate(calendarItem, today) : wasteItem!.date === today
          const person = calendarItem ? itemPerson(calendarItem) : null
          const eventType = calendarItem?.kind === "event" ? eventTypeOf(calendarItem) : null
          const unassignedEvent = eventType !== null && isUnassignedEventType(eventType)
          const rowKind = entry.type === "waste" ? `waste home-upcoming--waste-${item.kind}` : item.kind
          const details = entry.type === "waste"
            ? "Müllabholung · Hammelstrift"
            : calendarItem!.note || (eventType === "birthday" ? "Geburtstag" : eventType === "other" ? "Allgemeiner Termin" : eventType === "holidays" ? "Fester Termin" : person === "all" ? "Für alle" : PEOPLE[person!].name)
          const meta = calendarItem?.time ? `${calendarItem.time} Uhr · ${details}` : details
          return (
            <div className={`home-upcoming home-upcoming--${rowKind} ${entry.type === "waste" && entry.completed ? "home-upcoming--done" : ""}`} key={item.id}>
              {entry.type === "waste" ? (
                <button type="button" className="home-upcoming__check home-upcoming__check--waste" onClick={() => onToggleWaste(wasteItem!)} aria-label={entry.completed ? `${item.title}: Bestätigung zurücknehmen` : `${item.title}: als rausgestellt bestätigen`}>
                  {entry.completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                </button>
              ) : item.kind === "task" ? (
                <button type="button" className="home-upcoming__check" onClick={() => onToggle(calendarItem!)} aria-label={`${item.title} erledigen`}><Circle aria-hidden="true" /></button>
              ) : (
                <button type="button" className="home-upcoming__check" onClick={() => onComplete(calendarItem!)} aria-label={`${item.title} erledigen`}><Circle aria-hidden="true" /></button>
              )}
              <button type="button" className="home-upcoming__main" onClick={() => wasteItem ? onWaste(wasteItem) : onItem(calendarItem!)}>
                <span className="home-upcoming__text">
                  <strong>{item.title}</strong>
                  <small>{meta}</small>
                </span>
                <span className={`home-upcoming__date ${activeToday ? "home-upcoming__date--today" : ""}`}><strong>{dateLabel.top}</strong><small>{dateLabel.bottom}</small></span>
                <span className={`home-upcoming__avatar ${eventType === "holidays" ? "home-upcoming__avatar--empty" : ""}`}>{entry.type === "waste" ? <Trash2 aria-hidden="true" /> : eventType === "birthday" ? <Gift aria-hidden="true" /> : eventType === "other" ? <CalendarDays aria-hidden="true" /> : unassignedEvent ? null : person === "all" ? <Users aria-hidden="true" /> : <ProfileAvatar personId={person!} avatars={avatars} size="xs" />}</span>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          )
        }) : <div className="home-reference__empty"><Check aria-hidden="true" /><span>In den nächsten 7 Tagen steht nichts an</span></div>}
      </div>
    </section>
  )
}

function ItemRow({
  item,
  avatars,
  onItem,
  onToggle,
  onComplete,
}: {
  item: CalendarItem
  avatars: FamilyFlowState["avatars"]
  onItem: (item: CalendarItem) => void
  onToggle: (item: CalendarItem) => void
  onComplete?: (item: CalendarItem) => void
}) {
  const person = itemPerson(item)
  const eventType = item.kind === "event" ? eventTypeOf(item) : null
  return (
    <div className={`item-row item-row--${item.kind} ${item.completed ? "item-row--done" : ""}`}>
      {item.kind === "task" ? (
        <button type="button" className="task-check" onClick={() => onToggle(item)} aria-label={item.completed ? "Als offen markieren" : "Als erledigt markieren"}>
          {item.completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
        </button>
      ) : onComplete ? (
        <button type="button" className="event-check" onClick={() => onComplete(item)} aria-label={`${item.title} als erledigt markieren`}>
          <Circle aria-hidden="true" />
        </button>
      ) : (
        <div className="item-row__time">{item.time || <CalendarDays aria-hidden="true" />}</div>
      )}
      <button type="button" className="item-row__main" onClick={() => onItem(item)}>
        <span className="item-row__title">{item.title}</span>
        <span className="item-row__meta">
          {((item.kind === "task" || onComplete) && item.time) && <><Clock3 aria-hidden="true" />{item.time}</>}
          {eventType === "birthday" ? <><Gift aria-hidden="true" />Geburtstag</> : eventType === "other" ? <><CalendarDays aria-hidden="true" />Sonstiges</> : person === null ? <><CalendarDays aria-hidden="true" />Fester Termin</> : person === "all" ? <><Users aria-hidden="true" />Alle</> : <><ProfileAvatar personId={person} avatars={avatars} size="sm" />{PEOPLE[person].name}</>}
        </span>
      </button>
      <button type="button" className="item-row__edit" onClick={() => onItem(item)} aria-label={`${item.title} bearbeiten`}><Pencil aria-hidden="true" /></button>
    </div>
  )
}

function WastePickupRow({ pickup, completion, onToggle }: { pickup: WastePickup; completion?: WasteCompletion; onToggle: (pickup: WastePickup) => void }) {
  const completed = Boolean(completion?.completed)
  return (
    <div className={`waste-row waste-row--${pickup.kind} ${completed ? "waste-row--done" : ""}`}>
      <span className="waste-row__icon" aria-hidden="true"><Trash2 /></span>
      <span className="waste-row__copy">
        <strong>{pickup.title}</strong>
        <small>{completed ? `Rausgestellt${completion?.completedBy ? ` · ${PEOPLE[completion.completedBy].name}` : ""}` : "Noch nicht als rausgestellt bestätigt"}</small>
      </span>
      <button type="button" className="waste-check" onClick={() => onToggle(pickup)} aria-label={completed ? `${pickup.title}: Bestätigung zurücknehmen` : `${pickup.title}: als rausgestellt bestätigen`}>
        {completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
      </button>
    </div>
  )
}

function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const image = new Image()
      image.onerror = reject
      image.onload = () => {
        const size = Math.min(image.width, image.height)
        const sourceX = (image.width - size) / 2
        const sourceY = (image.height - size) / 2
        const canvas = document.createElement("canvas")
        canvas.width = 320
        canvas.height = 320
        const context = canvas.getContext("2d")
        if (!context) return reject(new Error("Canvas unavailable"))
        context.drawImage(image, sourceX, sourceY, size, size, 0, 0, 320, 320)
        resolve(canvas.toDataURL("image/jpeg", 0.82))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

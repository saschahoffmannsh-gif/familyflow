// Generiert von scripts/build-function.mjs – nicht von Hand bearbeiten.
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// app/api/calendar/route.ts
var route_exports = {};
__export(route_exports, {
  DELETE: () => DELETE,
  GET: () => GET,
  PUT: () => PUT,
  dynamic: () => dynamic
});

// server/env.ts
var store = () => globalThis.__familyflowEnv ||= {};
var env = new Proxy({}, { get: (_t, key) => store()[key] });

// db/index.ts
function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return env.DB;
}

// lib/discussion-server.ts
var ChatError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var chatReply = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
function chatFail(e) {
  if (e instanceof ChatError) return chatReply({ error: e.message }, e.status);
  console.error("Done chat error", e);
  return chatReply({ error: "Der Chat ist gerade nicht erreichbar. Bitte erneut versuchen." }, 500);
}
function allowChatWrite(r) {
  const o = r.headers.get("origin");
  return r.headers.get("sec-fetch-site") !== "cross-site" && (!o || o === new URL(r.url).origin);
}
var clean = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
async function chatIdentity(r, optional = false) {
  const token = r.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token && optional) return null;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ChatError("Bitte \xF6ffne dein Done-Profil.", 401);
  const p = await getDb().prepare("SELECT id, name, color FROM planner_profiles WHERE access_key = ?").bind(token).first();
  if (!p) throw new ChatError("Bitte melde dein Profil erneut an.", 401);
  return p;
}
async function inGroup(group, person) {
  return !!await getDb().prepare("SELECT group_id FROM planner_members WHERE group_id = ? AND profile_id = ?").bind(group, person).first();
}
async function sourceFor(kind, id) {
  const db = getDb();
  if (kind === "todo") {
    const t = await db.prepare("SELECT title, kind, date, note FROM todo_items WHERE id = ?").bind(id).first();
    if (t) return { groupId: "family", entry: { title: t.title, kind: t.kind, ...t.date ? { date: t.date } : {}, ...t.note ? { note: t.note } : {} } };
    return sourceFor("event", `todo-${id}`);
  }
  if (kind !== "event") throw new ChatError("Ung\xFCltiger Eintrag.");
  const row = await db.prepare("SELECT * FROM planner_events WHERE id = ?").bind(id).first() || await db.prepare("SELECT * FROM calendar_items WHERE id = ?").bind(id).first();
  if (!row) throw new ChatError("Dieser Eintrag wurde entfernt oder ist nicht mehr verf\xFCgbar.", 404);
  if (row.waste_kind) throw new ChatError("F\xFCr M\xFCllabholungen ist kein externer Chat vorgesehen.");
  return { groupId: row.group_id || "family", entry: { title: row.title, kind: row.kind === "task" || row.event_type === "task" ? "task" : "event", date: row.date, ...row.end_date ? { endDate: row.end_date } : {}, ...row.time ? { time: row.time } : {}, ...row.note ? { note: row.note } : {} } };
}
async function threadFromShare(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ChatError("Dieser Terminlink ist ung\xFCltig.", 404);
  const t = await getDb().prepare("SELECT t.id, t.source_kind, t.source_id FROM entry_threads t JOIN entry_shares s ON s.thread_id = t.id WHERE s.token = ? AND s.active = 1").bind(token).first();
  if (!t) throw new ChatError("Dieser Link wurde zur\xFCckgenommen oder ist nicht mehr g\xFCltig.", 404);
  await sourceFor(t.source_kind, t.source_id);
  return t;
}
async function accessThread(id, p, token) {
  const t = await getDb().prepare("SELECT id, source_kind, source_id FROM entry_threads WHERE id = ?").bind(id).first();
  if (!t) throw new ChatError("Dieser Chat wurde nicht gefunden.", 404);
  const source = await sourceFor(t.source_kind, t.source_id), member = !!p && await inGroup(source.groupId, p.id);
  if (!member) {
    const shared = token ? await threadFromShare(token) : null;
    const guest = p ? await getDb().prepare("SELECT g.profile_id FROM entry_guests g JOIN entry_shares s ON s.token = g.token WHERE g.profile_id = ? AND s.thread_id = ? AND s.active = 1").bind(p.id, id).first() : null;
    if (shared?.id !== id && !guest) throw new ChatError("Du hast keinen Zugriff auf diesen Chat.", 403);
  }
  return { thread: t, source, member };
}
async function openThread(ref, p) {
  const source = await sourceFor(ref.kind, ref.id);
  if (!await inGroup(source.groupId, p.id)) throw new ChatError("Dieser Eintrag geh\xF6rt nicht zu deinen Gruppen.", 403);
  const db = getDb();
  let t = await db.prepare("SELECT id, source_kind, source_id FROM entry_threads WHERE source_kind = ? AND source_id = ?").bind(ref.kind, ref.id).first();
  if (!t && ref.kind === "event" && ref.id.startsWith("todo-")) t = await db.prepare("SELECT id, source_kind, source_id FROM entry_threads WHERE source_kind = 'todo' AND source_id = ?").bind(ref.id.slice(5)).first();
  if (!t) {
    await db.prepare("INSERT OR IGNORE INTO entry_threads (id, source_kind, source_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), ref.kind, ref.id, p.id, (/* @__PURE__ */ new Date()).toISOString()).run();
    t = await db.prepare("SELECT id, source_kind, source_id FROM entry_threads WHERE source_kind = ? AND source_id = ?").bind(ref.kind, ref.id).first();
  }
  return { ...t, verified: { thread: t, source, member: true } };
}
async function chatBundle(id, p, token, before, verified) {
  const { source, member } = verified?.thread.id === id ? verified : await accessThread(id, p, token), db = getDb(), [beforeTime, beforeId] = before?.split("|") || [];
  const [rows, share, reminders, guest] = await Promise.all([
    db.prepare(`SELECT m.id,m.author_id,p.name AS author,p.color,m.body,m.created_at,a.id AS attachment_id,a.name,a.mime,a.size,a.duration FROM entry_messages m JOIN planner_profiles p ON p.id=m.author_id LEFT JOIN entry_attachments a ON a.id=m.attachment_id WHERE m.thread_id=? ${beforeTime ? "AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : ""} ORDER BY m.created_at DESC,m.id DESC LIMIT 61`).bind(id, ...beforeTime ? [beforeTime, beforeTime, beforeId || ""] : []).all(),
    member ? db.prepare("SELECT token FROM entry_shares WHERE thread_id=? AND active=1 ORDER BY created_at DESC LIMIT 1").bind(id).first() : Promise.resolve(null),
    p ? db.prepare("SELECT id,remind_at,delivered FROM entry_reminders WHERE thread_id=? AND profile_id=? ORDER BY remind_at").bind(id, p.id).all() : Promise.resolve(null),
    p ? db.prepare(`SELECT g.group_id,g.calendar_date FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE g.profile_id=? AND s.thread_id=? AND s.active=1 ${token ? "AND g.token=?" : ""} ORDER BY (g.group_id IS NULL),g.created_at LIMIT 1`).bind(p.id, id, ...token ? [token] : []).first() : Promise.resolve(null)
  ]);
  const messages = rows.results.slice(0, 60).reverse().map((m) => ({ id: m.id, authorId: m.author_id, author: m.author, color: m.color, body: m.body, createdAt: m.created_at, ...m.attachment_id ? { attachment: { id: m.attachment_id, name: m.name, mime: m.mime, size: m.size, ...m.duration ? { duration: m.duration } : {} } } : {} }));
  return { id, entry: source.entry, messages, hasMore: rows.results.length > 60, canWrite: !!p, canShare: member, reminders: reminders?.results.map((r) => ({ id: r.id, remindAt: r.remind_at, delivered: !!r.delivered })) || [], ...share ? { shareToken: share.token } : {}, joined: member || !!guest, imported: !!guest?.group_id, ...guest?.group_id ? { importedGroupId: guest.group_id } : {}, ...guest?.calendar_date ? { importDate: guest.calendar_date } : {} };
}
async function importedEntries(profileId) {
  const rows = await getDb().prepare("SELECT t.id,t.source_kind,t.source_id,g.group_id,g.calendar_date FROM entry_guests g JOIN entry_shares s ON s.token=g.token AND s.active=1 JOIN entry_threads t ON t.id=s.thread_id JOIN planner_members m ON m.group_id=g.group_id AND m.profile_id=g.profile_id WHERE g.profile_id=? AND g.group_id IS NOT NULL ORDER BY g.created_at").bind(profileId).all();
  const events = [], seen = /* @__PURE__ */ new Set();
  for (const row of rows.results) {
    if (seen.has(row.id)) continue;
    try {
      const { entry } = await sourceFor(row.source_kind, row.source_id);
      const date = entry.date || row.calendar_date;
      if (date) {
        events.push({ ...entry, id: `shared-${row.id}`, groupId: row.group_id, date, person: profileId, eventType: entry.kind === "task" ? "task" : "private", revision: 1, readonly: true, sharedThreadId: row.id });
        seen.add(row.id);
      }
    } catch (e) {
      if (!(e instanceof ChatError && e.status === 404)) throw e;
    }
  }
  return events;
}
async function dueReminders(p) {
  const rows = await getDb().prepare("SELECT r.id,r.thread_id,r.remind_at,t.source_kind,t.source_id FROM entry_reminders r JOIN entry_threads t ON t.id=r.thread_id WHERE r.profile_id=? AND r.delivered=0 AND r.remind_at<=? ORDER BY r.remind_at LIMIT 20").bind(p.id, (/* @__PURE__ */ new Date()).toISOString()).all();
  const result = [];
  for (const r of rows.results) {
    try {
      const a = await accessThread(r.thread_id, p);
      result.push({ id: r.id, threadId: r.thread_id, title: a.source.entry.title, remindAt: r.remind_at });
    } catch (e) {
      if (!(e instanceof ChatError && [403, 404].includes(e.status))) throw e;
    }
  }
  return result;
}

// lib/planner.ts
var LEGACY_PEOPLE = [
  { id: "sascha", name: "Sascha", color: "#467ba6" },
  { id: "katharina", name: "Katharina", color: "#d9778f" },
  { id: "arjen", name: "Arjen", color: "#36a78a" }
];
var PLANNER_CATEGORIES = [
  { id: "private", label: "Privat", color: "#22835c", background: "#d9f3e7", ink: "#195f44" },
  { id: "work", label: "Arbeit", color: "#d44c68", background: "#ffe0e4", ink: "#92263c" },
  { id: "task", label: "Auftrag", color: "#159f78", background: "#d5f4e9", ink: "#12634c" },
  { id: "vacation", label: "Urlaub", color: "#d7a300", background: "#ffef9e", ink: "#685100" },
  { id: "holidays", label: "Ferien / Feiertage", color: "#a96ccf", background: "linear-gradient(100deg, #ffd7e5, #ffe8a9 34%, #d9f3cc 67%, #cfe9ff)", ink: "#384960" },
  { id: "birthday", label: "Geburtstag", color: "#c34e9c", background: "#f7dff0", ink: "#853266" },
  { id: "other", label: "Sonstiges", color: "#63849c", background: "#e4edf3", ink: "#3b5c72" }
];
function parseAudience(value) {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return void 0;
    }
  }
  if (!Array.isArray(list)) return void 0;
  const ids = [...new Set(list.filter((id) => typeof id === "string" && /^[\w-]{1,100}$/.test(id)))];
  return ids.length >= 2 ? ids : void 0;
}

// lib/inbox-server.ts
async function entrySnapshot(ref) {
  const db = getDb(), source = await sourceFor(ref.kind, ref.id);
  let person = null, audience;
  if (ref.kind === "todo") {
    const todo = await db.prepare("SELECT created_by FROM todo_items WHERE id=?").bind(ref.id).first();
    if (todo) person = todo.created_by;
    else return entrySnapshot({ kind: "event", id: `todo-${ref.id}` });
  } else {
    const row = await db.prepare("SELECT person, audience FROM planner_events WHERE id=?").bind(ref.id).first() || await db.prepare("SELECT CASE WHEN kind='task' THEN assignee ELSE COALESCE(person,'all') END AS person, audience FROM calendar_items WHERE id=?").bind(ref.id).first();
    person = row?.person || null;
    audience = parseAudience(row?.audience);
  }
  const members = await db.prepare("SELECT profile_id FROM planner_members WHERE group_id=?").bind(source.groupId).all();
  return { ...source, people: members.results.map((m) => m.profile_id).filter((id) => audience ? audience.includes(id) : person === "all" || id === person) };
}
async function threadFor(ref, actor) {
  const db = getDb();
  let thread = await db.prepare("SELECT id,source_kind,source_id FROM entry_threads WHERE source_kind=? AND source_id=?").bind(ref.kind, ref.id).first();
  if (!thread && ref.kind === "event" && ref.id.startsWith("todo-")) thread = await db.prepare("SELECT id,source_kind,source_id FROM entry_threads WHERE source_kind='todo' AND source_id=?").bind(ref.id.slice(5)).first();
  if (!thread) {
    await db.prepare("INSERT OR IGNORE INTO entry_threads (id,source_kind,source_id,created_by,created_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), ref.kind, ref.id, actor.id, (/* @__PURE__ */ new Date()).toISOString()).run();
    thread = await db.prepare("SELECT id,source_kind,source_id FROM entry_threads WHERE source_kind=? AND source_id=?").bind(ref.kind, ref.id).first();
  }
  return thread;
}
async function recordEntryChange(ref, actor, previous, removed = false) {
  const next = removed ? previous : await entrySnapshot(ref), before = previous?.entry, after = next.entry;
  const fields = [["title", "Titel"], ["date", "Datum"], ["endDate", "Zeitraum"], ["time", "Uhrzeit"], ["note", "Notiz"], ["kind", "Art"]];
  const changed = fields.filter(([key]) => (before?.[key] || "") !== (after[key] || ""));
  const assigned = previous && previous.people.slice().sort().join("|") !== next.people.slice().sort().join("|");
  if (previous && !removed && !changed.length && !assigned) return;
  const thread = await threadFor(ref, actor), db = getDb();
  const guests = await db.prepare("SELECT DISTINCT g.profile_id FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE s.thread_id=? AND s.active=1").bind(thread.id).all();
  const recipients2 = [.../* @__PURE__ */ new Set([...next.people, ...previous?.people || [], ...guests.results.map((g) => g.profile_id)])].filter((id) => id !== actor.id);
  if (!recipients2.length) return;
  const display = (key, value) => value && (key === "date" || key === "endDate") ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(/* @__PURE__ */ new Date(`${value}T12:00:00Z`)) : value || "offen";
  const label = after.kind === "task" ? "Auftrag" : "Termin";
  const summary = removed ? `${label} wurde entfernt.` : !previous ? `${label} f\xFCr deinen Kalender angelegt.` : [...changed.map(([key, name]) => key === "date" || key === "time" || key === "endDate" ? `${name}: ${display(key, before?.[key])} \u2192 ${display(key, after[key])}` : `${name} aktualisiert`), ...assigned ? ["Zust\xE4ndigkeit ge\xE4ndert"] : []].join(" \xB7 ");
  await db.prepare("INSERT INTO entry_changes (id,thread_id,group_id,actor_id,kind,title,entry_kind,date,summary,recipients,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), thread.id, next.groupId, actor.id, removed ? "cancelled" : previous ? "changed" : "created", after.title, after.kind, after.date || null, summary, JSON.stringify(recipients2), (/* @__PURE__ */ new Date()).toISOString()).run();
}
async function inboxFor(profile) {
  const db = getDb();
  const candidates = await db.prepare(`WITH viewer AS (SELECT ? AS id)
    SELECT t.id,t.source_kind,t.source_id FROM entry_threads t CROSS JOIN viewer v WHERE
    EXISTS (SELECT 1 FROM planner_events e JOIN planner_members m ON m.group_id=e.group_id WHERE t.source_kind='event' AND t.source_id=e.id AND m.profile_id=v.id AND e.waste_kind IS NULL AND (e.person IN (v.id,'all') OR EXISTS (SELECT 1 FROM json_each(e.audience) WHERE value=v.id)))
    OR EXISTS (SELECT 1 FROM calendar_items c JOIN planner_members m ON m.group_id='family' WHERE c.id=CASE WHEN t.source_kind='todo' THEN 'todo-'||t.source_id ELSE t.source_id END AND m.profile_id=v.id AND ((CASE WHEN c.kind='task' THEN c.assignee ELSE COALESCE(c.person,'all') END) IN (v.id,'all') OR EXISTS (SELECT 1 FROM json_each(c.audience) WHERE value=v.id)))
    OR EXISTS (SELECT 1 FROM todo_items o JOIN planner_members m ON m.group_id='family' WHERE t.source_kind='todo' AND t.source_id=o.id AND m.profile_id=v.id AND o.created_by=v.id)
    OR EXISTS (SELECT 1 FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE s.thread_id=t.id AND s.active=1 AND g.profile_id=v.id)
    OR EXISTS (SELECT 1 FROM entry_changes c JOIN planner_members m ON m.group_id=c.group_id WHERE c.thread_id=t.id AND m.profile_id=v.id AND EXISTS (SELECT 1 FROM json_each(c.recipients) WHERE value=v.id))`).bind(profile.id).all();
  if (!candidates.results.length) return { items: [], unread: 0 };
  const entries = /* @__PURE__ */ new Map();
  for (const t of candidates.results) {
    const guest = await db.prepare("SELECT s.token FROM entry_guests g JOIN entry_shares s ON s.token=g.token WHERE g.profile_id=? AND s.thread_id=? AND s.active=1 ORDER BY g.created_at LIMIT 1").bind(profile.id, t.id).first();
    try {
      const source = await sourceFor(t.source_kind, t.source_id);
      if (!guest && !await inGroup(source.groupId, profile.id)) continue;
      entries.set(t.id, { entry: source.entry, canOpen: true, ...guest ? { shareToken: guest.token } : {} });
    } catch (e) {
      if (!(e instanceof ChatError && e.status === 404)) throw e;
      const deleted = await db.prepare("SELECT c.* FROM entry_changes c WHERE c.thread_id=? AND c.kind='cancelled' AND (EXISTS (SELECT 1 FROM planner_members m WHERE m.group_id=c.group_id AND m.profile_id=?) OR ?=1) AND EXISTS (SELECT 1 FROM json_each(c.recipients) WHERE value=?) ORDER BY c.created_at DESC LIMIT 1").bind(t.id, profile.id, guest ? 1 : 0, profile.id).first();
      if (deleted) entries.set(t.id, { entry: { title: deleted.title, kind: deleted.entry_kind, ...deleted.date ? { date: deleted.date } : {} }, canOpen: false });
    }
  }
  const ids = [...entries.keys()], items = [];
  for (let offset = 0; offset < ids.length; offset += 25) {
    const batch = ids.slice(offset, offset + 25), slots = batch.map(() => "?").join(",");
    const rows = await db.prepare(`WITH viewer AS (SELECT ? AS id), activity AS (
      SELECT 'message:'||m.id AS id,m.thread_id,m.created_at,CASE WHEN a.mime LIKE 'image/%' THEN 'image' WHEN a.mime LIKE 'audio/%' THEN 'audio' ELSE 'message' END AS type,m.body AS preview,p.name AS author,p.id AS author_id,p.color FROM entry_messages m JOIN planner_profiles p ON p.id=m.author_id LEFT JOIN entry_attachments a ON a.id=m.attachment_id WHERE m.thread_id IN (${slots}) AND m.author_id<>(SELECT id FROM viewer)
      UNION ALL SELECT 'change:'||c.id,c.thread_id,c.created_at,c.kind,c.summary,p.name,p.id,p.color FROM entry_changes c JOIN planner_profiles p ON p.id=c.actor_id WHERE c.thread_id IN (${slots}) AND c.actor_id<>(SELECT id FROM viewer) AND EXISTS (SELECT 1 FROM json_each(c.recipients) WHERE value=(SELECT id FROM viewer))
      UNION ALL SELECT 'shared:'||s.token,s.thread_id,g.created_at,'shared','Eintrag und gemeinsamer Chat mit dir geteilt.',p.name,p.id,p.color FROM entry_guests g JOIN entry_shares s ON s.token=g.token JOIN planner_profiles p ON p.id=s.created_by WHERE s.thread_id IN (${slots}) AND g.profile_id=(SELECT id FROM viewer) AND s.created_by<>(SELECT id FROM viewer) AND s.active=1
    ), ranked AS (SELECT a.*,
      SUM(CASE WHEN a.created_at>COALESCE(st.read_at,'') OR (a.created_at=st.read_at AND a.id>st.read_id) THEN 1 ELSE 0 END) OVER (PARTITION BY a.thread_id) AS unread,
      SUM(a.type='message') OVER (PARTITION BY a.thread_id) AS messages,SUM(a.type='image') OVER (PARTITION BY a.thread_id) AS images,SUM(a.type='audio') OVER (PARTITION BY a.thread_id) AS audio,SUM(a.type='shared') OVER (PARTITION BY a.thread_id) AS shared,SUM(a.type IN ('created','changed','cancelled')) OVER (PARTITION BY a.thread_id) AS changes,
      FIRST_VALUE(CASE WHEN a.type IN ('created','changed','cancelled') THEN a.preview ELSE '' END) OVER (PARTITION BY a.thread_id ORDER BY CASE WHEN a.type IN ('created','changed','cancelled') THEN a.created_at ELSE '' END DESC,a.id DESC) AS change_preview,
      ROW_NUMBER() OVER (PARTITION BY a.thread_id ORDER BY a.created_at DESC,a.id DESC) AS position FROM activity a LEFT JOIN inbox_states st ON st.thread_id=a.thread_id AND st.profile_id=(SELECT id FROM viewer)) SELECT * FROM ranked WHERE position=1`).bind(profile.id, ...batch, ...batch, ...batch).all();
    for (const row of rows.results) {
      const entry = entries.get(row.thread_id);
      const type = entry.canOpen ? row.type : "cancelled", preview = entry.canOpen ? row.preview : `${entry.entry.kind === "task" ? "Auftrag" : "Termin"} wurde entfernt.`;
      items.push({ ...entry, threadId: row.thread_id, activityId: row.id, createdAt: row.created_at, type, preview, author: row.author, authorId: row.author_id, color: row.color, unread: row.unread, types: [...row.messages ? ["message"] : [], ...row.images ? ["image"] : [], ...row.audio ? ["audio"] : [], ...row.shared ? ["shared"] : [], ...row.changes ? ["changed"] : []], ...row.change_preview ? { changePreview: row.change_preview } : {} });
    }
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.activityId.localeCompare(a.activityId));
  return { items, unread: items.filter((item) => item.unread > 0).length };
}
async function markInboxRead(profile, threadId) {
  const inbox = await inboxFor(profile), items = inbox.items.filter((item) => item.unread && (!threadId || item.threadId === threadId)), db = getDb();
  for (let offset = 0; offset < items.length; offset += 50) await db.batch(items.slice(offset, offset + 50).map((item) => db.prepare("INSERT INTO inbox_states (profile_id,thread_id,read_at,read_id) VALUES (?,?,?,?) ON CONFLICT(profile_id,thread_id) DO UPDATE SET read_at=excluded.read_at,read_id=excluded.read_id WHERE excluded.read_at>inbox_states.read_at OR (excluded.read_at=inbox_states.read_at AND excluded.read_id>inbox_states.read_id)").bind(profile.id, item.threadId, item.createdAt, item.activityId)));
  return inboxFor(profile);
}

// lib/family-api-access.ts
async function familyApiAccess(request) {
  try {
    const p = await chatIdentity(request);
    return await inGroup("family", p.id) ? null : chatReply({ error: "Diese Liste geh\xF6rt zur Familiengruppe." }, 403);
  } catch (e) {
    return chatFail(e);
  }
}

// node_modules/.pnpm/uint8array-extras@1.5.0/node_modules/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
function assertUint8Array(value) {
  if (!isUint8Array(value)) {
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof value}\``);
  }
}
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.length, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    assertUint8Array(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
var cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
var cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
var MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8Array(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
var byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }
  };
}
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }
  };
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
var recordSize = 4096;
var headerSize = 21 + 65;
var maxPlaintextSize = recordSize - headerSize - 17;
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}

// node_modules/.pnpm/@block65+webcrypto-web-push@2.0.0/node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body
  };
}

// lib/push-config.ts
var VAPID_PUBLIC_KEY = "BIXzJh6di0OrKbo9Sf0LvK5S-2SeUfmnqo--qJeDu2NTjDsWiwRW2l3dhREJZTTO4puQm1VFiISTyJXLnR-lzLw";

// lib/push-server.ts
function asSubscription(row) {
  return {
    endpoint: row.endpoint,
    expirationTime: null,
    keys: { p256dh: row.p256dh, auth: row.auth }
  };
}
async function sendPushToSubscription(db, row, notification) {
  if (!env.VAPID_PRIVATE_KEY) {
    console.error("FamilyFlow push skipped: VAPID_PRIVATE_KEY is missing");
    return false;
  }
  try {
    const payload = await buildPushPayload({
      data: {
        ...notification,
        icon: "/branding/done-v3-icon-192.png",
        badge: "/branding/done-v3-icon-192.png"
      },
      options: { ttl: 60 * 60 }
    }, asSubscription(row), {
      subject: "https://saschahoffmannsh-gif.github.io/familyflow/",
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY
    });
    const result = await fetch(row.endpoint, payload);
    if (result.status === 404 || result.status === 410) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run();
    }
    if (!result.ok) {
      const detail = await result.text().catch(() => "");
      console.error("FamilyFlow push service rejected a message", result.status, detail.slice(0, 300));
    }
    return result.ok;
  } catch (error) {
    console.error("FamilyFlow push failed", error);
    return false;
  }
}
async function notifyPeople(db, people, notification, excludeDeviceId) {
  const uniquePeople = [...new Set(people)];
  if (!uniquePeople.length) return;
  const placeholders = uniquePeople.map(() => "?").join(", ");
  const subscriptions = await db.prepare(`
    SELECT endpoint, device_id, p256dh, auth
    FROM push_subscriptions
    WHERE person IN (${placeholders})
  `).bind(...uniquePeople).all();
  await Promise.allSettled(subscriptions.results.filter((row) => !excludeDeviceId || row.device_id !== excludeDeviceId).map((row) => sendPushToSubscription(db, row, notification)));
}

// app/api/calendar/route.ts
var dynamic = "force-dynamic";
var PEOPLE = /* @__PURE__ */ new Set(["sascha", "katharina", "arjen"]);
var EVENT_TYPES = /* @__PURE__ */ new Set(["private", "work", "vacation", "holidays", "birthday", "other"]);
var UNASSIGNED_EVENT_TYPES = /* @__PURE__ */ new Set(["holidays", "birthday", "other"]);
var ValidationError = class extends Error {
};
var ConflictError = class extends Error {
  constructor(current) {
    super("Der Eintrag wurde inzwischen auf einem anderen Ger\xE4t ge\xE4ndert.");
    this.current = current;
  }
};
function errorMessage(error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message.includes("no such table") ? "Die FamilyFlow-Cloud wird gerade eingerichtet. Bitte gleich noch einmal versuchen." : "Die FamilyFlow-Cloud ist gerade nicht erreichbar.";
}
function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
function allowWrite(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && (!origin || origin === url.origin);
}
function deviceFromRequest(request) {
  const value = request.headers.get("x-familyflow-device");
  return value && /^[a-zA-Z0-9-]{20,80}$/.test(value) ? value : null;
}
function fromRow(row) {
  const eventType = row.event_type ?? "private";
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    date: row.date,
    ...row.end_date && row.end_date !== row.date ? { endDate: row.end_date } : {},
    ...row.time ? { time: row.time } : {},
    ...row.note ? { note: row.note } : {},
    ...row.kind === "event" ? { ...!UNASSIGNED_EVENT_TYPES.has(eventType) ? { person: row.person ?? "all" } : {}, eventType } : { assignee: row.assignee ?? "sascha", completed: row.completed === 1 },
    ...parseAudience(row.audience) ? { audience: parseAudience(row.audience) } : {},
    revision: row.revision,
    updatedAt: row.updated_at
  };
}
function recipients(item) {
  if (item.audience?.length) return item.audience;
  if (item.kind === "task") return item.assignee ? [item.assignee] : [];
  if (UNASSIGNED_EVENT_TYPES.has(item.eventType ?? "private")) return [];
  if (item.person === "all") return ["sascha", "katharina", "arjen"];
  return item.person ? [item.person] : [];
}
function assignmentKey(value) {
  const audience = "audience" in value && value.audience ? Array.isArray(value.audience) ? value.audience : parseAudience(value.audience) : void 0;
  return audience?.length ? audience.join(",") : value.kind === "task" ? value.assignee : value.person;
}
function notificationFor(item) {
  const formatter = new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Berlin"
  });
  const start = formatter.format(/* @__PURE__ */ new Date(`${item.date}T12:00:00Z`));
  const range = item.endDate ? `${start} bis ${formatter.format(/* @__PURE__ */ new Date(`${item.endDate}T12:00:00Z`))}` : start;
  const when = item.time ? `${range} um ${item.time} Uhr` : range;
  return {
    title: item.kind === "task" ? item.audience ? "Neuer Auftrag f\xFCr euch" : "Neuer Auftrag f\xFCr dich" : item.audience ? "Neuer Termin f\xFCr euch" : item.person === "all" ? "Neuer Familientermin" : "Neuer Termin f\xFCr dich",
    body: `${item.title} \xB7 ${when}`,
    tag: `new-${item.id}`,
    url: "/"
  };
}
function parseItem(value, allowedPeople = PEOPLE) {
  if (!value || typeof value !== "object") throw new ValidationError("Ung\xFCltiger Eintrag");
  const input = value;
  const id = typeof input.id === "string" ? input.id : "";
  const kind = input.kind;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const date = typeof input.date === "string" ? input.date : "";
  const endDate = typeof input.endDate === "string" && input.endDate ? input.endDate : void 0;
  const eventType = typeof input.eventType === "string" && input.eventType ? input.eventType : "private";
  const time = typeof input.time === "string" && input.time ? input.time : void 0;
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : void 0;
  const revision = typeof input.revision === "number" && Number.isInteger(input.revision) && input.revision > 0 ? input.revision : void 0;
  const audience = parseAudience(input.audience);
  if (audience?.some((person) => !allowedPeople.has(person))) throw new ValidationError("Die Person ist ung\xFCltig");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError("Ung\xFCltige ID");
  if (kind !== "event" && kind !== "task") throw new ValidationError("Ung\xFCltige Art");
  if (!title || title.length > 120) throw new ValidationError("Der Titel ist ung\xFCltig");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("Das Datum ist ung\xFCltig");
  if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < date)) {
    throw new ValidationError("Das Bis-Datum darf nicht vor dem Von-Datum liegen");
  }
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ValidationError("Die Uhrzeit ist ung\xFCltig");
  if (note && note.length > 1e3) throw new ValidationError("Die Notiz ist zu lang");
  if (kind === "event") {
    const person = audience ? audience[0] : input.person;
    if (!EVENT_TYPES.has(eventType)) throw new ValidationError("Die Terminart ist ung\xFCltig");
    if (UNASSIGNED_EVENT_TYPES.has(eventType)) {
      return { id, kind, title, date, ...endDate && endDate !== date ? { endDate } : {}, eventType, ...time ? { time } : {}, ...note ? { note } : {}, ...revision ? { revision } : {} };
    }
    if (person !== "all" && (typeof person !== "string" || !allowedPeople.has(person))) {
      throw new ValidationError("Die Person ist ung\xFCltig");
    }
    return { id, kind, title, date, ...endDate && endDate !== date ? { endDate } : {}, eventType, ...time ? { time } : {}, ...note ? { note } : {}, person, ...audience ? { audience } : {}, ...revision ? { revision } : {} };
  }
  const assignee = audience ? audience[0] : input.assignee;
  if (typeof assignee !== "string" || !allowedPeople.has(assignee)) throw new ValidationError("Die Zust\xE4ndigkeit ist ung\xFCltig");
  return {
    id,
    kind,
    title,
    date,
    ...endDate && endDate !== date ? { endDate } : {},
    ...time ? { time } : {},
    ...note ? { note } : {},
    assignee,
    ...audience ? { audience } : {},
    completed: input.completed === true,
    ...revision ? { revision } : {}
  };
}
async function GET(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  try {
    const result = await getDb().prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, audience, completed, revision, updated_at
      FROM calendar_items
      ORDER BY date ASC, COALESCE(time, '99:99') ASC, title ASC
    `).all();
    return response({ items: result.results.map(fromRow) });
  } catch (error) {
    console.error("FamilyFlow calendar GET failed", error);
    return response({ error: errorMessage(error) }, 500);
  }
}
async function PUT(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite(request)) return response({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const inboxProfile = await chatIdentity(request);
    const actorDevice = deviceFromRequest(request);
    const db = getDb();
    const familyMembers = await db.prepare("SELECT profile_id FROM planner_members WHERE group_id = 'family'").all();
    const item = parseItem(await request.json(), /* @__PURE__ */ new Set([...PEOPLE, ...familyMembers.results.map((member) => member.profile_id)]));
    const previous = await db.prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, audience, completed, revision, updated_at
      FROM calendar_items
      WHERE id = ?
    `).bind(item.id).first();
    if (previous && item.revision !== previous.revision) {
      throw new ConflictError(fromRow(previous));
    }
    const previousSnapshot = previous ? await entrySnapshot({ kind: "event", id: item.id }) : void 0;
    const nextRevision = previous ? previous.revision + 1 : 1;
    const write = await db.prepare(`
      INSERT INTO calendar_items (id, kind, title, date, end_date, event_type, time, note, person, assignee, audience, completed, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        date = excluded.date,
        end_date = excluded.end_date,
        event_type = excluded.event_type,
        time = excluded.time,
        note = excluded.note,
        person = excluded.person,
        assignee = excluded.assignee,
        audience = excluded.audience,
        completed = excluded.completed,
        revision = excluded.revision,
        updated_at = excluded.updated_at
      WHERE calendar_items.revision = excluded.revision - 1
    `).bind(
      item.id,
      item.kind,
      item.title,
      item.date,
      item.endDate ?? null,
      item.kind === "event" ? item.eventType ?? "private" : null,
      item.time ?? null,
      item.note ?? null,
      item.kind === "event" ? item.person ?? null : null,
      item.kind === "task" ? item.assignee ?? null : null,
      item.audience?.length ? JSON.stringify(item.audience) : null,
      item.completed ? 1 : 0,
      nextRevision
    ).run();
    if (write.meta.changes === 0) {
      const current = await db.prepare(`
        SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, audience, completed, revision, updated_at
        FROM calendar_items
        WHERE id = ?
      `).bind(item.id).first();
      if (current) throw new ConflictError(fromRow(current));
      throw new Error("Der Eintrag konnte nicht gespeichert werden.");
    }
    await recordEntryChange({ kind: "event", id: item.id }, inboxProfile, previousSnapshot);
    if (!previous || previous.kind !== item.kind || assignmentKey(previous) !== assignmentKey(item)) {
      await notifyPeople(db, recipients(item).filter((person) => person !== inboxProfile.id), notificationFor(item), actorDevice);
    }
    if (request.headers.get("prefer")?.includes("return=minimal")) return response({ saved: true });
    const saved = await db.prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, audience, completed, revision, updated_at
      FROM calendar_items
      WHERE id = ?
    `).bind(item.id).first();
    return response({ item: saved ? fromRow(saved) : item });
  } catch (error) {
    if (error instanceof ConflictError) {
      return response({ error: error.message, code: "version_conflict", current: error.current }, 409);
    }
    if (error instanceof ValidationError) {
      return response({ error: error.message }, 400);
    }
    console.error("FamilyFlow calendar PUT failed", error);
    return response({ error: errorMessage(error) }, 500);
  }
}
async function DELETE(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite(request)) return response({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const payload = await request.json();
    if (typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.id)) {
      return response({ error: "Ung\xFCltige ID" }, 400);
    }
    const db = getDb();
    const current = await db.prepare(`
      SELECT id, kind, title, date, end_date, event_type, time, note, person, assignee, audience, completed, revision, updated_at
      FROM calendar_items WHERE id = ?
    `).bind(payload.id).first();
    if (!current) return response({ deleted: true });
    if (payload.revision !== current.revision) {
      return response({ error: "Der Eintrag wurde inzwischen auf einem anderen Ger\xE4t ge\xE4ndert.", code: "version_conflict", current: fromRow(current) }, 409);
    }
    const inboxProfile = await chatIdentity(request);
    const previousSnapshot = await entrySnapshot({ kind: "event", id: payload.id });
    const deleted = await db.prepare("DELETE FROM calendar_items WHERE id = ? AND revision = ?").bind(payload.id, current.revision).run();
    if (deleted.meta.changes) await recordEntryChange({ kind: "event", id: payload.id }, inboxProfile, previousSnapshot, true);
    return response({ deleted: true });
  } catch (error) {
    console.error("FamilyFlow calendar DELETE failed", error);
    return response({ error: errorMessage(error) }, 500);
  }
}

// app/api/discussions/route.ts
var route_exports2 = {};
__export(route_exports2, {
  GET: () => GET2,
  POST: () => POST,
  dynamic: () => dynamic2
});

// lib/discussions.ts
function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = /* @__PURE__ */ new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
var MAX_AUDIO_BYTES = 12 * 1024 * 1024;
function validateAttachment(mime, size, bytes) {
  mime = mime.split(";")[0].toLowerCase();
  const text2 = (s, e) => String.fromCharCode(...bytes.slice(s, e));
  const valid = mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : mime === "image/png" ? bytes[0] === 137 && text2(1, 4) === "PNG" : mime === "image/webp" ? text2(0, 4) === "RIFF" && text2(8, 12) === "WEBP" : mime === "image/gif" ? /^GIF8[79]a$/.test(text2(0, 6)) : mime === "audio/mp4" || mime === "audio/x-m4a" ? text2(4, 8) === "ftyp" : mime === "audio/webm" ? bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163 : mime === "audio/ogg" ? text2(0, 4) === "OggS" : mime === "audio/wav" ? text2(0, 4) === "RIFF" && text2(8, 12) === "WAVE" : mime === "audio/mpeg" ? text2(0, 3) === "ID3" || bytes[0] === 255 && (bytes[1] & 224) === 224 : false;
  if (!valid) throw new Error("Bitte w\xE4hle ein JPG, PNG, WebP, GIF oder eine unterst\xFCtzte Audiodatei.");
  if (size < 12 || size > (mime.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES)) throw new Error(mime.startsWith("image/") ? "Das Bild darf h\xF6chstens 10 MB gro\xDF sein." : "Die Sprachnachricht darf h\xF6chstens 12 MB gro\xDF sein.");
  return mime;
}

// app/api/discussions/route.ts
var dynamic2 = "force-dynamic";
async function GET2(request) {
  try {
    const url = new URL(request.url), token = url.searchParams.get("share") || void 0, p = await chatIdentity(request, !!token);
    if (url.searchParams.get("reminders") === "due") {
      if (!p) throw new ChatError("Bitte \xF6ffne dein Profil.", 401);
      return chatReply({ reminders: await dueReminders(p) });
    }
    const id = token ? (await threadFromShare(token)).id : clean(url.searchParams.get("thread"), 100);
    return chatReply(await chatBundle(id, p, token, clean(url.searchParams.get("before"), 140) || void 0));
  } catch (e) {
    return chatFail(e);
  }
}
async function POST(request) {
  if (!allowChatWrite(request)) return chatReply({ error: "Unzul\xE4ssige Anfrage." }, 403);
  try {
    if (Number(request.headers.get("content-length")) > 2e4) throw new ChatError("Die Nachricht ist zu gro\xDF.", 413);
    const p = await chatIdentity(request), input = await request.json(), db = getDb(), action = clean(input.action, 30), token = clean(input.shareToken, 64) || void 0;
    if (action === "open") {
      if (input.kind !== "todo" && input.kind !== "event") throw new ChatError("Ung\xFCltiger Eintrag.");
      const t = await openThread({ kind: input.kind, id: clean(input.id, 100) }, p);
      return chatReply(await chatBundle(t.id, p, void 0, void 0, t.verified));
    }
    if (action === "dismiss-reminder") {
      await db.prepare("UPDATE entry_reminders SET delivered=1 WHERE id=? AND profile_id=?").bind(clean(input.id, 100), p.id).run();
      return chatReply({ saved: true });
    }
    const id = token ? (await threadFromShare(token)).id : clean(input.threadId, 100), { member, source } = await accessThread(id, p, token);
    if (action === "share") {
      if (!member) throw new ChatError("Nur Gruppenmitglieder k\xF6nnen einen Terminlink erstellen.", 403);
      const old = await db.prepare("SELECT token FROM entry_shares WHERE thread_id=? AND active=1 ORDER BY created_at DESC LIMIT 1").bind(id).first(), next = old?.token || crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      if (!old) await db.prepare("INSERT INTO entry_shares (token,thread_id,created_by,active,created_at) VALUES (?,?,?,1,?)").bind(next, id, p.id, (/* @__PURE__ */ new Date()).toISOString()).run();
      return chatReply({ token: next });
    }
    if (action === "revoke-share") {
      if (!member) throw new ChatError("Nur Gruppenmitglieder k\xF6nnen die Freigabe zur\xFCcknehmen.", 403);
      await db.prepare("UPDATE entry_shares SET active=0 WHERE thread_id=?").bind(id).run();
    } else if (action === "join" || action === "import") {
      if (!token) throw new ChatError("Bitte \xF6ffne den Terminlink erneut.");
      const calendarDate = action === "import" ? source.entry.date || clean(input.date, 10) : null;
      if (action === "import" && !isCalendarDate(calendarDate)) throw new ChatError("Bitte w\xE4hle einen Tag f\xFCr deinen Kalender.");
      let group = action === "import" ? clean(input.groupId, 100) : null;
      if (action === "import" && !group) {
        const old = await db.prepare("SELECT group_id FROM planner_members WHERE profile_id=? LIMIT 1").bind(p.id).first();
        if (old) group = old.group_id;
        else {
          group = crypto.randomUUID();
          await db.batch([db.prepare("INSERT INTO planner_groups (id,name,category,color,invite_code,created_by) VALUES (?,?,?,?,?,?)").bind(group, "Mein Kalender", "Sonstiges", "#6335dc", crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(), p.id), db.prepare("INSERT INTO planner_members (group_id,profile_id) VALUES (?,?)").bind(group, p.id)]);
        }
      }
      if (group && !await inGroup(group, p.id)) throw new ChatError("Bitte w\xE4hle einen eigenen Kalender.", 403);
      await db.prepare("INSERT INTO entry_guests (token,profile_id,group_id,calendar_date,created_at) VALUES (?,?,?,?,?) ON CONFLICT(token,profile_id) DO UPDATE SET group_id=COALESCE(excluded.group_id,entry_guests.group_id),calendar_date=COALESCE(excluded.calendar_date,entry_guests.calendar_date)").bind(token, p.id, group, calendarDate, (/* @__PURE__ */ new Date()).toISOString()).run();
    } else if (action === "message") {
      const body = clean(input.body, 4001), messageId = clean(input.messageId, 100);
      if (!body || body.length > 4e3) throw new ChatError("Eine Nachricht darf 1 bis 4.000 Zeichen enthalten.");
      if (!/^[a-f0-9-]{36}$/.test(messageId)) throw new ChatError("Ung\xFCltige Nachricht.");
      const count = await db.prepare("SELECT COUNT(*) AS count FROM entry_messages WHERE author_id=? AND created_at>?").bind(p.id, new Date(Date.now() - 6e4).toISOString()).first();
      if ((count?.count || 0) >= 40) throw new ChatError("Einen Moment bitte. Du hast gerade sehr viele Nachrichten gesendet.", 429);
      if (token && !member) await db.prepare("INSERT OR IGNORE INTO entry_guests (token,profile_id,created_at) VALUES (?,?,?)").bind(token, p.id, (/* @__PURE__ */ new Date()).toISOString()).run();
      const old = await db.prepare("SELECT author_id,thread_id FROM entry_messages WHERE id=?").bind(messageId).first();
      if (old && (old.author_id !== p.id || old.thread_id !== id)) throw new ChatError("Ung\xFCltige Nachricht.", 409);
      await db.prepare("INSERT OR IGNORE INTO entry_messages (id,thread_id,author_id,body,created_at) VALUES (?,?,?,?,?)").bind(messageId, id, p.id, body, (/* @__PURE__ */ new Date()).toISOString()).run();
    } else if (action === "reminder") {
      const date = new Date(clean(input.remindAt, 40));
      if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() - 3e4 || date.getTime() > Date.now() + 366 * 864e5) throw new ChatError("Bitte w\xE4hle eine zuk\xFCnftige Zeit innerhalb des n\xE4chsten Jahres.");
      if (token && !member) await db.prepare("INSERT OR IGNORE INTO entry_guests (token,profile_id,created_at) VALUES (?,?,?)").bind(token, p.id, (/* @__PURE__ */ new Date()).toISOString()).run();
      const count = await db.prepare("SELECT COUNT(*) AS count FROM entry_reminders WHERE profile_id=? AND delivered=0").bind(p.id).first();
      if ((count?.count || 0) >= 100) throw new ChatError("Du kannst bis zu 100 offene Erinnerungen anlegen.");
      await db.prepare("INSERT INTO entry_reminders (id,thread_id,profile_id,remind_at,delivered) VALUES (?,?,?,?,0)").bind(crypto.randomUUID(), id, p.id, date.toISOString()).run();
    } else if (action === "remove-reminder") {
      await db.prepare("DELETE FROM entry_reminders WHERE id=? AND thread_id=? AND profile_id=?").bind(clean(input.id, 100), id, p.id).run();
    } else throw new ChatError("Unbekannte Chat-Aktion.");
    return chatReply(await chatBundle(id, p, token));
  } catch (e) {
    return chatFail(e);
  }
}

// app/api/discussions/attachments/route.ts
var route_exports3 = {};
__export(route_exports3, {
  POST: () => POST2,
  dynamic: () => dynamic3
});
var dynamic3 = "force-dynamic";
async function POST2(request) {
  if (!allowChatWrite(request)) return chatReply({ error: "Unzul\xE4ssige Anfrage." }, 403);
  try {
    if (Number(request.headers.get("content-length")) > MAX_AUDIO_BYTES + 1e5) throw new ChatError("Die Datei ist zu gro\xDF.", 413);
    const p = await chatIdentity(request), form = await request.formData(), file = form.get("file"), token = clean(form.get("shareToken"), 64) || void 0;
    if (!(file instanceof File)) throw new ChatError("Bitte w\xE4hle eine Datei.");
    const threadId = token ? (await threadFromShare(token)).id : clean(form.get("threadId"), 100), { member } = await accessThread(threadId, p, token);
    let mime;
    try {
      mime = validateAttachment(file.type, file.size, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    } catch (e) {
      throw new ChatError(e.message);
    }
    const db = getDb(), now = (/* @__PURE__ */ new Date()).toISOString(), recent = await db.prepare("SELECT COUNT(*) AS count FROM entry_attachments WHERE author_id=? AND created_at>?").bind(p.id, new Date(Date.now() - 6e4).toISOString()).first();
    if ((recent?.count || 0) >= 12) throw new ChatError("Bitte warte kurz vor dem n\xE4chsten Upload.", 429);
    const total = await db.prepare("SELECT COALESCE(SUM(size),0) AS size FROM entry_attachments WHERE thread_id=?").bind(threadId).first();
    if ((total?.size || 0) + file.size > 250 * 1024 * 1024) throw new ChatError("Dieser Chat hat sein Dateilimit von 250 MB erreicht.", 413);
    if (!env.BUCKET) throw new ChatError("Der Dateispeicher ist noch nicht bereit. Bitte erneut versuchen.", 503);
    const id = crypto.randomUUID(), key = `discussions/${threadId}/${id}`, duration = Math.round(Number(form.get("duration")));
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: mime } });
    try {
      const statements = [db.prepare("INSERT INTO entry_attachments (id,thread_id,author_id,object_key,name,mime,size,duration,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, threadId, p.id, key, clean(file.name, 150) || "Anhang", mime, file.size, Number.isFinite(duration) && duration > 0 && duration <= 300 ? duration : null, now), db.prepare("INSERT INTO entry_messages (id,thread_id,author_id,body,attachment_id,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), threadId, p.id, clean(form.get("caption"), 4e3), id, now)];
      if (token && !member) statements.push(db.prepare("INSERT OR IGNORE INTO entry_guests (token,profile_id,created_at) VALUES (?,?,?)").bind(token, p.id, now));
      await db.batch(statements);
    } catch (e) {
      await env.BUCKET.delete(key);
      throw e;
    }
    return chatReply(await chatBundle(threadId, p, token));
  } catch (e) {
    return chatFail(e);
  }
}

// app/api/discussions/media/[id]/route.ts
var route_exports4 = {};
__export(route_exports4, {
  GET: () => GET3,
  dynamic: () => dynamic4
});
var dynamic4 = "force-dynamic";
async function GET3(request, context) {
  try {
    const { id } = await context.params, token = clean(new URL(request.url).searchParams.get("share"), 64) || void 0, p = await chatIdentity(request, !!token);
    const file = await getDb().prepare("SELECT thread_id,object_key,mime FROM entry_attachments WHERE id=?").bind(id).first();
    if (!file) throw new ChatError("Dieser Anhang wurde nicht gefunden.", 404);
    await accessThread(file.thread_id, p, token);
    const object = await env.BUCKET?.get(file.object_key);
    if (!object) throw new ChatError("Dieser Anhang ist nicht mehr verf\xFCgbar.", 404);
    return new Response(object.body, { headers: { "Content-Type": file.mime, "Content-Length": String(object.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    return chatFail(e);
  }
}

// app/api/inbox/route.ts
var route_exports5 = {};
__export(route_exports5, {
  GET: () => GET4,
  POST: () => POST3,
  dynamic: () => dynamic5
});
var dynamic5 = "force-dynamic";
async function GET4(request) {
  try {
    return chatReply(await inboxFor(await chatIdentity(request)));
  } catch (e) {
    return chatFail(e);
  }
}
async function POST3(request) {
  if (!allowChatWrite(request)) return chatReply({ error: "Unzul\xE4ssige Anfrage." }, 403);
  try {
    const profile = await chatIdentity(request), input = await request.json();
    if (input.action !== "read" && input.action !== "read-all") throw new ChatError("Unbekannte Aktion.");
    const threadId = input.action === "read" ? clean(input.threadId, 100) : void 0;
    if (input.action === "read" && !threadId) throw new ChatError("Bitte w\xE4hle einen Eintrag.");
    return chatReply(await markInboxRead(profile, threadId));
  } catch (e) {
    return chatFail(e);
  }
}

// app/api/planner/route.ts
var route_exports6 = {};
__export(route_exports6, {
  DELETE: () => DELETE2,
  GET: () => GET5,
  POST: () => POST4,
  PUT: () => PUT2,
  dynamic: () => dynamic6
});

// lib/entry-activity.ts
async function withEntryActivity(entries, kind = "event") {
  const ids = [...new Set(entries.filter((entry) => !entry.wasteKind).flatMap((entry) => entry.sharedThreadId ? [entry.sharedThreadId] : [entry.id, ...kind === "event" && entry.id.startsWith("todo-") ? [entry.id.slice(5)] : []]))];
  if (!ids.length) return entries;
  const bySource = /* @__PURE__ */ new Map(), byThread = /* @__PURE__ */ new Map();
  for (let offset = 0; offset < ids.length; offset += 40) {
    const batch = ids.slice(offset, offset + 40), placeholders = batch.map(() => "?").join(",");
    const rows = await getDb().prepare(`
      SELECT t.id, t.source_kind, t.source_id,
        SUM(CASE WHEN LENGTH(TRIM(m.body)) > 0 THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN a.mime LIKE 'image/%' THEN 1 ELSE 0 END) AS images,
        SUM(CASE WHEN a.mime LIKE 'audio/%' THEN 1 ELSE 0 END) AS audio
      FROM entry_threads t JOIN entry_messages m ON m.thread_id = t.id
      LEFT JOIN entry_attachments a ON a.id = m.attachment_id
      WHERE t.source_id IN (${placeholders}) OR t.id IN (${placeholders})
      GROUP BY t.id, t.source_kind, t.source_id
    `).bind(...batch, ...batch).all();
    for (const row of rows.results) {
      const activity = { messages: row.messages, images: row.images, audio: row.audio };
      bySource.set(`${row.source_kind}:${row.source_id}`, activity);
      byThread.set(row.id, activity);
    }
  }
  return entries.map((entry) => {
    const activity = entry.wasteKind ? void 0 : entry.sharedThreadId ? byThread.get(entry.sharedThreadId) : bySource.get(`${kind}:${entry.id}`) || (kind === "event" && entry.id.startsWith("todo-") ? bySource.get(`todo:${entry.id.slice(5)}`) : void 0);
    return activity ? { ...entry, activity } : entry;
  });
}

// lib/waste-calendar.ts
var WASTE_CALENDAR_SOURCE = {
  area: "67661 Kaiserslautern-M\xF6lschbach, Hammelstrift",
  provider: "Stadtbildpflege Kaiserslautern",
  validYear: 2026,
  publishedAt: "19.01.2026"
};
var WASTE_DATES = {
  rest: [
    "2026-01-05",
    "2026-01-19",
    "2026-02-02",
    "2026-02-16",
    "2026-03-02",
    "2026-03-16",
    "2026-03-28",
    "2026-04-13",
    "2026-04-27",
    "2026-05-11",
    "2026-05-26",
    "2026-06-08",
    "2026-06-22",
    "2026-07-06",
    "2026-07-20",
    "2026-08-03",
    "2026-08-17",
    "2026-08-31",
    "2026-09-14",
    "2026-09-28",
    "2026-10-12",
    "2026-10-26",
    "2026-11-09",
    "2026-11-23",
    "2026-12-07",
    "2026-12-19"
  ],
  bio: [
    "2026-01-07",
    "2026-02-04",
    "2026-02-18",
    "2026-03-04",
    "2026-03-18",
    "2026-03-31",
    "2026-04-15",
    "2026-04-29",
    "2026-05-13",
    "2026-05-28",
    "2026-06-03",
    "2026-06-10",
    "2026-06-17",
    "2026-06-24",
    "2026-07-01",
    "2026-07-08",
    "2026-07-15",
    "2026-07-22",
    "2026-07-29",
    "2026-08-05",
    "2026-08-12",
    "2026-08-19",
    "2026-08-26",
    "2026-09-02",
    "2026-09-09",
    "2026-09-16",
    "2026-09-23",
    "2026-09-30",
    "2026-10-07",
    "2026-10-14",
    "2026-10-21",
    "2026-10-28",
    "2026-11-11",
    "2026-11-25",
    "2026-12-09",
    "2026-12-22"
  ],
  yellow: [
    "2026-01-14",
    "2026-01-28",
    "2026-02-11",
    "2026-02-25",
    "2026-03-11",
    "2026-03-25",
    "2026-04-09",
    "2026-04-22",
    "2026-05-06",
    "2026-05-20",
    "2026-06-03",
    "2026-06-17",
    "2026-07-01",
    "2026-07-15",
    "2026-07-29",
    "2026-08-12",
    "2026-08-26",
    "2026-09-09",
    "2026-09-23",
    "2026-10-07",
    "2026-10-21",
    "2026-11-04",
    "2026-11-18",
    "2026-12-02",
    "2026-12-16",
    "2026-12-30"
  ],
  paper: [
    "2026-01-23",
    "2026-02-20",
    "2026-03-20",
    "2026-04-17",
    "2026-05-16",
    "2026-06-12",
    "2026-07-10",
    "2026-08-07",
    "2026-09-04",
    "2026-10-02",
    "2026-10-30",
    "2026-11-27",
    "2026-12-24"
  ]
};
var WASTE_DETAILS = {
  rest: { title: "Restabfall", shortTitle: "Rest" },
  bio: { title: "Bioabfall", shortTitle: "Bio" },
  yellow: { title: "Gelbe Tonne", shortTitle: "Gelb" },
  paper: { title: "Altpapier", shortTitle: "Papier" }
};
var WASTE_PICKUPS = Object.keys(WASTE_DATES).flatMap((kind) => WASTE_DATES[kind].map((date) => ({
  id: `waste-${kind}-${date}`,
  kind,
  date,
  ...WASTE_DETAILS[kind]
}))).sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
var WASTE_BY_DATE = /* @__PURE__ */ new Map();
for (const pickup of WASTE_PICKUPS) {
  WASTE_BY_DATE.set(pickup.date, [...WASTE_BY_DATE.get(pickup.date) ?? [], pickup]);
}
function wastePickupsForDate(date) {
  return WASTE_BY_DATE.get(date) ?? [];
}

// lib/family-access.ts
function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
function isValidProfileChangeCode(value) {
  const expected = env.PROFILE_CHANGE_CODE;
  return Boolean(
    value && typeof expected === "string" && expected.length >= 8 && safeEqual(value, expected)
  );
}

// app/api/planner/route.ts
var dynamic6 = "force-dynamic";
var PARENTS = ["sascha", "katharina"];
var WASTE_KINDS = /* @__PURE__ */ new Set(["rest", "bio", "yellow", "paper"]);
var reply = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
var ApiError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var uid = () => crypto.randomUUID();
var secret = () => uid().replaceAll("-", "") + uid().replaceAll("-", "");
function allowed(request) {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin === new URL(request.url).origin);
}
function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
async function identify(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError("Bitte w\xE4hle dein Profil.", 401);
  const profile = await getDb().prepare("SELECT id, name, color FROM planner_profiles WHERE access_key = ?").bind(token).first();
  if (!profile) throw new ApiError("Bitte melde dein Profil erneut an.", 401);
  return profile;
}
async function membership(groupId, profileId) {
  if (!await getDb().prepare("SELECT group_id FROM planner_members WHERE group_id = ? AND profile_id = ?").bind(groupId, profileId).first()) throw new ApiError("Diese Gruppe geh\xF6rt nicht zu deinem Profil.", 403);
}
function eventFrom(row) {
  return { kind: row.event_type === "task" ? "task" : "event", id: row.id, groupId: row.group_id, title: row.title, date: row.date, person: row.person, eventType: row.event_type, revision: row.revision, completed: !!row.completed, ...row.waste_kind ? { wasteKind: row.waste_kind, ...row.group_id === "family" && row.person === "parents" ? { audience: PARENTS } : {} } : {}, ...!row.waste_kind && parseAudience(row.audience) ? { audience: parseAudience(row.audience) } : {}, ...row.end_date ? { endDate: row.end_date } : {}, ...row.time ? { time: row.time } : {}, ...row.note ? { note: row.note } : {} };
}
async function bundle(profile) {
  const db = getDb();
  const result = await db.prepare("SELECT g.* FROM planner_groups g JOIN planner_members m ON m.group_id = g.id WHERE m.profile_id = ? ORDER BY CASE WHEN g.id = 'family' THEN 0 ELSE 1 END, g.name").bind(profile.id).all();
  const groups = await Promise.all(result.results.map(async (group) => {
    const members = await db.prepare("SELECT p.id, p.name, p.color FROM planner_profiles p JOIN planner_members m ON m.profile_id = p.id WHERE m.group_id = ? ORDER BY p.name").bind(group.id).all();
    const subs = await db.prepare("SELECT s.id, s.name, sm.profile_id FROM planner_subgroups s LEFT JOIN planner_subgroup_members sm ON sm.subgroup_id = s.id LEFT JOIN planner_members m ON m.group_id = s.group_id AND m.profile_id = sm.profile_id WHERE s.group_id = ? AND (sm.profile_id IS NULL OR m.profile_id IS NOT NULL) ORDER BY s.name, s.id").bind(group.id).all();
    const subgroups = [];
    for (const row of subs.results) {
      let sub = subgroups.find((s) => s.id === row.id);
      if (!sub) subgroups.push(sub = { id: row.id, name: row.name, members: [] });
      if (row.profile_id) sub.members.push(row.profile_id);
    }
    return { id: group.id, name: group.name, category: group.category, color: group.color, inviteCode: group.invite_code, members: members.results, subgroups };
  }));
  const rows = await db.prepare("SELECT e.* FROM planner_events e JOIN planner_members m ON m.group_id = e.group_id WHERE m.profile_id = ? ORDER BY e.date, e.time").bind(profile.id).all();
  const events = rows.results.filter((row) => !row.waste_kind || row.group_id !== "family" || PARENTS.includes(profile.id)).map(eventFrom);
  if (groups.some((g) => g.id === "family")) {
    const legacy = await db.prepare("SELECT * FROM calendar_items ORDER BY date, time").all();
    events.push(...legacy.results.map((row) => ({ ...eventFrom({ ...row, group_id: "family", person: row.kind === "task" ? row.assignee || "sascha" : row.person || "all", event_type: row.event_type || "private" }), kind: row.kind, completed: !!row.completed })));
    if (PARENTS.includes(profile.id)) {
      const statuses = await db.prepare("SELECT pickup_id, completed FROM waste_pickup_status").all();
      const completed = new Set(statuses.results.filter((row) => row.completed).map((row) => row.pickup_id));
      events.push(...WASTE_PICKUPS.map((pickup) => ({ id: pickup.id, groupId: "family", title: pickup.title, date: pickup.date, person: "parents", audience: PARENTS, eventType: "other", kind: "event", wasteKind: pickup.kind, revision: 1, readonly: true, completed: completed.has(pickup.id), note: WASTE_CALENDAR_SOURCE.area })));
    }
  }
  events.push(...await importedEntries(profile.id));
  return { profile, groups, events: await withEntryActivity(events) };
}
async function bootstrapLegacy() {
  const db = getDb();
  await db.batch([
    ...LEGACY_PEOPLE.map((p) => db.prepare("INSERT OR IGNORE INTO planner_profiles (id, name, color, access_key) VALUES (?, ?, ?, ?)").bind(p.id, p.name, p.color, secret())),
    db.prepare("INSERT OR IGNORE INTO planner_groups (id, name, category, color, invite_code, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind("family", "Familie", "Familie", "#6b73d6", secret().slice(0, 12).toUpperCase(), "sascha"),
    ...LEGACY_PEOPLE.map((p) => db.prepare("INSERT OR IGNORE INTO planner_members (group_id, profile_id) VALUES (?, ?)").bind("family", p.id))
  ]);
}
function fail(error) {
  if (error instanceof ApiError) return reply({ error: error.message }, error.status);
  console.error("Planner API failed", error);
  return reply({ error: "Der Kalender ist gerade nicht erreichbar. Bitte erneut versuchen." }, 500);
}
async function GET5(request) {
  try {
    return reply(await bundle(await identify(request)));
  } catch (e) {
    return fail(e);
  }
}
async function POST4(request) {
  if (!allowed(request)) return reply({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const input = await request.json();
    const db = getDb();
    if (input.action === "legacy") {
      if (!isValidProfileChangeCode(typeof input.code === "string" ? input.code : null)) throw new ApiError("Bitte gib den bisherigen \xC4nderungscode ein, um dein Profil zu \xF6ffnen.", 401);
      const person = LEGACY_PEOPLE.find((p) => p.id === input.id);
      if (!person) throw new ApiError("Unbekanntes Profil.");
      await bootstrapLegacy();
      const row = await db.prepare("SELECT access_key FROM planner_profiles WHERE id = ?").bind(person.id).first();
      return reply({ identity: { id: person.id, key: row.access_key }, ...await bundle(person) });
    }
    if (input.action === "profile") {
      const name = text(input.name, 50);
      if (!name) throw new ApiError("Bitte gib deinen Namen ein.");
      const profile2 = { id: uid(), name, color: "#6973d6" };
      const key = secret();
      await db.prepare("INSERT INTO planner_profiles (id, name, color, access_key) VALUES (?, ?, ?, ?)").bind(profile2.id, name, profile2.color, key).run();
      return reply({ identity: { id: profile2.id, key }, ...await bundle(profile2) });
    }
    const profile = await identify(request);
    if (input.action === "waste-status") {
      const id = text(input.id, 120);
      if (typeof input.completed !== "boolean") throw new ApiError("Ung\xFCltiger Status.");
      if (WASTE_PICKUPS.some((pickup) => pickup.id === id)) {
        await membership("family", profile.id);
        if (!PARENTS.includes(profile.id)) throw new ApiError("Die M\xFClltermine sind f\xFCr Sascha und Katharina.", 403);
        await db.prepare("INSERT INTO waste_pickup_status (pickup_id, completed, completed_by, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(pickup_id) DO UPDATE SET completed=excluded.completed, completed_by=excluded.completed_by, updated_at=excluded.updated_at").bind(id, input.completed ? 1 : 0, input.completed ? profile.id : null).run();
      } else {
        const row = await db.prepare("SELECT * FROM planner_events WHERE id = ?").bind(id).first();
        if (!row?.waste_kind) throw new ApiError("Dieser M\xFClltermin wurde nicht gefunden.", 404);
        await membership(row.group_id, profile.id);
        if (row.group_id === "family" && !PARENTS.includes(profile.id)) throw new ApiError("Die M\xFClltermine sind f\xFCr Sascha und Katharina.", 403);
        await db.prepare("UPDATE planner_events SET completed = ?, revision = revision + 1 WHERE id = ?").bind(input.completed ? 1 : 0, id).run();
      }
      return reply(await bundle(profile));
    }
    if (input.action === "import") {
      const groupId = text(input.groupId, 100);
      await membership(groupId, profile.id);
      const waste = input.mode === "waste";
      if (waste && groupId === "family" && !PARENTS.includes(profile.id)) throw new ApiError("M\xFClltermine sind nur f\xFCr Sascha und Katharina.", 403);
      const person = waste && groupId === "family" ? "parents" : text(input.person, 100) || profile.id;
      if (person === "parents" && !(waste && groupId === "family")) throw new ApiError("Bitte w\xE4hle einen g\xFCltigen Kalender.");
      if (person !== "all" && person !== "parents") await membership(groupId, person);
      if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 2e3) throw new ApiError("Bitte w\xE4hle zwischen 1 und 2.000 Termine aus.");
      const existing = (await bundle(profile)).events.filter((event) => event.groupId === groupId);
      const statements = [];
      let duplicates = 0;
      const contentKey = (e) => waste ? `${e.date}|${e.wasteKind}` : `${e.title}|${e.date}|${e.time || ""}|${e.endDate || ""}|${e.person}`;
      const seen = new Set(existing.map(contentKey));
      for (const value of input.entries) {
        if (!value || typeof value !== "object") throw new ApiError("Ung\xFCltiger Importeintrag.");
        const entry = value;
        const title = text(entry.title, 120), date = text(entry.date, 10), endDate = text(entry.endDate, 10), time = waste ? "" : text(entry.time, 5), note = text(entry.note, 1e3);
        const eventType = waste ? "other" : text(entry.eventType, 20) || "private";
        const wasteKind = waste ? text(entry.wasteKind, 20) : "";
        if (!title || !validDay(date) || endDate && (!validDay(endDate) || endDate < date) || time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError("Bitte pr\xFCfe Datum und Uhrzeit in der Importvorschau.");
        if (!PLANNER_CATEGORIES.some((c) => c.id === eventType) || waste && !WASTE_KINDS.has(wasteKind)) throw new ApiError("Bitte pr\xFCfe die Kategorien und Tonnenarten.");
        if (eventType === "task" && person === "all") throw new ApiError("Bitte w\xE4hle f\xFCr Auftr\xE4ge eine Person aus.");
        const fingerprint = contentKey({ title, date, time, endDate, wasteKind, person });
        if (seen.has(fingerprint)) {
          duplicates++;
          continue;
        }
        seen.add(fingerprint);
        const sourceUid = text(entry.sourceUid, 1e3) || fingerprint;
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${groupId}|${person}|${waste ? "waste" : "event"}|${sourceUid}|${date}`));
        const sourceKey = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
        statements.push(db.prepare("INSERT OR IGNORE INTO planner_events (id, group_id, title, date, end_date, time, note, person, event_type, revision, waste_kind, source_key, completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)").bind(`import-${sourceKey}`, groupId, title, date, waste ? null : endDate || null, time || null, note || null, person, eventType, wasteKind || null, sourceKey));
      }
      let imported = 0;
      for (let index = 0; index < statements.length; index += 100) {
        const results = await db.batch(statements.slice(index, index + 100));
        for (const result of results) {
          imported += result.meta.changes;
          if (!result.meta.changes) duplicates++;
        }
      }
      return reply({ ...await bundle(profile), importSummary: { imported, duplicates } });
    }
    if (input.action === "create-group") {
      const name = text(input.name, 60);
      if (!name) throw new ApiError("Bitte gib einen Gruppennamen ein.");
      const id = uid(), category = text(input.category, 30) || "Sonstiges";
      const colors = { Familie: "#6b73d6", Arbeit: "#4279aa", Team: "#279b86", Freunde: "#b77947", Sonstiges: "#8b69ad" };
      await db.batch([
        db.prepare("INSERT INTO planner_groups (id, name, category, color, invite_code, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, category, colors[category] || colors.Sonstiges, secret().slice(0, 12).toUpperCase(), profile.id),
        db.prepare("INSERT INTO planner_members (group_id, profile_id) VALUES (?, ?)").bind(id, profile.id)
      ]);
      return reply({ ...await bundle(profile), selectedGroupId: id });
    }
    if (input.action === "subgroup-save" || input.action === "subgroup-delete") {
      const groupId = text(input.groupId, 100);
      await membership(groupId, profile.id);
      const id = text(input.id, 100);
      if (id && !/^[\w-]+$/.test(id)) throw new ApiError("Ung\xFCltige Untergruppe.");
      const existing = id ? await db.prepare("SELECT id FROM planner_subgroups WHERE id = ? AND group_id = ?").bind(id, groupId).first() : null;
      if (id && !existing && input.action === "subgroup-delete") return reply(await bundle(profile));
      if (input.action === "subgroup-delete") {
        await db.batch([db.prepare("DELETE FROM planner_subgroup_members WHERE subgroup_id = ?").bind(id), db.prepare("DELETE FROM planner_subgroups WHERE id = ? AND group_id = ?").bind(id, groupId)]);
        return reply(await bundle(profile));
      }
      const name = text(input.name, 50);
      if (!name) throw new ApiError("Bitte gib einen Namen ein.");
      const members = Array.isArray(input.members) ? [...new Set(input.members.filter((m) => typeof m === "string"))].slice(0, 200) : [];
      for (const member of members) await membership(groupId, member);
      if (id && !existing) throw new ApiError("Diese Untergruppe gibt es nicht mehr.", 404);
      const subId = existing?.id || uid();
      await db.batch([
        existing ? db.prepare("UPDATE planner_subgroups SET name = ? WHERE id = ?").bind(name, subId) : db.prepare("INSERT INTO planner_subgroups (id, group_id, name, created_by) VALUES (?, ?, ?, ?)").bind(subId, groupId, name, profile.id),
        db.prepare("DELETE FROM planner_subgroup_members WHERE subgroup_id = ?").bind(subId),
        ...members.map((member) => db.prepare("INSERT INTO planner_subgroup_members (subgroup_id, profile_id) VALUES (?, ?)").bind(subId, member))
      ]);
      return reply({ ...await bundle(profile), subgroupId: subId });
    }
    if (input.action === "join") {
      const code = text(input.code, 30).toUpperCase().replace(/[\s-]/g, "");
      if (!/^[A-F0-9]{12}$/.test(code)) throw new ApiError("Bitte gib den zw\xF6lfstelligen Einladungscode ein.");
      const group = await db.prepare("SELECT id FROM planner_groups WHERE invite_code = ?").bind(code).first();
      if (!group) throw new ApiError("Dieser Einladungscode wurde nicht gefunden.", 404);
      await db.prepare("INSERT OR IGNORE INTO planner_members (group_id, profile_id) VALUES (?, ?)").bind(group.id, profile.id).run();
      return reply({ ...await bundle(profile), selectedGroupId: group.id });
    }
    throw new ApiError("Unbekannte Aktion.");
  } catch (e) {
    return fail(e);
  }
}
function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
async function PUT2(request) {
  if (!allowed(request)) return reply({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const profile = await identify(request);
    const input = await request.json();
    const groupId = text(input.groupId, 100);
    await membership(groupId, profile.id);
    const title = text(input.title, 120), date = text(input.date, 10), endDate = text(input.endDate, 10), time = text(input.time, 5), note = text(input.note, 1e3);
    const audience = parseAudience(input.audience) || null;
    if (Array.isArray(input.audience) && input.audience.length > 200) throw new ApiError("Zu viele Personen.");
    const person = audience ? audience[0] : text(input.person, 100);
    if (audience) for (const member of audience) await membership(groupId, member);
    const eventType = input.kind === "task" ? "task" : text(input.eventType, 20) || "private";
    if (!PLANNER_CATEGORIES.some((category) => category.id === eventType)) throw new ApiError("Die Art des Eintrags ist ung\xFCltig.");
    if (!title || !validDay(date) || endDate && (!validDay(endDate) || endDate < date)) throw new ApiError("Bitte pr\xFCfe Titel und Zeitraum.");
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError("Bitte pr\xFCfe die Uhrzeit.");
    if (person !== "all" && person !== "parents") await membership(groupId, person);
    const id = text(input.id, 100) || uid();
    if (!/^[\w-]+$/.test(id)) throw new ApiError("Ung\xFCltiger Eintrag.");
    if (WASTE_PICKUPS.some((pickup) => pickup.id === id)) throw new ApiError("Diese M\xFCllabholung kann als rausgestellt best\xE4tigt werden.");
    const imported = await getDb().prepare("SELECT * FROM planner_events WHERE id = ?").bind(id).first();
    if (audience && imported?.waste_kind) throw new ApiError("Ung\xFCltiger Kalender.");
    if (person === "parents" && (!imported?.waste_kind || groupId !== "family" || !PARENTS.includes(profile.id))) throw new ApiError("Ung\xFCltiger Kalender.", 403);
    if (imported?.waste_kind && groupId === "family" && !PARENTS.includes(profile.id)) throw new ApiError("Die M\xFClltermine sind f\xFCr Sascha und Katharina.", 403);
    if (groupId === "family" && !imported) {
      const headers = new Headers(request.headers);
      headers.set("x-familyflow-actor", profile.id);
      const result = await PUT(new Request(request.url, { method: "PUT", headers, body: JSON.stringify({ id, kind: input.kind === "task" ? "task" : "event", title, date, endDate, time, note, person, assignee: person, ...audience ? { audience } : {}, completed: input.completed, eventType: input.eventType || "private", revision: input.revision }) }));
      if (!result.ok) return result;
      return reply(request.headers.get("prefer")?.includes("return=minimal") ? { saved: true } : await bundle(profile));
    }
    const db = getDb();
    const old = await db.prepare("SELECT group_id, revision FROM planner_events WHERE id = ?").bind(id).first();
    if (old && old.group_id !== groupId) throw new ApiError("Dieser Eintrag geh\xF6rt zu einer anderen Gruppe.", 403);
    if (old && old.revision !== input.revision) throw new ApiError("Dieser Termin wurde inzwischen ge\xE4ndert. Bitte neu laden.", 409);
    const previous = old && !imported?.waste_kind ? await entrySnapshot({ kind: "event", id }) : void 0;
    const write = await db.prepare(`INSERT INTO planner_events (id, group_id, title, date, end_date, time, note, person, event_type, revision, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date, end_date=excluded.end_date, time=excluded.time, note=excluded.note, person=excluded.person, event_type=excluded.event_type, audience=excluded.audience, revision=excluded.revision WHERE planner_events.revision=excluded.revision-1 AND planner_events.group_id=excluded.group_id`).bind(id, groupId, title, date, endDate || null, time || null, note || null, person, eventType, old ? old.revision + 1 : 1, audience ? JSON.stringify(audience) : null).run();
    if (!write.meta.changes) throw new ApiError("Der Termin wurde inzwischen ge\xE4ndert. Bitte neu laden.", 409);
    if (!imported?.waste_kind) await recordEntryChange({ kind: "event", id }, profile, previous);
    return reply(request.headers.get("prefer")?.includes("return=minimal") ? { saved: true } : await bundle(profile));
  } catch (e) {
    return fail(e);
  }
}
async function DELETE2(request) {
  if (!allowed(request)) return reply({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const profile = await identify(request);
    const input = await request.json();
    const groupId = text(input.groupId, 100);
    await membership(groupId, profile.id);
    if (WASTE_PICKUPS.some((pickup) => pickup.id === input.id)) throw new ApiError("Die bestehenden M\xFCllabholungen bleiben erhalten.");
    const imported = await getDb().prepare("SELECT * FROM planner_events WHERE id = ?").bind(input.id).first();
    if (imported?.waste_kind && groupId === "family" && !PARENTS.includes(profile.id)) throw new ApiError("Die M\xFClltermine sind f\xFCr Sascha und Katharina.", 403);
    if (groupId === "family" && !imported) {
      const result = await DELETE(new Request(request.url, { method: "DELETE", headers: request.headers, body: JSON.stringify({ id: input.id, revision: input.revision }) }));
      if (!result.ok) return result;
    } else {
      const db = getDb();
      const old = await db.prepare("SELECT revision FROM planner_events WHERE id = ? AND group_id = ?").bind(input.id, groupId).first();
      if (old && old.revision !== input.revision) throw new ApiError("Dieser Termin wurde inzwischen ge\xE4ndert. Bitte neu laden.", 409);
      if (old) {
        const previous = !imported?.waste_kind ? await entrySnapshot({ kind: "event", id: String(input.id) }) : void 0;
        const deleted = await db.prepare("DELETE FROM planner_events WHERE id = ? AND group_id = ? AND revision = ?").bind(input.id, groupId, old.revision).run();
        if (!deleted.meta.changes) throw new ApiError("Dieser Termin wurde inzwischen ge\xE4ndert. Bitte neu laden.", 409);
        if (previous) await recordEntryChange({ kind: "event", id: String(input.id) }, profile, previous, true);
      }
    }
    return reply(await bundle(profile));
  } catch (e) {
    return fail(e);
  }
}

// app/api/profile/unlock/route.ts
var route_exports7 = {};
__export(route_exports7, {
  POST: () => POST5,
  dynamic: () => dynamic7
});
var dynamic7 = "force-dynamic";
function response2(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function allowRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && (!origin || origin === url.origin);
}
async function POST5(request) {
  if (!allowRequest(request)) return response2({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const input = await request.json();
    if (typeof input.code !== "string" || input.code.length > 100) {
      return response2({ error: "Der \xC4nderungscode ist ung\xFCltig." }, 403);
    }
    if (!isValidProfileChangeCode(input.code)) {
      return response2({ error: "Der \xC4nderungscode ist falsch." }, 403);
    }
    return response2({ valid: true });
  } catch {
    return response2({ error: "Der \xC4nderungscode konnte nicht gepr\xFCft werden." }, 400);
  }
}

// app/api/push/daily/route.ts
var route_exports8 = {};
__export(route_exports8, {
  GET: () => GET6,
  POST: () => POST6,
  dynamic: () => dynamic8
});
var dynamic8 = "force-dynamic";
function berlinDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(/* @__PURE__ */ new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
async function sendDailySummary(db, subscription) {
  const date = berlinDateKey();
  if (subscription.last_daily_sent === date) return { sent: false, reason: "already-sent" };
  const counts = await db.prepare(`
    SELECT
      SUM(CASE WHEN kind = 'event' AND (person = ? OR person = 'all' OR audience LIKE ?) THEN 1 ELSE 0 END) AS events,
      SUM(CASE WHEN kind = 'task' AND (assignee = ? OR audience LIKE ?) AND completed = 0 THEN 1 ELSE 0 END) AS tasks
    FROM calendar_items
    WHERE date <= ? AND COALESCE(end_date, date) >= ?
  `).bind(subscription.person, `%"${subscription.person}"%`, subscription.person, `%"${subscription.person}"%`, date, date).first();
  const events = Number(counts?.events ?? 0);
  const tasks = Number(counts?.tasks ?? 0);
  const completedWaste = await db.prepare(`
    SELECT pickup_id
    FROM waste_pickup_status
    WHERE completed = 1
  `).all();
  const completedWasteIds = new Set(completedWaste.results.map((row) => row.pickup_id));
  const wastePickups = subscription.person === "arjen" ? [] : wastePickupsForDate(date).filter((pickup) => !completedWasteIds.has(pickup.id));
  const importedWaste = subscription.person === "arjen" ? [] : (await db.prepare("SELECT title FROM planner_events WHERE group_id = 'family' AND waste_kind IS NOT NULL AND date = ? AND completed = 0 AND (person = 'parents' OR person = ? OR person = 'all')").bind(date, subscription.person).all()).results;
  const wasteLabels = [...wastePickups.map((pickup) => pickup.shortTitle), ...importedWaste.map((pickup) => pickup.title)];
  if (!events && !tasks && !wasteLabels.length) return { sent: false, reason: "empty" };
  const parts = [
    events ? countLabel(events, "Termin", "Termine") : "",
    tasks ? countLabel(tasks, "offener Auftrag", "offene Auftr\xE4ge") : "",
    wasteLabels.length ? `M\xFCll: ${wasteLabels.join(" + ")}` : ""
  ].filter(Boolean);
  const sent = await sendPushToSubscription(db, subscription, {
    title: "Done \xB7 Heute",
    body: `Heute: ${parts.join(" \xB7 ")}.`,
    tag: `daily-${date}`,
    url: "/"
  });
  if (sent) {
    await db.prepare("UPDATE push_subscriptions SET last_daily_sent = ? WHERE endpoint = ?").bind(date, subscription.endpoint).run();
  }
  return { sent, reason: sent ? "sent" : "push-failed" };
}
async function GET6(request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return Response.json({ sent: false, error: "Ung\xFCltiger Erinnerungslink" }, { status: 400 });
  }
  try {
    const db = getDb();
    const subscription = await db.prepare(`
      SELECT endpoint, person, p256dh, auth, last_daily_sent
      FROM push_subscriptions
      WHERE reminder_token = ?
    `).bind(token).first();
    if (!subscription) return Response.json({ sent: false, error: "Erinnerungslink nicht mehr g\xFCltig" }, { status: 404 });
    return Response.json(await sendDailySummary(db, subscription), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FamilyFlow daily reminder failed", error);
    return Response.json({ sent: false, error: "Tageserinnerung nicht erreichbar" }, { status: 500 });
  }
}
async function POST6(request) {
  const expected = env.DAILY_PUSH_TOKEN;
  const supplied = request.headers.get("authorization");
  if (!expected || supplied !== `Bearer ${expected}`) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const db = getDb();
    const subscriptions = await db.prepare(`
      SELECT endpoint, person, p256dh, auth, last_daily_sent
      FROM push_subscriptions
      ORDER BY person, endpoint
    `).all();
    const results = await Promise.all(subscriptions.results.map((subscription) => sendDailySummary(db, subscription)));
    return Response.json({ checked: results.length, sent: results.filter((result) => result.sent).length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Daily push dispatch failed", error);
    return Response.json({ error: "Tageserinnerungen konnten nicht versendet werden" }, { status: 500 });
  }
}

// app/api/push/subscription/route.ts
var route_exports9 = {};
__export(route_exports9, {
  DELETE: () => DELETE3,
  POST: () => POST7,
  dynamic: () => dynamic9
});
var dynamic9 = "force-dynamic";
var PEOPLE2 = /* @__PURE__ */ new Set(["sascha", "katharina", "arjen"]);
function response3(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function allowWrite2(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && (!origin || origin === url.origin);
}
function parseSubscription(value) {
  if (!value || typeof value !== "object") return null;
  const input = value;
  const keys = input.keys;
  if (typeof input.endpoint !== "string" || !input.endpoint.startsWith("https://") || input.endpoint.length > 2048 || !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || keys.p256dh.length > 256 || keys.auth.length > 256) return null;
  return { endpoint: input.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}
async function POST7(request) {
  if (!allowWrite2(request)) return response3({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const input = await request.json();
    if (typeof input.person !== "string" || !PEOPLE2.has(input.person)) {
      return response3({ error: "Ung\xFCltiges Familienprofil" }, 400);
    }
    const subscription = parseSubscription(input.subscription);
    if (!subscription) return response3({ error: "Ung\xFCltige Push-Verbindung" }, 400);
    if (typeof input.deviceId !== "string" || !/^[a-zA-Z0-9-]{20,80}$/.test(input.deviceId)) {
      return response3({ error: "Ung\xFCltige Ger\xE4tekennung" }, 400);
    }
    const previousEndpoint = typeof input.previousEndpoint === "string" && input.previousEndpoint.startsWith("https://") ? input.previousEndpoint : null;
    const db = getDb();
    const existing = await db.prepare(
      "SELECT reminder_token FROM push_subscriptions WHERE endpoint = ?"
    ).bind(subscription.endpoint).first();
    const previous = previousEndpoint && previousEndpoint !== subscription.endpoint ? await db.prepare("SELECT reminder_token FROM push_subscriptions WHERE endpoint = ?").bind(previousEndpoint).first() : null;
    const reminderToken = existing?.reminder_token ?? previous?.reminder_token ?? crypto.randomUUID().replace(/-/g, "");
    if (previousEndpoint && previousEndpoint !== subscription.endpoint) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(previousEndpoint).run();
    }
    await db.prepare(`
      INSERT INTO push_subscriptions (endpoint, device_id, person, p256dh, auth, reminder_token, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(endpoint) DO UPDATE SET
        device_id = excluded.device_id,
        person = excluded.person,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        updated_at = excluded.updated_at
    `).bind(subscription.endpoint, input.deviceId, input.person, subscription.p256dh, subscription.auth, reminderToken).run();
    const reminderUrl = new URL("/api/push/daily", request.url);
    reminderUrl.searchParams.set("token", reminderToken);
    return response3({ subscribed: true, reminderUrl: reminderUrl.toString() });
  } catch (error) {
    console.error("FamilyFlow push subscription failed", error);
    return response3({ error: "Die Mitteilungen konnten nicht verbunden werden." }, 500);
  }
}
async function DELETE3(request) {
  if (!allowWrite2(request)) return response3({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const input = await request.json();
    if (typeof input.endpoint !== "string" || !input.endpoint.startsWith("https://")) {
      return response3({ error: "Ung\xFCltige Push-Verbindung" }, 400);
    }
    await getDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(input.endpoint).run();
    return response3({ deleted: true });
  } catch (error) {
    console.error("FamilyFlow push unsubscribe failed", error);
    return response3({ error: "Die Mitteilungen konnten nicht deaktiviert werden." }, 500);
  }
}

// app/api/shopping/route.ts
var route_exports10 = {};
__export(route_exports10, {
  DELETE: () => DELETE4,
  GET: () => GET7,
  PUT: () => PUT3,
  dynamic: () => dynamic10
});
var dynamic10 = "force-dynamic";
var PEOPLE3 = /* @__PURE__ */ new Set(["sascha", "katharina", "arjen"]);
var ValidationError2 = class extends Error {
};
function response4(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function allowWrite3(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && (!origin || origin === url.origin);
}
function fromRow2(row) {
  return { id: row.id, label: row.label, productKey: row.product_key, addedBy: row.added_by, createdAt: row.created_at };
}
function parseItem2(value) {
  if (!value || typeof value !== "object") throw new ValidationError2("Ung\xFCltiger Artikel");
  const input = value;
  const id = typeof input.id === "string" ? input.id : "";
  const label = typeof input.label === "string" ? input.label.trim() : "";
  const productKey = typeof input.productKey === "string" ? input.productKey : "";
  const addedBy = input.addedBy;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError2("Ung\xFCltige ID");
  if (!label || label.length > 120) throw new ValidationError2("Der Artikelname ist ung\xFCltig");
  if (!/^[a-z0-9_]{1,60}$/.test(productKey)) throw new ValidationError2("Die Artikelart ist ung\xFCltig");
  if (typeof addedBy !== "string" || !PEOPLE3.has(addedBy)) throw new ValidationError2("Die Person ist ung\xFCltig");
  return { id, label, productKey, addedBy };
}
function errorMessage2(error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message.includes("no such table") ? "Die Einkaufsliste wird gerade eingerichtet. Bitte gleich noch einmal versuchen." : "Die Einkaufsliste ist gerade nicht erreichbar.";
}
async function GET7(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  try {
    const result = await getDb().prepare(`
      SELECT id, label, product_key, added_by, created_at
      FROM shopping_items
      ORDER BY created_at DESC, label ASC
    `).all();
    return response4({ items: result.results.map(fromRow2) });
  } catch (error) {
    console.error("FamilyFlow shopping GET failed", error);
    return response4({ error: errorMessage2(error) }, 500);
  }
}
async function PUT3(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite3(request)) return response4({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const item = parseItem2(await request.json());
    await getDb().prepare(`
      INSERT INTO shopping_items (id, label, product_key, added_by, created_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).bind(item.id, item.label, item.productKey, item.addedBy).run();
    const saved = await getDb().prepare(`
      SELECT id, label, product_key, added_by, created_at
      FROM shopping_items WHERE id = ?
    `).bind(item.id).first();
    return response4({ item: saved ? fromRow2(saved) : item });
  } catch (error) {
    if (error instanceof ValidationError2) return response4({ error: error.message }, 400);
    console.error("FamilyFlow shopping PUT failed", error);
    return response4({ error: errorMessage2(error) }, 500);
  }
}
async function DELETE4(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite3(request)) return response4({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const input = await request.json();
    if (typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)) {
      return response4({ error: "Ung\xFCltige ID" }, 400);
    }
    await getDb().prepare("DELETE FROM shopping_items WHERE id = ?").bind(input.id).run();
    return response4({ deleted: true });
  } catch (error) {
    console.error("FamilyFlow shopping DELETE failed", error);
    return response4({ error: errorMessage2(error) }, 500);
  }
}

// app/api/todo/route.ts
var route_exports11 = {};
__export(route_exports11, {
  DELETE: () => DELETE5,
  GET: () => GET8,
  POST: () => POST8,
  PUT: () => PUT4,
  dynamic: () => dynamic11
});
var dynamic11 = "force-dynamic";
var PEOPLE4 = /* @__PURE__ */ new Set(["sascha", "katharina", "arjen"]);
var ValidationError3 = class extends Error {
};
function response5(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function allowWrite4(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && (!origin || origin === url.origin);
}
function fromRow3(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    ...row.date ? { date: row.date } : {},
    ...row.note ? { note: row.note } : {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...todoAudience(row.audience) ? { audience: todoAudience(row.audience) } : {}
  };
}
function todoAudience(value) {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return void 0;
    }
  }
  if (!Array.isArray(list)) return void 0;
  const ids = [...new Set(list.filter((id) => typeof id === "string" && PEOPLE4.has(id)))];
  return ids.length && ids.length < PEOPLE4.size ? ids : void 0;
}
function errorMessage3(error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message.includes("no such table") ? "Die gemeinsame To-do-Liste wird gerade eingerichtet. Bitte gleich noch einmal versuchen." : "Die gemeinsame To-do-Liste ist gerade nicht erreichbar.";
}
function parseTodo(value) {
  if (!value || typeof value !== "object") throw new ValidationError3("Ung\xFCltiger Eintrag");
  const input = value;
  const id = typeof input.id === "string" ? input.id : "";
  const kind = input.kind;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : void 0;
  const date = input.date == null || input.date === "" ? void 0 : input.date;
  if (date !== void 0 && !isCalendarDate(date)) throw new ValidationError3("Bitte w\xE4hle ein g\xFCltiges Datum");
  const createdBy = input.createdBy;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError3("Ung\xFCltige ID");
  if (kind !== "event" && kind !== "task") throw new ValidationError3("Ung\xFCltige Art");
  if (!title || title.length > 120) throw new ValidationError3("Der Titel ist ung\xFCltig");
  if (note && note.length > 1e3) throw new ValidationError3("Die Notiz ist zu lang");
  if (typeof createdBy !== "string" || !PEOPLE4.has(createdBy)) throw new ValidationError3("Die Person ist ung\xFCltig");
  if (Array.isArray(input.audience) && input.audience.some((person) => typeof person !== "string" || !PEOPLE4.has(person))) throw new ValidationError3("Die Person ist ung\xFCltig");
  const audience = todoAudience(input.audience);
  return { id, kind, title, ...date ? { date } : {}, ...note ? { note } : {}, createdBy, ...audience ? { audience } : {} };
}
async function GET8(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  try {
    const result = await getDb().prepare(`
      SELECT id, kind, title, date, note, created_by, created_at, audience
      FROM todo_items
      ORDER BY created_at DESC, title ASC
    `).all();
    return response5({ items: await withEntryActivity(result.results.map(fromRow3), "todo") });
  } catch (error) {
    console.error("FamilyFlow todo GET failed", error);
    return response5({ error: errorMessage3(error) }, 500);
  }
}
async function PUT4(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite4(request)) return response5({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const item = parseTodo(await request.json());
    await getDb().prepare(`
      INSERT INTO todo_items (id, kind, title, date, note, created_by, created_at, audience)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
    `).bind(item.id, item.kind, item.title, item.date ?? null, item.note ?? null, item.createdBy, item.audience ? JSON.stringify(item.audience) : null).run();
    const saved = await getDb().prepare(`
      SELECT id, kind, title, date, note, created_by, created_at, audience
      FROM todo_items WHERE id = ?
    `).bind(item.id).first();
    const actor = await chatIdentity(request);
    await recordEntryChange({ kind: "todo", id: item.id }, actor);
    if (item.audience) await notifyPeople(getDb(), item.audience.filter((person) => person !== actor.id), { title: item.kind === "task" ? "Offener Auftrag f\xFCr dich" : "Offener Termin f\xFCr dich", body: `${item.title} \xB7 Kannst du \xFCbernehmen?`, tag: `todo-${item.id}`, url: "/" }, request.headers.get("x-familyflow-device"));
    return response5({ item: saved ? fromRow3(saved) : item });
  } catch (error) {
    if (error instanceof ValidationError3) return response5({ error: error.message }, 400);
    console.error("FamilyFlow todo PUT failed", error);
    return response5({ error: errorMessage3(error) }, 500);
  }
}
async function POST8(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite4(request)) return response5({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const input = await request.json();
    const id = typeof input.id === "string" ? input.id : "";
    const person = input.person;
    const completed = input.completed === true;
    let date = typeof input.date === "string" ? input.date : "";
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ValidationError3("Ung\xFCltige ID");
    if (typeof person !== "string" || !PEOPLE4.has(person)) throw new ValidationError3("Die Person ist ung\xFCltig");
    const db = getDb();
    const row = await db.prepare(`
      SELECT id, kind, title, date, note, created_by, created_at, audience
      FROM todo_items WHERE id = ?
    `).bind(id).first();
    if (!row) return response5({ error: "Dieser Eintrag wurde bereits \xFCbernommen." }, 409);
    const offered = todoAudience(row.audience);
    if (!completed && offered && !offered.includes(person)) throw new ValidationError3("Dieser Auftrag ist f\xFCr andere Personen gedacht.");
    date = row.date || date;
    if (!completed && !isCalendarDate(date)) throw new ValidationError3("Bitte w\xE4hle einen g\xFCltigen Tag");
    const inboxProfile = await chatIdentity(request);
    const previousSnapshot = await entrySnapshot({ kind: "todo", id });
    if (completed) {
      await db.prepare("DELETE FROM todo_items WHERE id = ?").bind(id).run();
      await recordEntryChange({ kind: "todo", id }, inboxProfile, previousSnapshot, true);
      return response5({ removedId: id });
    }
    const calendarId = `todo-${id}`;
    const calendarItem = row.kind === "task" ? { id: calendarId, kind: "task", title: row.title, date, ...row.note ? { note: row.note } : {}, assignee: person, completed: false } : { id: calendarId, kind: "event", title: row.title, date, ...row.note ? { note: row.note } : {}, eventType: "private", person };
    await db.batch([
      db.prepare(`
        INSERT OR IGNORE INTO calendar_items (id, kind, title, date, end_date, event_type, time, note, person, assignee, completed, revision, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).bind(
        calendarItem.id,
        calendarItem.kind,
        calendarItem.title,
        calendarItem.date,
        calendarItem.kind === "event" ? "private" : null,
        calendarItem.note ?? null,
        calendarItem.kind === "event" ? calendarItem.person ?? null : null,
        calendarItem.kind === "task" ? calendarItem.assignee ?? null : null
      ),
      db.prepare("DELETE FROM todo_items WHERE id = ?").bind(id)
    ]);
    await recordEntryChange({ kind: "todo", id }, inboxProfile, previousSnapshot);
    return response5({ removedId: id, calendarItem });
  } catch (error) {
    if (error instanceof ValidationError3) return response5({ error: error.message }, 400);
    console.error("FamilyFlow todo POST failed", error);
    return response5({ error: errorMessage3(error) }, 500);
  }
}
async function DELETE5(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite4(request)) return response5({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const input = await request.json();
    if (typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)) {
      return response5({ error: "Ung\xFCltige ID" }, 400);
    }
    const current = await getDb().prepare("SELECT id FROM todo_items WHERE id=?").bind(input.id).first();
    if (!current) return response5({ deleted: true });
    const inboxProfile = await chatIdentity(request);
    const previousSnapshot = await entrySnapshot({ kind: "todo", id: input.id });
    await getDb().prepare("DELETE FROM todo_items WHERE id = ?").bind(input.id).run();
    await recordEntryChange({ kind: "todo", id: input.id }, inboxProfile, previousSnapshot, true);
    return response5({ deleted: true });
  } catch (error) {
    console.error("FamilyFlow todo DELETE failed", error);
    return response5({ error: errorMessage3(error) }, 500);
  }
}

// app/api/waste/route.ts
var route_exports12 = {};
__export(route_exports12, {
  GET: () => GET9,
  PUT: () => PUT5,
  dynamic: () => dynamic12
});
var dynamic12 = "force-dynamic";
var PEOPLE5 = /* @__PURE__ */ new Set(["sascha", "katharina", "arjen"]);
var PICKUP_IDS = new Set(WASTE_PICKUPS.map((pickup) => pickup.id));
function response6(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function allowWrite5(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && (!origin || origin === url.origin);
}
function actorFromRequest(request) {
  const actor = request.headers.get("x-familyflow-actor");
  return actor && PEOPLE5.has(actor) ? actor : null;
}
function fromRow4(row) {
  return {
    pickupId: row.pickup_id,
    completed: row.completed === 1,
    ...row.completed_by ? { completedBy: row.completed_by } : {},
    updatedAt: row.updated_at
  };
}
async function GET9(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  try {
    const result = await getDb().prepare(`
      SELECT pickup_id, completed, completed_by, updated_at
      FROM waste_pickup_status
      ORDER BY pickup_id
    `).all();
    return response6({ completions: result.results.map(fromRow4) });
  } catch (error) {
    console.error("Waste status GET failed", error);
    return response6({ error: "Der M\xFCllkalender konnte nicht synchronisiert werden." }, 500);
  }
}
async function PUT5(request) {
  const denied = await familyApiAccess(request);
  if (denied) return denied;
  if (!allowWrite5(request)) return response6({ error: "Unzul\xE4ssige Anfrage" }, 403);
  try {
    const actor = actorFromRequest(request);
    if (!actor) return response6({ error: "Bitte zuerst ein Familienprofil ausw\xE4hlen." }, 400);
    const value = await request.json();
    if (typeof value.pickupId !== "string" || !PICKUP_IDS.has(value.pickupId)) {
      return response6({ error: "Unbekannter M\xFClltermin" }, 400);
    }
    if (typeof value.completed !== "boolean") {
      return response6({ error: "Ung\xFCltiger Status" }, 400);
    }
    const db = getDb();
    await db.prepare(`
      INSERT INTO waste_pickup_status (pickup_id, completed, completed_by, updated_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(pickup_id) DO UPDATE SET
        completed = excluded.completed,
        completed_by = excluded.completed_by,
        updated_at = excluded.updated_at
    `).bind(value.pickupId, value.completed ? 1 : 0, value.completed ? actor : null).run();
    const saved = await db.prepare(`
      SELECT pickup_id, completed, completed_by, updated_at
      FROM waste_pickup_status
      WHERE pickup_id = ?
    `).bind(value.pickupId).first();
    if (!saved) throw new Error("Waste status was not saved");
    return response6({ completion: fromRow4(saved) });
  } catch (error) {
    console.error("Waste status PUT failed", error);
    return response6({ error: "Der Status konnte nicht f\xFCr alle Ger\xE4te gespeichert werden." }, 500);
  }
}

// server/d1-postgres.ts
function splitPlaceholders(sql) {
  const parts = [];
  const refs = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") quoted = !quoted;
    if (ch === "$" && !quoted && /[0-9]/.test(sql[i + 1] || "")) {
      let j = i + 1;
      while (/[0-9]/.test(sql[j] || "")) j++;
      parts.push(current);
      current = "";
      refs.push(Number(sql.slice(i + 1, j)) - 1);
      i = j - 1;
    } else current += ch;
  }
  parts.push(current);
  return { parts, refs };
}
function rpcExecutor(call) {
  const toStatement = (sql, params) => ({ ...splitPlaceholders(sql), params });
  return {
    async query(sql, params) {
      return (await call([toStatement(sql, params)]))[0];
    },
    async transaction() {
      throw new Error("Transaktionen laufen \xFCber batch()");
    },
    batch(statements) {
      return call(statements.map((s) => toStatement(s.sql, s.params)));
    }
  };
}
var cache = /* @__PURE__ */ new Map();
function translateSql(input) {
  const hit = cache.get(input);
  if (hit) return hit;
  let sql = input;
  sql = sql.replace(/SELECT \? AS id\)/g, "SELECT ?::text AS id)");
  sql = sql.replace(/strftime\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*\)/g, `to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
  sql = sql.replace(/json_each\(([\w.]+)\)/g, (_m, col) => `json_array_elements_text((${col})::json) AS je(value)`);
  sql = sql.replace(/SUM\(([\w.]+\s*(?:=\s*'[^']*'|IN\s*\([^)]*\)))\)/g, (_m, expr) => `SUM((${expr})::int)`);
  sql = sql.replace(/ORDER BY ((?:\w+\.)?date), ((?:\w+\.)?time)\b(?!\s+NULLS)/g, "ORDER BY $1, $2 NULLS FIRST");
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) {
    sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO").replace(/\s*;?\s*$/, " ON CONFLICT DO NOTHING");
  }
  let index = 0;
  let out = "";
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    if (ch === "?" && !quoted) {
      index += 1;
      out += `$${index}`;
    } else out += ch;
  }
  cache.set(input, out);
  return out;
}
function normalizeParam(value) {
  if (value === void 0) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}
var Statement = class _Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new _Statement(this.db, this.sql, params);
  }
  async all() {
    const r = await this.db.exec(this.sql, this.params);
    return { results: r.rows, success: true, meta: { changes: r.count } };
  }
  async first(column) {
    const r = await this.db.exec(this.sql, this.params);
    const row = r.rows[0];
    if (!row) return null;
    return column ? row[column] : row;
  }
  async run() {
    const r = await this.db.exec(this.sql, this.params);
    return { success: true, results: r.rows, meta: { changes: r.count } };
  }
  async raw() {
    const r = await this.db.exec(this.sql, this.params);
    return r.rows.map((row) => Object.values(row));
  }
};
var D1OnPostgres = class {
  constructor(executor) {
    this.executor = executor;
  }
  exec(sql, params) {
    return this.executor.query(translateSql(sql), params.map(normalizeParam));
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  async batch(statements) {
    if (this.executor.batch) {
      const results = await this.executor.batch(statements.map((s) => ({ sql: translateSql(s.sql), params: s.params.map(normalizeParam) })));
      return results.map((r) => ({ success: true, results: r.rows, meta: { changes: r.count } }));
    }
    return this.executor.transaction(async (query) => {
      const results = [];
      for (const s of statements) {
        const r = await query(translateSql(s.sql), s.params.map(normalizeParam));
        results.push({ success: true, results: r.rows, meta: { changes: r.count } });
      }
      return results;
    });
  }
};

// server/routes.ts
var routes = [
  { pattern: /^\/api\/calendar$/, module: route_exports },
  { pattern: /^\/api\/discussions$/, module: route_exports2 },
  { pattern: /^\/api\/discussions\/attachments$/, module: route_exports3 },
  { pattern: /^\/api\/discussions\/media\/([^/]+)$/, module: route_exports4, params: ["id"] },
  { pattern: /^\/api\/inbox$/, module: route_exports5 },
  { pattern: /^\/api\/planner$/, module: route_exports6 },
  { pattern: /^\/api\/profile\/unlock$/, module: route_exports7 },
  { pattern: /^\/api\/push\/daily$/, module: route_exports8 },
  { pattern: /^\/api\/push\/subscription$/, module: route_exports9 },
  { pattern: /^\/api\/shopping$/, module: route_exports10 },
  { pattern: /^\/api\/todo$/, module: route_exports11 },
  { pattern: /^\/api\/waste$/, module: route_exports12 }
];
export {
  D1OnPostgres,
  routes,
  rpcExecutor,
  translateSql
};

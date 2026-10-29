import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const calendarItems = sqliteTable("calendar_items", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["event", "task"] }).notNull(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  endDate: text("end_date"),
  eventType: text("event_type", { enum: ["private", "work", "vacation", "holidays", "birthday", "other"] }),
  time: text("time"),
  note: text("note"),
  person: text("person", { enum: ["all", "sascha", "katharina", "arjen"] }),
  assignee: text("assignee", { enum: ["sascha", "katharina", "arjen"] }),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_calendar_items_date").on(table.date)]);

export const wastePickupStatus = sqliteTable("waste_pickup_status", {
  pickupId: text("pickup_id").primaryKey(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  completedBy: text("completed_by", { enum: ["sascha", "katharina", "arjen"] }),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const todoItems = sqliteTable("todo_items", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["event", "task"] }).notNull(),
  title: text("title").notNull(),
  date: text("date"),
  note: text("note"),
  createdBy: text("created_by", { enum: ["sascha", "katharina", "arjen"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_todo_items_created_at").on(table.createdAt)]);

export const shoppingItems = sqliteTable("shopping_items", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  productKey: text("product_key").notNull(),
  addedBy: text("added_by", { enum: ["sascha", "katharina", "arjen"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_shopping_items_created_at").on(table.createdAt)]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  deviceId: text("device_id"),
  person: text("person", { enum: ["sascha", "katharina", "arjen"] }).notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  reminderToken: text("reminder_token").notNull().unique(),
  lastDailySent: text("last_daily_sent"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_push_subscriptions_person").on(table.person)]);

export const plannerProfiles = sqliteTable("planner_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  accessKey: text("access_key").notNull().unique(),
});

export const plannerGroups = sqliteTable("planner_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  color: text("color").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdBy: text("created_by").notNull(),
});

export const plannerMembers = sqliteTable("planner_members", {
  groupId: text("group_id").notNull(),
  profileId: text("profile_id").notNull(),
}, (table) => [primaryKey({ columns: [table.groupId, table.profileId] })]);

export const plannerEvents = sqliteTable("planner_events", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  endDate: text("end_date"),
  time: text("time"),
  note: text("note"),
  person: text("person").notNull(),
  eventType: text("event_type").notNull().default("private"),
  revision: integer("revision").notNull().default(1),
  wasteKind: text("waste_kind"),
  sourceKey: text("source_key").unique(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
}, (table) => [index("planner_events_group_date").on(table.groupId, table.date)]);

export const entryThreads = sqliteTable('entry_threads', {
 id: text('id').primaryKey(), sourceKind: text('source_kind').notNull(), sourceId: text('source_id').notNull(), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('entry_threads_source').on(t.sourceKind,t.sourceId)]);
export const entryMessages = sqliteTable('entry_messages', {
 id:text('id').primaryKey(),threadId:text('thread_id').notNull(),authorId:text('author_id').notNull(),body:text('body').notNull().default(''),attachmentId:text('attachment_id'),createdAt:text('created_at').notNull(),
},t=>[index('entry_messages_thread_time').on(t.threadId,t.createdAt)]);
export const entryAttachments = sqliteTable('entry_attachments', {
 id:text('id').primaryKey(),threadId:text('thread_id').notNull(),authorId:text('author_id').notNull(),objectKey:text('object_key').notNull(),name:text('name').notNull(),mime:text('mime').notNull(),size:integer('size').notNull(),duration:integer('duration'),createdAt:text('created_at').notNull(),
},t=>[index('entry_attachments_thread').on(t.threadId)]);
export const entryShares = sqliteTable('entry_shares', {
 token:text('token').primaryKey(),threadId:text('thread_id').notNull(),createdBy:text('created_by').notNull(),active:integer('active',{mode:'boolean'}).notNull().default(true),createdAt:text('created_at').notNull(),
},t=>[index('entry_shares_thread').on(t.threadId)]);
export const entryGuests=sqliteTable('entry_guests',{
 token:text('token').notNull(),profileId:text('profile_id').notNull(),groupId:text('group_id'),calendarDate:text('calendar_date'),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.token,t.profileId]})]);
export const entryReminders=sqliteTable('entry_reminders',{
 id:text('id').primaryKey(),threadId:text('thread_id').notNull(),profileId:text('profile_id').notNull(),remindAt:text('remind_at').notNull(),delivered:integer('delivered',{mode:'boolean'}).notNull().default(false),
},t=>[index('entry_reminders_profile_time').on(t.profileId,t.remindAt)]);

export const entryChanges=sqliteTable('entry_changes',{
 id:text('id').primaryKey(),threadId:text('thread_id').notNull(),groupId:text('group_id').notNull(),actorId:text('actor_id').notNull(),kind:text('kind').notNull(),title:text('title').notNull(),entryKind:text('entry_kind').notNull(),date:text('date'),summary:text('summary').notNull(),recipients:text('recipients').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('entry_changes_thread_time').on(t.threadId,t.createdAt)]);
export const inboxStates=sqliteTable('inbox_states',{
 profileId:text('profile_id').notNull(),threadId:text('thread_id').notNull(),readAt:text('read_at').notNull(),readId:text('read_id').notNull(),
},t=>[primaryKey({columns:[t.profileId,t.threadId]})]);

-- FamilyFlow (Done) – Postgres-Schema für Supabase.
-- Abgeleitet aus den D1-Migrationen in drizzle/ (Endstand nach 0015); geprüft mit den Original-Tests auf PGlite (tests/pg-d1.mjs).
-- Alle Tabellen liegen im eigenen Schema "familyflow" (nicht über die REST-API freigegeben).
-- Textspalten nutzen COLLATE "C", damit Vergleiche/Sortierung wie in SQLite bytegenau sind.

create schema if not exists familyflow;
revoke all on schema familyflow from anon, authenticated;

create table if not exists familyflow."calendar_items" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"kind" text collate "C" NOT NULL,
	"title" text collate "C" NOT NULL,
	"date" text collate "C" NOT NULL,
	"time" text collate "C",
	"note" text collate "C",
	"person" text collate "C",
	"assignee" text collate "C",
	"completed" integer DEFAULT 0 NOT NULL,
	"updated_at" text collate "C" DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
, "revision" integer DEFAULT 1 NOT NULL, "end_date" text collate "C", "event_type" text collate "C");
create table if not exists familyflow."push_subscriptions" (
	"endpoint" text collate "C" PRIMARY KEY NOT NULL,
	"person" text collate "C" NOT NULL,
	"p256dh" text collate "C" NOT NULL,
	"auth" text collate "C" NOT NULL,
	"reminder_token" text collate "C" NOT NULL,
	"last_daily_sent" text collate "C",
	"created_at" text collate "C" DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text collate "C" DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
, "device_id" text collate "C");
create table if not exists familyflow."waste_pickup_status" (
	"pickup_id" text collate "C" PRIMARY KEY NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"completed_by" text collate "C",
	"updated_at" text collate "C" DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
create table if not exists familyflow."todo_items" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"kind" text collate "C" NOT NULL,
	"title" text collate "C" NOT NULL,
	"note" text collate "C",
	"created_by" text collate "C" NOT NULL,
	"created_at" text collate "C" DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
, "date" text collate "C");
create table if not exists familyflow."shopping_items" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"label" text collate "C" NOT NULL,
	"product_key" text collate "C" NOT NULL,
	"added_by" text collate "C" NOT NULL,
	"created_at" text collate "C" DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
create table if not exists familyflow."planner_events" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"group_id" text collate "C" NOT NULL,
	"title" text collate "C" NOT NULL,
	"date" text collate "C" NOT NULL,
	"end_date" text collate "C",
	"time" text collate "C",
	"note" text collate "C",
	"person" text collate "C" NOT NULL,
	"event_type" text collate "C" DEFAULT 'private' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL
, "waste_kind" text collate "C", "source_key" text collate "C", "completed" integer DEFAULT 0 NOT NULL);
create table if not exists familyflow."planner_groups" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"name" text collate "C" NOT NULL,
	"category" text collate "C" NOT NULL,
	"color" text collate "C" NOT NULL,
	"invite_code" text collate "C" NOT NULL,
	"created_by" text collate "C" NOT NULL
);
create table if not exists familyflow."planner_members" (
	"group_id" text collate "C" NOT NULL,
	"profile_id" text collate "C" NOT NULL,
	PRIMARY KEY("group_id", "profile_id")
);
create table if not exists familyflow."planner_profiles" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"name" text collate "C" NOT NULL,
	"color" text collate "C" NOT NULL,
	"access_key" text collate "C" NOT NULL
);
create table if not exists familyflow."entry_attachments" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"thread_id" text collate "C" NOT NULL,
	"author_id" text collate "C" NOT NULL,
	"object_key" text collate "C" NOT NULL,
	"name" text collate "C" NOT NULL,
	"mime" text collate "C" NOT NULL,
	"size" integer NOT NULL,
	"duration" integer,
	"created_at" text collate "C" NOT NULL
);
create table if not exists familyflow."entry_guests" (
	"token" text collate "C" NOT NULL,
	"profile_id" text collate "C" NOT NULL,
	"group_id" text collate "C",
	"created_at" text collate "C" NOT NULL, "calendar_date" text collate "C",
	PRIMARY KEY("token", "profile_id")
);
create table if not exists familyflow."entry_messages" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"thread_id" text collate "C" NOT NULL,
	"author_id" text collate "C" NOT NULL,
	"body" text collate "C" DEFAULT '' NOT NULL,
	"attachment_id" text collate "C",
	"created_at" text collate "C" NOT NULL
);
create table if not exists familyflow."entry_reminders" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"thread_id" text collate "C" NOT NULL,
	"profile_id" text collate "C" NOT NULL,
	"remind_at" text collate "C" NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL
);
create table if not exists familyflow."entry_shares" (
	"token" text collate "C" PRIMARY KEY NOT NULL,
	"thread_id" text collate "C" NOT NULL,
	"created_by" text collate "C" NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" text collate "C" NOT NULL
);
create table if not exists familyflow."entry_threads" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"source_kind" text collate "C" NOT NULL,
	"source_id" text collate "C" NOT NULL,
	"created_by" text collate "C" NOT NULL,
	"created_at" text collate "C" NOT NULL
);
create table if not exists familyflow."entry_changes" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"thread_id" text collate "C" NOT NULL,
	"group_id" text collate "C" NOT NULL,
	"actor_id" text collate "C" NOT NULL,
	"kind" text collate "C" NOT NULL,
	"title" text collate "C" NOT NULL,
	"entry_kind" text collate "C" NOT NULL,
	"date" text collate "C",
	"summary" text collate "C" NOT NULL,
	"recipients" text collate "C" NOT NULL,
	"created_at" text collate "C" NOT NULL
);
create table if not exists familyflow."inbox_states" (
	"profile_id" text collate "C" NOT NULL,
	"thread_id" text collate "C" NOT NULL,
	"read_at" text collate "C" NOT NULL,
	"read_id" text collate "C" NOT NULL,
	PRIMARY KEY("profile_id", "thread_id")
);
create unique index if not exists "push_subscriptions_reminder_token_unique" on familyflow."push_subscriptions" ("reminder_token");
create index if not exists "idx_calendar_items_date" on familyflow."calendar_items" ("date");
create index if not exists "idx_push_subscriptions_person" on familyflow."push_subscriptions" ("person");
create index if not exists "idx_todo_items_created_at" on familyflow."todo_items" ("created_at");
create index if not exists "idx_shopping_items_created_at" on familyflow."shopping_items" ("created_at");
create index if not exists "planner_events_group_date" on familyflow."planner_events" ("group_id","date");
create unique index if not exists "planner_groups_invite_code_unique" on familyflow."planner_groups" ("invite_code");
create unique index if not exists "planner_profiles_access_key_unique" on familyflow."planner_profiles" ("access_key");
create unique index if not exists "planner_events_source_key_unique" on familyflow."planner_events" ("source_key");
create index if not exists "entry_attachments_thread" on familyflow."entry_attachments" ("thread_id");
create index if not exists "entry_messages_thread_time" on familyflow."entry_messages" ("thread_id","created_at");
create index if not exists "entry_reminders_profile_time" on familyflow."entry_reminders" ("profile_id","remind_at");
create index if not exists "entry_shares_thread" on familyflow."entry_shares" ("thread_id");
create unique index if not exists "entry_threads_source" on familyflow."entry_threads" ("source_kind","source_id");
create index if not exists "entry_changes_thread_time" on familyflow."entry_changes" ("thread_id","created_at");

-- Migration 20261030_mehrfach_untergruppen (auch einzeln unter supabase/migrations/)
alter table familyflow."planner_events" add column if not exists "audience" text collate "C";
alter table familyflow."calendar_items" add column if not exists "audience" text collate "C";
alter table familyflow."todo_items" add column if not exists "audience" text collate "C";
create table if not exists familyflow."planner_subgroups" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"group_id" text collate "C" NOT NULL,
	"name" text collate "C" NOT NULL,
	"created_by" text collate "C" NOT NULL,
	"created_at" text collate "C" DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
create table if not exists familyflow."planner_subgroup_members" (
	"subgroup_id" text collate "C" NOT NULL,
	"profile_id" text collate "C" NOT NULL,
	PRIMARY KEY("subgroup_id", "profile_id")
);
create index if not exists "planner_subgroups_group" on familyflow."planner_subgroups" ("group_id");

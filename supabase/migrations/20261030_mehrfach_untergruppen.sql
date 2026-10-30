-- Mehrere Personen / Untergruppen pro Eintrag (30.10.2026).
-- audience: JSON-Array mit Profil-IDs (mind. 2). NULL = bisheriges Verhalten über person/assignee.
-- Bei gesetzter audience bleibt person/assignee = erste ausgewählte Person (kompatibel mit älteren Abfragen).
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

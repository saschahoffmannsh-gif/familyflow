-- Mitteilungen: neue Termine und Aufträge, die andere für eine Person eingetragen haben.
create table if not exists familyflow."planner_notices" (
	"id" text collate "C" PRIMARY KEY NOT NULL,
	"profile_id" text collate "C" NOT NULL,
	"actor_id" text collate "C" NOT NULL,
	"source_kind" text collate "C" NOT NULL,
	"source_id" text collate "C" NOT NULL,
	"group_id" text collate "C" NOT NULL,
	"title" text collate "C" NOT NULL,
	"entry_kind" text collate "C" NOT NULL,
	"date" text collate "C",
	"time" text collate "C",
	"created_at" text collate "C" NOT NULL
);
create index if not exists "planner_notices_profile" on familyflow."planner_notices" ("profile_id", "created_at");
create table if not exists familyflow."planner_notice_seen" (
	"profile_id" text collate "C" PRIMARY KEY NOT NULL,
	"seen_at" text collate "C" NOT NULL
);

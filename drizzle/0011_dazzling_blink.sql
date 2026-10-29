CREATE TABLE `planner_events` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`end_date` text,
	`time` text,
	`note` text,
	`person` text NOT NULL,
	`event_type` text DEFAULT 'private' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planner_events_group_date` ON `planner_events` (`group_id`,`date`);--> statement-breakpoint
CREATE TABLE `planner_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`color` text NOT NULL,
	`invite_code` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planner_groups_invite_code_unique` ON `planner_groups` (`invite_code`);--> statement-breakpoint
CREATE TABLE `planner_members` (
	`group_id` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `profile_id`)
);
--> statement-breakpoint
CREATE TABLE `planner_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`access_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planner_profiles_access_key_unique` ON `planner_profiles` (`access_key`);
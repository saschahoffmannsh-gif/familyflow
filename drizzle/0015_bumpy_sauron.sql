CREATE TABLE `entry_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`group_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`entry_kind` text NOT NULL,
	`date` text,
	`summary` text NOT NULL,
	`recipients` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_changes_thread_time` ON `entry_changes` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inbox_states` (
	`profile_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`read_at` text NOT NULL,
	`read_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `thread_id`)
);

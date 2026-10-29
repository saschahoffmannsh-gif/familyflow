CREATE TABLE `entry_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_id` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`duration` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_attachments_thread` ON `entry_attachments` (`thread_id`);--> statement-breakpoint
CREATE TABLE `entry_guests` (
	`token` text NOT NULL,
	`profile_id` text NOT NULL,
	`group_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`token`, `profile_id`)
);
--> statement-breakpoint
CREATE TABLE `entry_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`attachment_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_messages_thread_time` ON `entry_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `entry_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`remind_at` text NOT NULL,
	`delivered` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_reminders_profile_time` ON `entry_reminders` (`profile_id`,`remind_at`);--> statement-breakpoint
CREATE TABLE `entry_shares` (
	`token` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`created_by` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_shares_thread` ON `entry_shares` (`thread_id`);--> statement-breakpoint
CREATE TABLE `entry_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_threads_source` ON `entry_threads` (`source_kind`,`source_id`);
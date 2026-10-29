ALTER TABLE `planner_events` ADD `waste_kind` text;--> statement-breakpoint
ALTER TABLE `planner_events` ADD `source_key` text;--> statement-breakpoint
ALTER TABLE `planner_events` ADD `completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `planner_events_source_key_unique` ON `planner_events` (`source_key`);
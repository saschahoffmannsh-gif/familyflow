ALTER TABLE `calendar_items` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_calendar_items_date` ON `calendar_items` (`date`);--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `device_id` text;--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_person` ON `push_subscriptions` (`person`);
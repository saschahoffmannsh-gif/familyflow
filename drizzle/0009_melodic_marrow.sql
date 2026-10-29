CREATE TABLE `todo_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_todo_items_created_at` ON `todo_items` (`created_at`);
--> statement-breakpoint
PRAGMA optimize;

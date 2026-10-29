CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`product_key` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_shopping_items_created_at` ON `shopping_items` (`created_at`);
--> statement-breakpoint
PRAGMA optimize;

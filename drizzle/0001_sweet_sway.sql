CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`person` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`reminder_token` text NOT NULL,
	`last_daily_sent` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_reminder_token_unique` ON `push_subscriptions` (`reminder_token`);
CREATE TABLE `waste_pickup_status` (
	`pickup_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`completed_by` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

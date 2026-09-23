CREATE TABLE `branch_settings` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`reservations_enabled` integer DEFAULT true NOT NULL,
	`auto_confirm` integer DEFAULT true NOT NULL,
	`reservation_duration` integer DEFAULT 90 NOT NULL,
	`max_party_size` integer DEFAULT 8 NOT NULL,
	`customer_notice` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);

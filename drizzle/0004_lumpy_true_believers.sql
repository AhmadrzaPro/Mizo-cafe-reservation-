CREATE TABLE `waitlist_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`mobile` text DEFAULT '' NOT NULL,
	`party_size` integer NOT NULL,
	`quoted_minutes` integer DEFAULT 20 NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_waitlist_branch_status_created` ON `waitlist_entries` (`branch_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `cafe_tables` ADD `operational_status` text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `internal_notes` text DEFAULT '' NOT NULL;
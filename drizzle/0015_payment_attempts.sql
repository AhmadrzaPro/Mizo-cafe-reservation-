CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`provider` text NOT NULL,
	`authority` text NOT NULL,
	`amount_rials` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reference` text,
	`card_pan` text,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_attempts_provider_authority` ON `payment_attempts` (`provider`,`authority`);--> statement-breakpoint
CREATE INDEX `idx_payment_attempts_reservation` ON `payment_attempts` (`reservation_id`);

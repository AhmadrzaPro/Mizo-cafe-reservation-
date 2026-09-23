CREATE TABLE `loyalty_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`cafe_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`branch_id` text,
	`reservation_id` text,
	`type` text NOT NULL,
	`points` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_transactions_reservation` ON `loyalty_transactions` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `idx_loyalty_transactions_cafe_created` ON `loyalty_transactions` (`cafe_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_loyalty_transactions_customer_created` ON `loyalty_transactions` (`customer_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `customers` ADD `points` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `completed_visits` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
PRAGMA optimize;

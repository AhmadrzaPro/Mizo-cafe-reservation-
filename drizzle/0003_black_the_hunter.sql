CREATE TABLE `closures` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_closures_branch_dates` ON `closures` (`branch_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`cafe_id` text NOT NULL,
	`mobile` text NOT NULL,
	`name` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customers_cafe_mobile` ON `customers` (`cafe_id`,`mobile`);--> statement-breakpoint
CREATE TABLE `operating_hours` (
	`branch_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`open_time` text DEFAULT '10:00' NOT NULL,
	`close_time` text DEFAULT '23:00' NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`branch_id`, `weekday`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reservation_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`table_id` text NOT NULL,
	`lock_start` text NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`table_id`) REFERENCES `cafe_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reservation_locks_reservation_id` ON `reservation_locks` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `idx_reservation_locks_table_id` ON `reservation_locks` (`table_id`);--> statement-breakpoint
CREATE TABLE `reservation_tables` (
	`reservation_id` text NOT NULL,
	`table_id` text NOT NULL,
	PRIMARY KEY(`reservation_id`, `table_id`),
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`table_id`) REFERENCES `cafe_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reservation_tables_table_id` ON `reservation_tables` (`table_id`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`customer_id` text,
	`tracking_code` text NOT NULL,
	`customer_name` text NOT NULL,
	`mobile` text NOT NULL,
	`party_size` integer NOT NULL,
	`reserved_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`buffer_minutes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reservations_tracking_code` ON `reservations` (`tracking_code`);--> statement-breakpoint
CREATE INDEX `idx_reservations_branch_reserved_at` ON `reservations` (`branch_id`,`reserved_at`);--> statement-breakpoint
CREATE INDEX `idx_reservations_mobile` ON `reservations` (`mobile`);--> statement-breakpoint
CREATE TABLE `table_connections` (
	`table_a_id` text NOT NULL,
	`table_b_id` text NOT NULL,
	PRIMARY KEY(`table_a_id`, `table_b_id`),
	FOREIGN KEY (`table_a_id`) REFERENCES `cafe_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`table_b_id`) REFERENCES `cafe_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `buffer_minutes` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `slot_interval` integer DEFAULT 30 NOT NULL;
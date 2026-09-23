CREATE TABLE `payment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`type` text DEFAULT 'payment' NOT NULL,
	`amount_rials` integer NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`provider` text DEFAULT 'demo' NOT NULL,
	`reference` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_payment_transactions_branch_created` ON `payment_transactions` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_transactions_reservation` ON `payment_transactions` (`reservation_id`);--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `deposit_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `deposit_mode` text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `deposit_amount_rials` integer DEFAULT 2000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `deposit_peak_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `deposit_peak_start` text DEFAULT '18:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `deposit_peak_end` text DEFAULT '22:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `payment_deadline_minutes` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `refund_policy` text DEFAULT 'تا ۲ ساعت قبل از زمان رزرو، بیعانه کامل بازگردانده می‌شود.' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `deposit_amount_rials` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_status` text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_due_at` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `paid_at` text;
--> statement-breakpoint
PRAGMA optimize;

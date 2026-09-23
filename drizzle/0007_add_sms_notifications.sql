CREATE TABLE `sms_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`reservation_id` text,
	`kind` text NOT NULL,
	`mobile` text NOT NULL,
	`customer_name` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scheduled_at` text NOT NULL,
	`sent_at` text,
	`provider` text DEFAULT 'demo' NOT NULL,
	`provider_message_id` text,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sms_branch_created` ON `sms_messages` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sms_status_scheduled` ON `sms_messages` (`status`,`scheduled_at`);--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `sms_confirmation_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `sms_reminder_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `sms_reminder_minutes` integer DEFAULT 120 NOT NULL;
--> statement-breakpoint
PRAGMA optimize;

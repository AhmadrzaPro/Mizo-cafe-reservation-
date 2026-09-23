CREATE TABLE `saas_admins` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saas_subscriptions` (
	`cafe_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`status` text DEFAULT 'inactive' NOT NULL,
	`monthly_price_rials` integer DEFAULT 0 NOT NULL,
	`trial_ends_at` text,
	`current_period_ends_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_saas_subscriptions_status` ON `saas_subscriptions` (`status`);--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` text PRIMARY KEY NOT NULL,
	`cafe_id` text NOT NULL,
	`type` text NOT NULL,
	`from_plan` text,
	`to_plan` text,
	`amount_rials` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_subscription_events_cafe_created` ON `subscription_events` (`cafe_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;

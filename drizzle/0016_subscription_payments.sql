CREATE TABLE `subscription_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`cafe_id` text NOT NULL,
	`amount_rials` integer NOT NULL,
	`months` integer DEFAULT 1 NOT NULL,
	`method` text DEFAULT 'card' NOT NULL,
	`reference` text NOT NULL,
	`card_last4` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`created_at` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_subscription_payments_status` ON `subscription_payments` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_subscription_payments_cafe` ON `subscription_payments` (`cafe_id`,`created_at`);

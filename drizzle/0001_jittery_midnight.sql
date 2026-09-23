CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_admin_users_email` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `cafe_memberships` (
	`cafe_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'manager' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`cafe_id`, `user_id`),
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cafe_memberships_user_id` ON `cafe_memberships` (`user_id`);
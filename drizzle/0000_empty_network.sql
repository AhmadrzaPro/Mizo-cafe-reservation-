CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_areas_branch_id` ON `areas` (`branch_id`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`cafe_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`city` text DEFAULT 'تهران' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_branches_cafe_slug` ON `branches` (`cafe_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_branches_cafe_id` ON `branches` (`cafe_id`);--> statement-breakpoint
CREATE TABLE `cafe_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text NOT NULL,
	`name` text NOT NULL,
	`shape` text DEFAULT 'round' NOT NULL,
	`capacity` integer DEFAULT 2 NOT NULL,
	`position_x` real DEFAULT 0 NOT NULL,
	`position_y` real DEFAULT 0 NOT NULL,
	`reservable` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cafe_tables_area_id` ON `cafe_tables` (`area_id`);--> statement-breakpoint
CREATE TABLE `cafes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cafes_slug` ON `cafes` (`slug`);
ALTER TABLE `areas` ADD `kind` text DEFAULT 'indoor' NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `space_mode` text DEFAULT 'indoor' NOT NULL;
--> statement-breakpoint
PRAGMA optimize;

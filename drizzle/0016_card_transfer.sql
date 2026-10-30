ALTER TABLE `branch_settings` ADD `card_transfer_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `card_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_settings` ADD `card_holder` text DEFAULT '' NOT NULL;

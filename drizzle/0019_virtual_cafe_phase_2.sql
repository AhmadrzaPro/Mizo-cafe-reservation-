-- Virtual Cafe, phase 2. Three independent additions; nothing existing changes.

-- 1. Table holds. While a customer fills in the booking form, the chosen table is held for a few
-- minutes, so nobody else can take it in between. Holds are created only by a conditional insert
-- that checks for overlapping holds and reservations in the same statement; expired holds are
-- ignored everywhere and deleted by the background job. Times: starts_at/ends_at are Tehran wall
-- clock (YYYY-MM-DDTHH:MM, like reservations.reserved_at), expires_at and created_at ISO UTC.
CREATE TABLE `table_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`table_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`token_hash` text NOT NULL,
	`client_key` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`table_id`) REFERENCES `cafe_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_table_holds_token_hash` ON `table_holds` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_table_holds_table_expires` ON `table_holds` (`table_id`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_table_holds_client` ON `table_holds` (`client_key`,`branch_id`,`expires_at`);
--> statement-breakpoint
-- A reservation may not take a table someone else holds. The holder's own booking deletes its hold
-- earlier in the same transaction, so it passes.
CREATE TRIGGER reservation_table_held BEFORE INSERT ON reservation_tables
BEGIN
  SELECT RAISE(ABORT,'table_held') WHERE EXISTS (
    SELECT 1 FROM table_holds h JOIN reservations n ON n.id=NEW.reservation_id
    WHERE h.table_id=NEW.table_id
      AND h.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND n.status NOT IN ('cancelled','completed','no_show')
      AND datetime(n.reserved_at)<datetime(h.ends_at)
      AND datetime(h.starts_at)<datetime(n.reserved_at,'+'||(n.duration_minutes+n.buffer_minutes)||' minutes')
  );
END;
--> statement-breakpoint
-- 2. The branch owner's own switch for the Virtual Cafe. It only applies where the platform offers
-- the Virtual Cafe (VIRTUAL_CAFE); on by default so cafés already offered it keep it.
ALTER TABLE `branch_settings` ADD `virtual_cafe_enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
-- 3. Where a room's door, window and counter are, as JSON: {"door":"bottom","window":"right",
-- "counter":"left"}. NULL keeps the layout the 2D map has always drawn.
ALTER TABLE `areas` ADD `layout` text;

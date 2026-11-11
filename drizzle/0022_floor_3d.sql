-- The 3D floor: each table's turn on the floor (degrees) and the features the owner gave it, as a
-- JSON array. A branch's room and decor live in its single area's layout column (version 2);
-- older 2D maps keep working and become one room the first time the owner saves the 3D floor.
ALTER TABLE `cafe_tables` ADD `rotation` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `cafe_tables` ADD `tags` text DEFAULT '[]' NOT NULL;

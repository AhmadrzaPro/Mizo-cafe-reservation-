-- Readable booking links: /<café link>/<branch link>. A café's and a branch's link names are
-- optional and chosen by the owner; NULL means the link uses the internal slug. Unique per café
-- (cafes) and per café (branches); SQLite lets several rows share NULL.
ALTER TABLE `cafes` ADD `link_slug` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cafes_link_slug` ON `cafes` (`link_slug`);
--> statement-breakpoint
ALTER TABLE `branches` ADD `link_slug` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_branches_cafe_link_slug` ON `branches` (`cafe_id`,`link_slug`);

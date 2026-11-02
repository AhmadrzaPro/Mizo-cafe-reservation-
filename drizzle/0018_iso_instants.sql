-- Every instant is now stored as ISO-8601 UTC text (2026-10-31T20:15:00.000Z), like the rest of
-- the schema. OTP challenges and staff sessions held epoch milliseconds; they are rebuilt with
-- text columns and their values converted. Live sessions and pending codes keep working.
CREATE TABLE `otp_challenges_new` (
	`id` text PRIMARY KEY NOT NULL,
	`cafe_id` text,
	`mobile` text NOT NULL,
	`salt` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cafe_id`) REFERENCES `cafes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `otp_challenges_new` (`id`,`cafe_id`,`mobile`,`salt`,`code_hash`,`expires_at`,`attempts`,`consumed_at`,`created_at`)
SELECT `id`,`cafe_id`,`mobile`,`salt`,`code_hash`,
	strftime('%Y-%m-%dT%H:%M:%fZ', `expires_at`/1000.0, 'unixepoch'),
	`attempts`,
	CASE WHEN `consumed_at` IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', `consumed_at`/1000.0, 'unixepoch') END,
	strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`/1000.0, 'unixepoch')
FROM `otp_challenges`;
--> statement-breakpoint
DROP TABLE `otp_challenges`;
--> statement-breakpoint
ALTER TABLE `otp_challenges_new` RENAME TO `otp_challenges`;
--> statement-breakpoint
CREATE INDEX `idx_otp_mobile_created` ON `otp_challenges` (`mobile`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_otp_cafe_mobile_created` ON `otp_challenges` (`cafe_id`,`mobile`,`created_at`);
--> statement-breakpoint
CREATE TABLE `staff_sessions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `staff_sessions_new` (`id`,`staff_id`,`token_hash`,`expires_at`,`created_at`,`last_seen_at`)
SELECT `id`,`staff_id`,`token_hash`,
	strftime('%Y-%m-%dT%H:%M:%fZ', `expires_at`/1000.0, 'unixepoch'),
	strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`/1000.0, 'unixepoch'),
	strftime('%Y-%m-%dT%H:%M:%fZ', `last_seen_at`/1000.0, 'unixepoch')
FROM `staff_sessions`;
--> statement-breakpoint
DROP TABLE `staff_sessions`;
--> statement-breakpoint
ALTER TABLE `staff_sessions_new` RENAME TO `staff_sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_staff_sessions_token_hash` ON `staff_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_staff_sessions_staff_id` ON `staff_sessions` (`staff_id`);
--> statement-breakpoint
-- Reminder times were Tehran wall-clock text (2026-10-31T19:30); they become the UTC instant.
-- Iran has had no daylight saving time since 2022, so Tehran is UTC+03:30.
UPDATE `sms_messages` SET `scheduled_at`=strftime('%Y-%m-%dT%H:%M:%fZ', `scheduled_at`, '-210 minutes')
WHERE length(`scheduled_at`)=16;

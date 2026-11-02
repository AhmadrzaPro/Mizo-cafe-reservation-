-- The subscription becomes required. Cafés without one, or with it switched off by their owner,
-- start a 14-day trial from this migration. Cafés already in a trial or a paid period keep it.
INSERT INTO `subscription_events` (`id`,`cafe_id`,`type`,`from_plan`,`to_plan`,`amount_rials`,`note`,`created_at`)
SELECT 'subevent:'||lower(hex(randomblob(16))), c.`id`, 'activated', NULL, 'standard', 0, 'اشتراک الزامی شد؛ شروع دوره آزمایشی ۱۴ روزه', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `cafes` c LEFT JOIN `saas_subscriptions` s ON s.`cafe_id`=c.`id`
WHERE s.`cafe_id` IS NULL OR s.`enabled`=0;
--> statement-breakpoint
UPDATE `saas_subscriptions` SET `enabled`=1, `status`='trial', `trial_ends_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now','+14 days'), `updated_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `enabled`=0;
--> statement-breakpoint
INSERT INTO `saas_subscriptions` (`cafe_id`,`enabled`,`plan`,`status`,`monthly_price_rials`,`trial_ends_at`,`current_period_ends_at`,`created_at`,`updated_at`)
SELECT `id`, 1, 'standard', 'trial', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','+14 days'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `cafes` WHERE `id` NOT IN (SELECT `cafe_id` FROM `saas_subscriptions`);

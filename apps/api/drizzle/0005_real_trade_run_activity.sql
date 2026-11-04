ALTER TABLE `real_trade_import_runs` ADD `last_activity_at_utc` text;
--> statement-breakpoint
ALTER TABLE `real_trade_import_runs` ADD `owner_pid` integer;

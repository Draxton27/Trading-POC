CREATE TABLE `real_trade_executions` (`id` text PRIMARY KEY NOT NULL,`environment` text NOT NULL,`account_alias` text NOT NULL,`execution_id` text NOT NULL,`latest_version_id` text,`quality` text NOT NULL,`conflict` integer NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE UNIQUE INDEX `real_trade_identity` ON `real_trade_executions` (`environment`,`account_alias`,`execution_id`);
--> statement-breakpoint
CREATE TABLE `real_trade_versions` (`id` text PRIMARY KEY NOT NULL,`execution_id` text NOT NULL,`revision` integer NOT NULL,`content_hash` text NOT NULL,`normalized` text NOT NULL,`source` text NOT NULL,`source_record_id` text NOT NULL,`imported_at_utc` text NOT NULL,`kind` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `real_trade_revision` ON `real_trade_versions` (`execution_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `real_trade_version_lookup` ON `real_trade_versions` (`execution_id`,`content_hash`);
--> statement-breakpoint
CREATE TABLE `real_trade_provenance` (`id` text PRIMARY KEY NOT NULL,`version_id` text NOT NULL,`source` text NOT NULL,`source_record_id` text NOT NULL,`first_seen_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `real_trade_provenance_identity` ON `real_trade_provenance` (`version_id`,`source`,`source_record_id`);
--> statement-breakpoint
CREATE TABLE `real_trade_rejections` (`id` text PRIMARY KEY NOT NULL,`source` text NOT NULL,`source_record_hash` text NOT NULL,`reason` text NOT NULL,`first_seen_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `real_trade_import_runs` (`id` text PRIMARY KEY NOT NULL,`source` text NOT NULL,`started_at_utc` text NOT NULL,`finished_at_utc` text,`status` text NOT NULL,`received` integer NOT NULL,`inserted` integer NOT NULL,`unchanged` integer NOT NULL,`revised` integer NOT NULL,`conflicts` integer NOT NULL,`rejected` integer NOT NULL,`error_code` text,`coverage` text NOT NULL,`min_executed_at_utc` text,`max_executed_at_utc` text);

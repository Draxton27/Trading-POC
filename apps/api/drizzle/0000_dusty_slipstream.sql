CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`environment` text NOT NULL,
	`opened_at_utc` text NOT NULL,
	`closed_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `broker_connection_events` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`at_utc` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `broker_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`account_alias` text NOT NULL,
	`execution_id` text NOT NULL,
	`con_id` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `broker_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`account_alias` text NOT NULL,
	`con_id` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chart_drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`kind` text NOT NULL,
	`price` real NOT NULL,
	`price2` real,
	`created_at_utc` text NOT NULL,
	`author` text NOT NULL,
	`edited_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`feed` text,
	`sha256` text,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`started_at_utc` text NOT NULL,
	`finished_at_utc` text,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journal_references` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`ledger_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_bars` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`start_utc` text NOT NULL,
	`end_utc` text NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real,
	`source_id` text
);
--> statement-breakpoint
CREATE TABLE `market_events` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`published_at_utc` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`received_at_utc` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `option_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`con_id` integer NOT NULL,
	`occ_symbol` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `option_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`con_id` integer NOT NULL,
	`received_at_utc` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signal_references` (
	`id` text PRIMARY KEY NOT NULL,
	`source_path` text NOT NULL,
	`source_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_session_id` text NOT NULL,
	`kind` text NOT NULL,
	`at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_commissions` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`amount` real
);
--> statement-breakpoint
CREATE TABLE `trade_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`execution_id` text NOT NULL,
	`quantity` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`buy_lot_id` text NOT NULL,
	`sell_execution_id` text NOT NULL,
	`quantity` real NOT NULL
);

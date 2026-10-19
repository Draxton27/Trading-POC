CREATE TABLE IF NOT EXISTS `academy_documents` (
  `sha256` text PRIMARY KEY NOT NULL,
  `source_file` text NOT NULL,
  `format` text NOT NULL,
  `file_name_date` text,
  `imported_at_utc` text NOT NULL,
  `record_count` integer NOT NULL,
  `notes` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `academy_ask_ranges` (
  `id` text PRIMARY KEY NOT NULL,
  `asset` text NOT NULL,
  `option_right` text,
  `min_ask_cents` integer NOT NULL,
  `max_ask_cents` integer NOT NULL,
  `currency` text NOT NULL,
  `unit` text NOT NULL,
  `reference_date` text,
  `valid_from` text,
  `valid_to` text,
  `document_hash` text NOT NULL,
  `source_file` text NOT NULL,
  `source_location` text NOT NULL,
  `version_id` text NOT NULL,
  `extraction_method` text NOT NULL,
  `validation_status` text NOT NULL,
  `notes` text,
  `imported_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `academy_range_identity` ON `academy_ask_ranges` (`document_hash`,`source_location`,`asset`,`option_right`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `academy_range_lookup` ON `academy_ask_ranges` (`asset`,`reference_date`);

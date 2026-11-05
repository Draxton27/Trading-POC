CREATE TABLE `real_flex_documents` (`sha256` text PRIMARY KEY NOT NULL, `imported_at_utc` text NOT NULL, `account_hash` text NOT NULL, `record_count` integer NOT NULL, `provenance` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `real_flex_records` (`id` text PRIMARY KEY NOT NULL, `document_sha256` text NOT NULL REFERENCES `real_flex_documents`(`sha256`), `execution_id` text NOT NULL, `content_hash` text NOT NULL, `payload` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `real_flex_execution` ON `real_flex_records` (`execution_id`);
--> statement-breakpoint
CREATE TABLE `real_reconstruction_snapshots` (`sha256` text PRIMARY KEY NOT NULL, `created_at_utc` text NOT NULL, `algorithm` text NOT NULL, `input_hash` text NOT NULL, `payload` text NOT NULL);

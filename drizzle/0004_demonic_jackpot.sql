CREATE TABLE `live_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`kind` text NOT NULL,
	`symbol` text,
	`value` real,
	`previous_value` real,
	`source` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_activity_time_idx` ON `live_activity` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `live_quotes` (
	`symbol` text PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`previous_close` real,
	`currency` text NOT NULL,
	`quoted_at` text NOT NULL,
	`received_at` text NOT NULL,
	`source` text NOT NULL,
	`entitlement` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portfolio_sessions` (
	`date` text PRIMARY KEY NOT NULL,
	`opening_nav` real NOT NULL,
	`current` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`events` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sealed_at` text,
	`snapshot_date` text NOT NULL,
	`coverage` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_locks` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `valuation_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`session_date` text NOT NULL,
	`time` text NOT NULL,
	`value` real NOT NULL,
	`snapshot_date` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `valuation_samples_session_time_idx` ON `valuation_samples` (`session_date`,`time`);

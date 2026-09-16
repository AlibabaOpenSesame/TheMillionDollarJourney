CREATE TABLE `fx_rates` (
	`pair` text PRIMARY KEY NOT NULL,
	`rate` real NOT NULL,
	`quoted_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`source` text NOT NULL
);

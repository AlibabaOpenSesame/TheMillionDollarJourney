CREATE TABLE IF NOT EXISTS `trades` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`trade_date` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text,
	`quantity` real,
	`price` real,
	`commission` real,
	`currency` text DEFAULT 'USD',
	`trade_time` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_trades_date` ON `trades` (`trade_date`);

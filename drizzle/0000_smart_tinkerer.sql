CREATE TABLE `portfolio_positions` (
	`as_of` text NOT NULL,
	`contract_key` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`asset_class` text DEFAULT 'STK' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`average_price` real DEFAULT 0 NOT NULL,
	`market_value` real DEFAULT 0 NOT NULL,
	`daily_pnl` real DEFAULT 0 NOT NULL,
	`unrealized_pnl` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`as_of`, `contract_key`),
	FOREIGN KEY (`as_of`) REFERENCES `portfolio_snapshots`(`as_of`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portfolio_positions_as_of_idx` ON `portfolio_positions` (`as_of`);--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`as_of` text PRIMARY KEY NOT NULL,
	`synced_at` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`net_liquidation` real NOT NULL,
	`previous_nav` real DEFAULT 0 NOT NULL,
	`total_cash` real DEFAULT 0 NOT NULL,
	`available_funds` real DEFAULT 0 NOT NULL,
	`buying_power` real DEFAULT 0 NOT NULL,
	`gross_position_value` real DEFAULT 0 NOT NULL,
	`daily_pnl` real DEFAULT 0 NOT NULL,
	`daily_return` real DEFAULT 0 NOT NULL,
	`week_return` real DEFAULT 0 NOT NULL,
	`ytd_return` real DEFAULT 0 NOT NULL,
	`unrealized_pnl` real DEFAULT 0 NOT NULL,
	`leverage` real DEFAULT 0 NOT NULL,
	`realized_ytd` real DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'IBKR Flex Web Service' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`as_of` text,
	`error` text
);

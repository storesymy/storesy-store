CREATE TABLE `sales_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "sales_pages_data_json" CHECK(json_valid("sales_pages"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_pages_uuid_unique` ON `sales_pages` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_pages_slug_unique` ON `sales_pages` (`slug`);--> statement-breakpoint
CREATE INDEX `sales_pages_status_idx` ON `sales_pages` (`status`);
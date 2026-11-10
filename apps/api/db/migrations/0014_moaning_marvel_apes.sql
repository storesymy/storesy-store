CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`sales_page_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "orders_data_json" CHECK(json_valid("orders"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_uuid_unique` ON `orders` (`uuid`);--> statement-breakpoint
CREATE INDEX `orders_page_idx` ON `orders` (`sales_page_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);
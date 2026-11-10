CREATE TABLE `integrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "integrations_data_json" CHECK(json_valid("integrations"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_uuid_unique` ON `integrations` (`uuid`);--> statement-breakpoint
CREATE INDEX `integrations_provider_idx` ON `integrations` (`provider`);
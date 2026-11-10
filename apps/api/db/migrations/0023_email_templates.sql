-- Automated email templates: what the store sends on its own, editable from
-- /templates. Rows are seeded from the shared defaults on first read, so this
-- migration only creates the shape.
CREATE TABLE `email_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`template_key` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "email_templates_data_json" CHECK(json_valid(`data`))
);--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_uuid_unique` ON `email_templates` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_key_unique` ON `email_templates` (`template_key`);

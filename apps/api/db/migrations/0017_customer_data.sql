ALTER TABLE `customers` ADD `data` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `customers` SET `data` = json_object(
	'phone', `phone`,
	'address', `address`,
	'postcode', `postcode`,
	'city', `city`,
	'state', `state`
);--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `phone`;--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `address`;--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `postcode`;--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `city`;--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `state`;--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);

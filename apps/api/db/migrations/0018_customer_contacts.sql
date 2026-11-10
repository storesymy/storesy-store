ALTER TABLE `customers` ADD `badge` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `country_code` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `country_name` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `ltv_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `total_checkout` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `last_checkout_date` text;--> statement-breakpoint
CREATE TABLE `customer_contact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`customer_id` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`fingerprint` text NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_contact_uuid_unique` ON `customer_contact` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_contact_fingerprint_unique` ON `customer_contact` (`customer_id`,`fingerprint`) WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE INDEX `customer_contact_customer_idx` ON `customer_contact` (`customer_id`);--> statement-breakpoint
CREATE INDEX `customer_contact_name_idx` ON `customer_contact` (`name`);--> statement-breakpoint
CREATE INDEX `customer_contact_phone_idx` ON `customer_contact` (`phone`);--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_contact_id` integer;--> statement-breakpoint
CREATE INDEX `orders_contact_idx` ON `orders` (`customer_contact_id`);--> statement-breakpoint
INSERT INTO `customer_contact` (`uuid`, `customer_id`, `name`, `phone`, `data`, `fingerprint`)
SELECT
	'cdt_' || lower(hex(randomblob(16))),
	`id`,
	`name`,
	COALESCE(json_extract(`data`, '$.phone'), ''),
	json_object(
		'address', COALESCE(json_extract(`data`, '$.address'), ''),
		'postcode', COALESCE(json_extract(`data`, '$.postcode'), ''),
		'city', COALESCE(json_extract(`data`, '$.city'), ''),
		'state', COALESCE(json_extract(`data`, '$.state'), '')
	),
	'legacy'
FROM `customers`;--> statement-breakpoint
UPDATE `orders` SET `customer_contact_id` = (
	SELECT cc.`id` FROM `customer_contact` cc
	WHERE cc.`customer_id` = `orders`.`customer_id`
	LIMIT 1
);--> statement-breakpoint
UPDATE `customers` SET
	`total_checkout` = (
		SELECT COUNT(*) FROM `orders` o
		WHERE o.`customer_id` = `customers`.`id` AND o.`status` = 'paid'
			AND IFNULL(json_extract(o.`data`, '$.test'), 0) = 0
	),
	`ltv_cents` = (
		SELECT COALESCE(SUM(CAST(json_extract(o.`data`, '$.totalCents') AS INTEGER)), 0)
		FROM `orders` o
		WHERE o.`customer_id` = `customers`.`id` AND o.`status` = 'paid'
			AND IFNULL(json_extract(o.`data`, '$.test'), 0) = 0
	),
	`last_checkout_date` = (
		SELECT MAX(COALESCE(json_extract(o.`data`, '$.payment.paidAt'), json_extract(o.`data`, '$.updatedAt')))
		FROM `orders` o
		WHERE o.`customer_id` = `customers`.`id` AND o.`status` = 'paid'
			AND IFNULL(json_extract(o.`data`, '$.test'), 0) = 0
	);--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `data`;

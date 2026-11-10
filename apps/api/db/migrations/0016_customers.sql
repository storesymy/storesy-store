CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text,
	`postcode` text,
	`city` text,
	`state` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_uuid_unique` ON `customers` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` integer;--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
INSERT INTO `customers` (`uuid`, `email`, `name`, `phone`, `address`, `postcode`, `city`, `state`, `created_at`, `updated_at`)
SELECT
	'cus_' || lower(hex(randomblob(16))),
	lower(trim(json_extract(o.`data`, '$.customer.email'))),
	COALESCE(json_extract(o.`data`, '$.customer.name'), ''),
	COALESCE(json_extract(o.`data`, '$.customer.phone'), ''),
	json_extract(o.`data`, '$.customer.address'),
	json_extract(o.`data`, '$.customer.postcode'),
	json_extract(o.`data`, '$.customer.city'),
	json_extract(o.`data`, '$.customer.state'),
	COALESCE(json_extract(o.`data`, '$.createdAt'), strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')),
	COALESCE(json_extract(o.`data`, '$.updatedAt'), strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours'))
FROM `orders` o
WHERE
	json_extract(o.`data`, '$.customer.email') IS NOT NULL
	AND trim(json_extract(o.`data`, '$.customer.email')) <> ''
	AND o.`id` = (
		SELECT MAX(o2.`id`)
		FROM `orders` o2
		WHERE lower(trim(json_extract(o2.`data`, '$.customer.email'))) = lower(trim(json_extract(o.`data`, '$.customer.email')))
	);
--> statement-breakpoint
UPDATE `orders` SET `customer_id` = (
	SELECT c.`id` FROM `customers` c
	WHERE c.`email` = lower(trim(json_extract(`orders`.`data`, '$.customer.email')))
);
--> statement-breakpoint
UPDATE `orders` SET `data` = json_remove(`data`, '$.customer');

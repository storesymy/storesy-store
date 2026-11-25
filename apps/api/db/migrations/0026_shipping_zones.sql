-- One delivery rate per (zone, courier). Zone/courier are stable catalog keys;
-- display labels are derived in shared code, never stored, so copy changes
-- never need a data migration.
CREATE TABLE `shipping_zones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`zone_key` text NOT NULL,
	`courier_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "shipping_zones_data_json" CHECK(json_valid(`data`)),
	CONSTRAINT "shipping_zones_status" CHECK(`status` IN ('active', 'inactive')),
	CONSTRAINT "shipping_zones_price_amount" CHECK(
		json_extract(`data`, '$.priceType') IN ('flat', 'api', 'markup')
		AND (
			(json_extract(`data`, '$.priceType') = 'api'
				AND json_extract(`data`, '$.priceCents') IS NULL)
			OR
			(json_extract(`data`, '$.priceType') IN ('flat', 'markup')
				AND typeof(json_extract(`data`, '$.priceCents')) = 'integer'
				AND json_extract(`data`, '$.priceCents') >= 0)
		)
	)
);--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_zones_uuid_unique` ON `shipping_zones` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_zones_zone_courier_unique` ON `shipping_zones` (`zone_key`,`courier_key`);--> statement-breakpoint
CREATE INDEX `shipping_zones_status_idx` ON `shipping_zones` (`status`);

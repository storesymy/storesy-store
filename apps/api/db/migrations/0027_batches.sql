-- One AWB booking run. Membership lives on `orders.batch_id`; `data` is the
-- immutable snapshot the Batches table reads (date, count, couriers).
CREATE TABLE `batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "batches_data_json" CHECK(json_valid(`data`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_uuid_unique` ON `batches` (`uuid`);
--> statement-breakpoint
ALTER TABLE `orders` ADD `batch_id` integer;
--> statement-breakpoint
CREATE INDEX `orders_batch_idx` ON `orders` (`batch_id`);
--> statement-breakpoint
-- Backfill the batches that existed only as timestamps on booked orders.
INSERT INTO `batches` (`uuid`, `data`)
SELECT
	'bat-' || lower(hex(randomblob(16))),
	json_object(
		'createdAt', grouped.booked_at,
		'orderCount', grouped.order_count,
		'courierLabels', json(grouped.courier_labels)
	)
FROM (
	SELECT
		json_extract(`data`, '$.shipping.awbGeneratedAt') AS booked_at,
		count(*) AS order_count,
		json_group_array(
			DISTINCT CASE json_extract(`data`, '$.shipping.courierKey')
				WHEN 'jnt' THEN 'J&T'
				WHEN 'ninjavan' THEN 'Ninjavan'
				WHEN 'poslaju' THEN 'PosLaju'
				WHEN 'aramex' THEN 'Aramex'
				WHEN 'fedex' THEN 'Fedex'
				ELSE COALESCE(
					json_extract(`data`, '$.shipping.providerLabel'),
					json_extract(`data`, '$.shipping.courierKey'),
					'—'
				)
			END
		) AS courier_labels
	FROM `orders`
	WHERE json_extract(`data`, '$.shipping.trackingNo') IS NOT NULL
		AND json_extract(`data`, '$.shipping.awbGeneratedAt') IS NOT NULL
	GROUP BY booked_at
) AS grouped;
--> statement-breakpoint
UPDATE `orders` SET `batch_id` = (
	SELECT `batches`.`id`
	FROM `batches`
	WHERE json_extract(`batches`.`data`, '$.createdAt')
		= json_extract(`orders`.`data`, '$.shipping.awbGeneratedAt')
)
WHERE json_extract(`orders`.`data`, '$.shipping.trackingNo') IS NOT NULL
	AND json_extract(`orders`.`data`, '$.shipping.awbGeneratedAt') IS NOT NULL;

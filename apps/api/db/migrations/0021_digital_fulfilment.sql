-- Digital-only orders (nothing ships) are fulfilled on creation. Backfill the
-- ones already in the table: status fulfilled, timestamped at their checkout.
UPDATE `orders` SET `data` = json_set(
	`data`,
	'$.fulfilment.status', 'fulfilled',
	'$.fulfilment.fulfilledAt', COALESCE(
		json_extract(`data`, '$.fulfilment.fulfilledAt'),
		json_extract(`data`, '$.createdAt')
	)
)
WHERE json_extract(`data`, '$.shippingCents') = 0
	AND IFNULL(json_extract(`data`, '$.fulfilment.status'), 'unfulfilled') = 'unfulfilled';

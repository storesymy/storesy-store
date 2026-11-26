-- A tracking number means the shipment was fulfilled. Backfill orders that
-- were booked before AWB generation started writing the fulfilment status.
UPDATE `orders`
SET `data` = json_set(
	`data`,
	'$.fulfilment.status', 'fulfilled',
	'$.fulfilment.fulfilledAt', COALESCE(
		json_extract(`data`, '$.fulfilment.fulfilledAt'),
		json_extract(`data`, '$.shipping.awbGeneratedAt'),
		strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')
	),
	'$.updatedAt', COALESCE(
		json_extract(`data`, '$.updatedAt'),
		json_extract(`data`, '$.shipping.awbGeneratedAt'),
		strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')
	)
)
WHERE json_extract(`data`, '$.shipping.trackingNo') IS NOT NULL
	AND COALESCE(json_extract(`data`, '$.fulfilment.status'), 'unfulfilled') = 'unfulfilled';

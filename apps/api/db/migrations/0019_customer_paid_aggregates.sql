-- Recompute every customer's paid totals: the aggregate rule now counts every
-- paid order (admin test checkouts included), so historical rows created
-- under the previous "non-test only" definition are brought in line.
UPDATE `customers` SET
	`total_checkout` = (
		SELECT COUNT(*) FROM `orders` o
		WHERE o.`customer_id` = `customers`.`id` AND o.`status` = 'paid'
	),
	`ltv_cents` = (
		SELECT COALESCE(SUM(CAST(json_extract(o.`data`, '$.totalCents') AS INTEGER)), 0)
		FROM `orders` o
		WHERE o.`customer_id` = `customers`.`id` AND o.`status` = 'paid'
	),
	`last_checkout_date` = (
		SELECT MAX(COALESCE(json_extract(o.`data`, '$.payment.paidAt'), json_extract(o.`data`, '$.updatedAt')))
		FROM `orders` o
		WHERE o.`customer_id` = `customers`.`id` AND o.`status` = 'paid'
	);

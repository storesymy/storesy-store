-- Add the optional discount price to every product: JSON null until a sale is
-- set. Data-only migration (json_insert only fills an absent path, so
-- re-running it on a row that already has discountPrice is a no-op).
UPDATE `products` SET `data` = json_insert(`data`, '$.discountPrice', NULL);

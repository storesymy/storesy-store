-- The SKU concept was replaced by the derived product code (PRD-<rowid>).
-- Data-only migration: strip the stale `sku` key from every product's JSON.
UPDATE `products` SET `data` = json_remove(`data`, '$.sku');

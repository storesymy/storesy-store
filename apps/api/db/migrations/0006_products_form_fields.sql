-- Product edit form gained description + merchant SKU fields (the PRD-<rowid>
-- code stays derived and immutable; `sku` here is merchant-entered free text).
-- Data-only migration: backfill existing rows so every product's JSON matches
-- the ProductData shape. `json_insert` only fills absent paths.
UPDATE `products` SET `data` = json_insert(json_insert(`data`, '$.description', ''), '$.sku', '');

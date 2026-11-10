-- Shipment (weight kg, box W/H/L cm) and Digital download (download link)
-- join the product data JSON. Data-only migration: backfill existing rows so
-- every product's JSON matches the ProductData shape. Numbers start as JSON
-- null (unset), the link as an empty string; `json_insert` only fills absent
-- paths. The uploaded file itself is preview-only until storage lands.
UPDATE `products` SET `data` = json_insert(json_insert(json_insert(json_insert(json_insert(`data`, '$.weightKg', NULL), '$.widthCm', NULL), '$.heightCm', NULL), '$.lengthCm', NULL), '$.downloadUrl', '');

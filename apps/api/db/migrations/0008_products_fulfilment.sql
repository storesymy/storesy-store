-- Fulfilment channels (Shipment / Download) join the product data JSON.
-- Data-only migration: backfill existing rows with the default — Shipment
-- on, Download off (at least one channel must stay on). `json_insert` with
-- `json(...)` writes a real JSON object and only fills absent paths.
UPDATE `products` SET `data` = json_insert(`data`, '$.fulfilment', json('{"shipment":true,"download":false}'));

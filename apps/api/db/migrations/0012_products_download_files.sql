-- Download files move from browser-only names to stored entries: each is an
-- R2 path (content addressed by SHA-256, so identical bytes store once) plus
-- the display name and byte size — [] until any are saved. Data-only
-- migration: json_insert only fills an absent path.
UPDATE `products` SET `data` = json_insert(`data`, '$.downloadFiles', json_array());

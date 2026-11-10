-- One download link becomes a list: `downloadUrl` (string) is replaced by
-- `downloadLinks` (JSON array). Data-only migration: an existing non-empty
-- link becomes a one-item array, empty/absent becomes []. json_insert only
-- fills absent paths; json_remove drops the old key.
UPDATE `products` SET `data` = json_insert(
  json_remove(`data`, '$.downloadUrl'),
  '$.downloadLinks',
  CASE
    WHEN COALESCE(json_extract(`data`, '$.downloadUrl'), '') = '' THEN json_array()
    ELSE json_array(json_extract(`data`, '$.downloadUrl'))
  END
);

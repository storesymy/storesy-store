-- Product images move from browser-only previews to stored paths: `featured`
-- is a single R2 path (JSON null until one is saved) and `gallery` an array of
-- them ([] until any). Data-only migration — json_insert only fills an absent
-- path, so it can't clobber a row that already carries them.
UPDATE `products` SET `data` = json_insert(
  json_insert(`data`, '$.featured', NULL),
  '$.gallery',
  json_array()
);

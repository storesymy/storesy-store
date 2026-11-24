-- The first self-signup is the install's owner. An earlier build briefly
-- created it as `admin`; normalise the earliest account back to `owner`.
UPDATE `users`
SET `role` = 'owner'
WHERE `id` = (SELECT MIN(`id`) FROM `users`)
	AND `role` = 'admin';

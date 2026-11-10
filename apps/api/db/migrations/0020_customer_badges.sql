-- Badges are automatic now: one paid checkout → `new`, two or more → `repeat`.
-- (No paid checkout means no badge at all.)
UPDATE `customers` SET `badge` = CASE
	WHEN `total_checkout` = 0 THEN NULL
	WHEN `total_checkout` = 1 THEN 'new'
	ELSE 'repeat'
END;

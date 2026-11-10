PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users` ("uuid", "email", "name", "password_hash", "role", "created_at", "updated_at")
SELECT
	'usr_' || substr(printf('%012x', t.ms), 1, 8) || '-' || substr(printf('%012x', t.ms), 9, 4) || '-' ||
	printf('%04x', 28672 + (abs(random()) % 4096)) || '-' ||
	printf('%04x', 32768 + (abs(random()) % 16384)) || '-' ||
	lower(hex(randomblob(6))),
	"email", "name", "password_hash", "role",
	strftime('%Y-%m-%d %H:%M:%S', "created_at", 'unixepoch', '+8 hours'),
	strftime('%Y-%m-%d %H:%M:%S', "updated_at", 'unixepoch', '+8 hours')
FROM `users`
CROSS JOIN (SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS ms) AS t;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_uuid_unique` ON `users` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
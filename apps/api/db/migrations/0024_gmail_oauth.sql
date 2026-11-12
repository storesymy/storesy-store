-- Google OAuth connections for Gmail. A flow row carries one sign-in attempt:
-- state first, then (after Google answers) the encrypted refresh token and
-- account email, ready for the merchant's Save. Rows are short-lived and are
-- deleted on Save, Cancel or expiry.
CREATE TABLE `gmail_oauth_flows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`user_id` integer NOT NULL,
	`state_hash` text NOT NULL,
	`data` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gmail_oauth_flows_data_json" CHECK(json_valid(`data`))
);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_oauth_flows_uuid_unique` ON `gmail_oauth_flows` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_oauth_flows_state_hash_unique` ON `gmail_oauth_flows` (`state_hash`);--> statement-breakpoint
CREATE INDEX `gmail_oauth_flows_user_idx` ON `gmail_oauth_flows` (`user_id`);--> statement-breakpoint
CREATE INDEX `gmail_oauth_flows_expires_idx` ON `gmail_oauth_flows` (`expires_at`);

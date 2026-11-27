-- User management: invitations + per-user sidebar access. Existing accounts
-- stay active and keep full access; new accounts start as pending invites.
ALTER TABLE `users` ADD `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `data` text DEFAULT '{"menuAccess":[]}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `invite_token_hash` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `invite_expires_at` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `invited_by` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_invite_token_unique` ON `users` (`invite_token_hash`);
--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);
--> statement-breakpoint
CREATE INDEX `users_invite_expires_idx` ON `users` (`invite_expires_at`);
--> statement-breakpoint
UPDATE `users`
SET `data` = json_object(
	'menuAccess',
	json('["dashboard","storefront","salespages","products","orders","fulfilment","shipping-zone","customers","templates","integrations","users"]')
)
WHERE `role` IN ('owner', 'admin');

CREATE TABLE `memory_audit_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`created_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_archives_user_created` ON `memory_audit_archives` (`user_id`,`created_at`);
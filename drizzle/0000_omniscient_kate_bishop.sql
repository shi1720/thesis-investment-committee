CREATE TABLE `committee_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`created_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memories_user_created` ON `committee_memories` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`profile` text NOT NULL,
	`result` text,
	`error` text,
	`idempotency_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_user_created` ON `research_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_user_idempotency` ON `research_runs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `saved_theses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`run_id` text NOT NULL,
	`created_at` text NOT NULL,
	`invalidation` text NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `theses_user_created` ON `saved_theses` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `theses_user_symbol_market` ON `saved_theses` (`user_id`,`symbol`,`market`);
CREATE TABLE `album_counters` (
	`album_id` text PRIMARY KEY,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`album_id` text NOT NULL,
	`created_at` integer NOT NULL
);

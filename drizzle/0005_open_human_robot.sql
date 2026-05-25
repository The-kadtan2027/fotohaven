CREATE TABLE `face_embeddings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`face_index` integer NOT NULL,
	`embedding` blob NOT NULL,
	`bbox_x` real,
	`bbox_y` real,
	`bbox_w` real,
	`bbox_h` real,
	`created_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `Album`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photo_id`) REFERENCES `Photo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `Album` ADD `high_threshold` real DEFAULT 0.7;--> statement-breakpoint
ALTER TABLE `Album` ADD `low_threshold` real DEFAULT 0.55;
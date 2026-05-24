ALTER TABLE `Album` ADD `compressionQuality` integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `Album` ADD `compressionFormat` text DEFAULT 'webp' NOT NULL;--> statement-breakpoint
ALTER TABLE `Album` ADD `dedupThreshold` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `Photo` ADD `isBlurred` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `Photo` ADD `imageHash` text;
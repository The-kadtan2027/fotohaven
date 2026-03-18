ALTER TABLE `Photo` ADD `isReturn` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `Photo` ADD `returnOf` text;
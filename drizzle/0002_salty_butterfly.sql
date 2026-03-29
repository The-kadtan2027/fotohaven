CREATE TABLE `GuestOtp` (
	`id` text PRIMARY KEY NOT NULL,
	`albumId` text NOT NULL,
	`email` text NOT NULL,
	`codeHash` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`consumedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`albumId`) REFERENCES `Album`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Guest` (
	`id` text PRIMARY KEY NOT NULL,
	`albumId` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`faceDescriptor` text,
	`sessionToken` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`albumId`) REFERENCES `Album`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `PhotoFace` (
	`id` text PRIMARY KEY NOT NULL,
	`photoId` text NOT NULL,
	`descriptor` text NOT NULL,
	`boundingBox` text NOT NULL,
	FOREIGN KEY (`photoId`) REFERENCES `Photo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Photographer` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`passwordHash` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Photographer_username_unique` ON `Photographer` (`username`);--> statement-breakpoint
ALTER TABLE `Photo` ADD `isSelected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `Photo` ADD `faceProcessed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `Photo` ADD `thumbnailKey` text;
CREATE TABLE `Album` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`clientName` text NOT NULL,
	`shareToken` text NOT NULL,
	`password` text,
	`notifyEmail` text,
	`expiresAt` integer,
	`firstViewedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Album_shareToken_unique` ON `Album` (`shareToken`);--> statement-breakpoint
CREATE TABLE `Ceremony` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`albumId` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`albumId`) REFERENCES `Album`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Comment` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`author` text NOT NULL,
	`photoId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`photoId`) REFERENCES `Photo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Photo` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`originalName` text NOT NULL,
	`size` integer NOT NULL,
	`mimeType` text NOT NULL,
	`storageKey` text NOT NULL,
	`width` integer,
	`height` integer,
	`ceremonyId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`ceremonyId`) REFERENCES `Ceremony`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `ActivityLog` (
	`id` text PRIMARY KEY NOT NULL,
	`albumId` text NOT NULL,
	`guestId` text,
	`eventType` text NOT NULL,
	`payload` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`albumId`) REFERENCES `Album`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guestId`) REFERENCES `Guest`(`id`) ON UPDATE no action ON DELETE cascade
);

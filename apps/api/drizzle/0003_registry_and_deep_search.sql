CREATE TABLE `registry_enterprises` (
	`enterprise_number` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`nace_code` text,
	`nace_version` text,
	`zipcode` text,
	`municipality` text
);
--> statement-breakpoint
CREATE TABLE `registry_nace` (
	`code` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `registry_names` (
	`normalised_name` text NOT NULL,
	`enterprise_number` text NOT NULL,
	PRIMARY KEY(`normalised_name`, `enterprise_number`),
	FOREIGN KEY (`enterprise_number`) REFERENCES `registry_enterprises`(`enterprise_number`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `companies` ADD `nace_code` text;--> statement-breakpoint
ALTER TABLE `deep_searches` ADD `changes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `deep_searches` ADD `requests_spent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `deep_searches` ADD `message` text;--> statement-breakpoint
ALTER TABLE `deep_searches` ADD `created_at` text;
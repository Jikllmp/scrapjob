CREATE TABLE `blocklist` (
	`normalised_name` text NOT NULL,
	`company_domain` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`normalised_name`, `company_domain`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalised_name` text NOT NULL,
	`website` text,
	`domain` text,
	`city` text,
	`country` text,
	`industry` text,
	`size_bucket` text,
	`registry_id` text,
	`is_agency` integer DEFAULT false NOT NULL,
	`generic_email` text
);
--> statement-breakpoint
CREATE INDEX `companies_domain_idx` ON `companies` (`domain`);--> statement-breakpoint
CREATE INDEX `companies_normalised_name_idx` ON `companies` (`normalised_name`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`search_id` text NOT NULL,
	`company_id` text,
	`job_opportunity_id` text,
	`first_name` text,
	`last_name` text,
	`full_name` text,
	`title` text,
	`department` text,
	`profile_url` text,
	`email` text,
	`phone` text,
	`city` text,
	`country` text,
	`role_tier` integer,
	`role_archetype` text,
	`relevance_score` integer,
	`relevance_reasons` text DEFAULT '[]' NOT NULL,
	`confidence` text DEFAULT 'UNKNOWN' NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`duplicate_of_id` text,
	`field_flags` text DEFAULT '{}' NOT NULL,
	`collected_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`notes` text,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_opportunity_id`) REFERENCES `job_opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contacts_role_tier_range" CHECK("contacts"."role_tier" IS NULL OR "contacts"."role_tier" BETWEEN 1 AND 5),
	CONSTRAINT "contacts_score_range" CHECK("contacts"."relevance_score" IS NULL OR "contacts"."relevance_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE INDEX `contacts_search_idx` ON `contacts` (`search_id`);--> statement-breakpoint
CREATE TABLE `deep_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`fields_before` text,
	`fields_after` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text,
	`company_id` text,
	`field` text NOT NULL,
	`value_seen` text NOT NULL,
	`source_adapter` text NOT NULL,
	`source_url` text NOT NULL,
	`snippet` text NOT NULL,
	`published_at` text,
	`retrieved_at` text NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evidence_one_owner" CHECK(("evidence"."contact_id" IS NULL) <> ("evidence"."company_id" IS NULL)),
	CONSTRAINT "evidence_snippet_length" CHECK(length("evidence"."snippet") <= 500)
);
--> statement-breakpoint
CREATE INDEX `evidence_contact_field_idx` ON `evidence` (`contact_id`,`field`);--> statement-breakpoint
CREATE INDEX `evidence_company_field_idx` ON `evidence` (`company_id`,`field`);--> statement-breakpoint
CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`search_id` text NOT NULL,
	`filename` text NOT NULL,
	`path` text NOT NULL,
	`row_count` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`posted_at` text,
	`source_adapter` text NOT NULL,
	`location` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `search_events` (
	`id` text PRIMARY KEY NOT NULL,
	`search_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_events_search_seq_idx` ON `search_events` (`search_id`,`seq`);--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`position` text NOT NULL,
	`target_count` integer DEFAULT 20 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`budget_spent` text DEFAULT '{}' NOT NULL,
	`stop_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	`error` text
);

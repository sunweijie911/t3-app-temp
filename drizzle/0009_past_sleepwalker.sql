CREATE TABLE "pg-drizzle_info_collect_config" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"bannerUrl" text,
	"enabledFields" jsonb NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_info_collect_record" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pg-drizzle_info_collect_record" ALTER COLUMN "proofImageUrl" DROP NOT NULL;
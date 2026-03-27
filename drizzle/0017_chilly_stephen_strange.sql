CREATE TABLE "pg-drizzle_sim_card_click_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"packageId" varchar(36) NOT NULL,
	"packageTitle" varchar(256) NOT NULL,
	"dingtalkUserid" varchar(64) NOT NULL,
	"userName" varchar(50),
	"userPhone" varchar(20),
	"department" text,
	"jobNumber" varchar(50),
	"userAgent" text,
	"ipAddress" varchar(64),
	"deviceInfo" text,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_sim_card_package" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"title" varchar(256) NOT NULL,
	"carrier" varchar(128) NOT NULL,
	"imageUrl" text,
	"detailImageUrl" text,
	"cardBgColor" varchar(32) DEFAULT '#ffffff',
	"monthlyPrice" integer NOT NULL,
	"dataAllowance" varchar(128),
	"callMinutes" varchar(128),
	"highlights" jsonb DEFAULT '[]'::jsonb,
	"description" text,
	"purchaseLink" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
DROP TABLE "pg-drizzle_info_collect_config" CASCADE;--> statement-breakpoint
DROP TABLE "pg-drizzle_info_collect_record" CASCADE;--> statement-breakpoint
CREATE INDEX "sim_card_click_pkg_idx" ON "pg-drizzle_sim_card_click_log" USING btree ("packageId");--> statement-breakpoint
CREATE INDEX "sim_card_click_user_idx" ON "pg-drizzle_sim_card_click_log" USING btree ("dingtalkUserid");--> statement-breakpoint
CREATE INDEX "sim_card_click_created_idx" ON "pg-drizzle_sim_card_click_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "sim_card_pkg_active_idx" ON "pg-drizzle_sim_card_package" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "sim_card_pkg_sort_idx" ON "pg-drizzle_sim_card_package" USING btree ("sortOrder");--> statement-breakpoint
DROP TYPE "public"."info_collect_status";
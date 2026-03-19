CREATE TABLE "pg-drizzle_battery_swap_package" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"company" varchar(128) NOT NULL,
	"title" varchar(256) NOT NULL,
	"imageUrl" text,
	"originalPrice" integer NOT NULL,
	"salePrice" integer NOT NULL,
	"specs" jsonb NOT NULL,
	"depositMethod" varchar(128) DEFAULT '芝麻信用抵押金',
	"regionLimit" text,
	"purchaseNotes" text,
	"validFrom" timestamp with time zone,
	"validTo" timestamp with time zone,
	"purchaseLink" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "battery_swap_pkg_active_idx" ON "pg-drizzle_battery_swap_package" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "battery_swap_pkg_sort_idx" ON "pg-drizzle_battery_swap_package" USING btree ("sortOrder");
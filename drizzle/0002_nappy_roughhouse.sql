CREATE TYPE "public"."draw_record_status" AS ENUM('pending', 'confirmed', 'shipped', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."prize_type" AS ENUM('physical', 'virtual', 'coupon', 'points', 'thanks');--> statement-breakpoint
CREATE TABLE "pg-drizzle_wheel_activity" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"slug" varchar(128) NOT NULL,
	"description" text,
	"coverImage" text,
	"startAt" timestamp with time zone,
	"endAt" timestamp with time zone,
	"maxDrawsPerUser" integer DEFAULT 0 NOT NULL,
	"maxDrawsPerDay" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"rules" jsonb,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_wheel_draw_record" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"activityId" varchar(36) NOT NULL,
	"prizeId" varchar(36),
	"isWin" boolean DEFAULT false NOT NULL,
	"status" "draw_record_status" DEFAULT 'pending' NOT NULL,
	"userInfo" jsonb,
	"adminNote" text,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_wheel_prize" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"activityId" varchar(36) NOT NULL,
	"name" varchar(256) NOT NULL,
	"image" text,
	"type" "prize_type" DEFAULT 'thanks' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"totalStock" integer DEFAULT 0 NOT NULL,
	"remainingStock" integer DEFAULT 0 NOT NULL,
	"value" jsonb,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_draw_record" ADD CONSTRAINT "pg-drizzle_wheel_draw_record_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_draw_record" ADD CONSTRAINT "pg-drizzle_wheel_draw_record_activityId_pg-drizzle_wheel_activity_id_fk" FOREIGN KEY ("activityId") REFERENCES "public"."pg-drizzle_wheel_activity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_draw_record" ADD CONSTRAINT "pg-drizzle_wheel_draw_record_prizeId_pg-drizzle_wheel_prize_id_fk" FOREIGN KEY ("prizeId") REFERENCES "public"."pg-drizzle_wheel_prize"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_prize" ADD CONSTRAINT "pg-drizzle_wheel_prize_activityId_pg-drizzle_wheel_activity_id_fk" FOREIGN KEY ("activityId") REFERENCES "public"."pg-drizzle_wheel_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wheel_activity_slug_idx" ON "pg-drizzle_wheel_activity" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "wheel_activity_active_idx" ON "pg-drizzle_wheel_activity" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "wheel_draw_user_idx" ON "pg-drizzle_wheel_draw_record" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "wheel_draw_activity_idx" ON "pg-drizzle_wheel_draw_record" USING btree ("activityId");--> statement-breakpoint
CREATE INDEX "wheel_draw_prize_idx" ON "pg-drizzle_wheel_draw_record" USING btree ("prizeId");--> statement-breakpoint
CREATE INDEX "wheel_prize_activity_idx" ON "pg-drizzle_wheel_prize" USING btree ("activityId");--> statement-breakpoint
CREATE INDEX "wheel_prize_active_idx" ON "pg-drizzle_wheel_prize" USING btree ("isActive");
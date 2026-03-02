CREATE TABLE "pg-drizzle_wheel_extra_chance" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"activityId" varchar(36) NOT NULL,
	"phone" text NOT NULL,
	"extraChances" integer DEFAULT 0 NOT NULL,
	"note" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_activity" ALTER COLUMN "maxDrawsPerUser" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean;--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_extra_chance" ADD CONSTRAINT "pg-drizzle_wheel_extra_chance_activityId_pg-drizzle_wheel_activity_id_fk" FOREIGN KEY ("activityId") REFERENCES "public"."pg-drizzle_wheel_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wheel_extra_chance_activity_phone_idx" ON "pg-drizzle_wheel_extra_chance" USING btree ("activityId","phone");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number");
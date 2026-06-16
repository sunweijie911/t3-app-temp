ALTER TABLE "pg-drizzle_wheel_extra_chance" RENAME COLUMN "phone" TO "identifier";--> statement-breakpoint
DROP INDEX "wheel_extra_chance_activity_phone_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "wheel_extra_chance_activity_identifier_idx" ON "pg-drizzle_wheel_extra_chance" USING btree ("activityId","identifier");